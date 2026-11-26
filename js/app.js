/* Immanuel Hà Nội – Bài giảng & Tĩnh nguyện
 * Single-page app, no build step. Data lives in data/sermons.json.
 */
(() => {
  'use strict';

  const TYPES = {
    'chua-nhat': { label: 'Chúa Nhật', cls: '' },
    'hang-ngay': { label: 'Hằng ngày', cls: 'daily' },
    'khac': { label: 'Video khác', cls: 'other' },
  };
  const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const FAV_KEY = 'immanuel.favorites';
  const SETTINGS_KEY = 'immanuel.settings';
  const CACHE_KEY = 'immanuel.dataCache';
  const CONFIG = window.APP_CONFIG || {};

  const $app = document.getElementById('app');
  let DATA = { church: {}, topics: [], sermons: [], verses: [] };

  /* ---------- native (Android/iOS app via Capacitor) ---------- */

  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const plugin = name => (isNative && window.Capacitor.Plugins && window.Capacitor.Plugins[name]) || null;

  /* ---------- helpers ---------- */

  const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  // Vietnamese-insensitive normalisation: "Đức Tin" -> "duc tin"
  const norm = (s = '') => String(s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase();

  const slug = s => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const toISO = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const todayISO = () => toISO(new Date());

  const parseDate = iso => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const fmtDate = iso => {
    if (!iso) return '';
    const d = parseDate(iso);
    return `${WEEKDAYS[d.getDay()] === 'CN' ? 'Chúa Nhật' : 'Thứ ' + (d.getDay() + 1)}, ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
  };

  // Accepts any common YouTube URL form or a bare 11-char id.
  function youtubeId(url = '') {
    url = String(url).trim();
    if (!url) return '';
    if (/^[\w-]{11}$/.test(url)) return url;
    const m = url.match(/(?:v=|youtu\.be\/|embed\/|live\/|shorts\/|v\/)([\w-]{11})/);
    return m ? m[1] : '';
  }
  const thumbUrl = s => {
    const id = youtubeId(s.video);
    return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '';
  };

  const topicMeta = name => DATA.topics.find(t => t.name === name) || { name, emoji: '📌' };
  const topicByslug = sl => {
    const all = allTopicNames();
    return all.find(n => slug(n) === sl);
  };
  function allTopicNames() {
    const set = new Set(DATA.topics.map(t => t.name));
    DATA.sermons.forEach(s => (s.topics || []).forEach(t => set.add(t)));
    return [...set];
  }
  const countByTopic = name => DATA.sermons.filter(s => (s.topics || []).includes(name)).length;

  const byDateDesc = (a, b) => (b.date || '').localeCompare(a.date || '');
  const ofType = type => DATA.sermons.filter(s => s.type === type).sort(byDateDesc);

  /* ---------- favorites (stored on this device) ---------- */

  function getFavs() {
    try { return JSON.parse(localStorage.getItem(FAV_KEY)) || []; } catch { return []; }
  }
  function toggleFav(id) {
    const favs = getFavs();
    const i = favs.indexOf(id);
    i >= 0 ? favs.splice(i, 1) : favs.unshift(id);
    try { localStorage.setItem(FAV_KEY, JSON.stringify(favs)); } catch { /* private mode */ }
    return i < 0;
  }

  /* ---------- verse of the day & reminders ---------- */

  // The day's devotion verse if there is one, otherwise rotate through data/verses.json.
  function verseForDate(iso) {
    const dev = DATA.sermons.find(s => s.type === 'hang-ngay' && s.date === iso && s.verse);
    if (dev) return { text: dev.verse, ref: dev.scripture, route: '#/bai/' + encodeURIComponent(dev.id) };
    const list = DATA.verses || [];
    if (!list.length) return null;
    const d = parseDate(iso);
    const day = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
    const v = list[(d.getFullYear() * 366 + day) % list.length];
    return { text: v.text, ref: v.ref, route: '#/' };
  }

  const DEFAULT_SETTINGS = {
    verse: { on: false, time: '06:00' },
    sunday: { on: false, time: '07:30' },
  };
  function getSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
      return { verse: { ...DEFAULT_SETTINGS.verse, ...s.verse }, sunday: { ...DEFAULT_SETTINGS.sunday, ...s.sunday } };
    } catch { return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); }
  }
  function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
  }

  const VERSE_DAYS = 60;      // notifications are scheduled this many days ahead, refreshed on every app open
  const VERSE_ID_BASE = 1000;
  const SUNDAY_ID = 2000;

  async function ensurePermission() {
    const LN = plugin('LocalNotifications');
    if (!LN) return false;
    let p = await LN.checkPermissions();
    if (p.display !== 'granted') p = await LN.requestPermissions();
    return p.display === 'granted';
  }

  async function scheduleReminders() {
    const LN = plugin('LocalNotifications');
    if (!LN) return;
    const st = getSettings();
    const pending = await LN.getPending();
    if (pending.notifications.length) {
      await LN.cancel({ notifications: pending.notifications.map(n => ({ id: n.id })) });
    }
    const list = [];
    if (st.verse.on) {
      const [h, m] = st.verse.time.split(':').map(Number);
      const now = new Date();
      for (let i = 0; i < VERSE_DAYS; i++) {
        const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, h, m);
        if (at <= now) continue;
        const v = verseForDate(toISO(at));
        if (!v) continue;
        list.push({
          id: VERSE_ID_BASE + i,
          title: `📖 ${v.ref}`,
          body: v.text,
          largeBody: v.text,
          summaryText: 'Câu Kinh Thánh hôm nay',
          schedule: { at, allowWhileIdle: true },
          extra: { route: v.route },
        });
      }
    }
    if (st.sunday.on) {
      const [h, m] = st.sunday.time.split(':').map(Number);
      list.push({
        id: SUNDAY_ID,
        title: '⛪ Hôm nay là Chúa Nhật',
        body: 'Mời anh chị em cùng đến nhà Chúa thờ phượng. Bấm để xem bài giảng.',
        schedule: { on: { weekday: 1, hour: h, minute: m }, allowWhileIdle: true },
        extra: { route: '#/chua-nhat' },
      });
    }
    if (list.length) await LN.schedule({ notifications: list });
  }

  async function sendTestNotification() {
    const LN = plugin('LocalNotifications');
    if (!LN || !(await ensurePermission())) return false;
    const v = verseForDate(todayISO()) || { ref: 'Thi thiên 118:24', text: 'Nầy là ngày Đức Giê-hô-va làm nên.', route: '#/' };
    await LN.schedule({ notifications: [{
      id: 999, title: `📖 ${v.ref}`, body: v.text, largeBody: v.text,
      schedule: { at: new Date(Date.now() + 3000), allowWhileIdle: true }, extra: { route: v.route },
    }] });
    return true;
  }

  /* ---------- search ---------- */

  function haystack(s) {
    if (!s._hay) {
      s._hay = norm([
        s.title, s.service, s.speaker, s.series, s.scripture, s.verse, s.summary, s.raw && s.raw.title,
        (s.topics || []).join(' '), (s.points || []).join(' '),
      ].join(' \u0001 '));
      s._title = norm(s.title);
    }
    return s._hay;
  }

  function search({ q = '', type = '', topic = '', speaker = '' }) {
    const terms = norm(q).split(/\s+/).filter(Boolean);
    return DATA.sermons
      .filter(s => !type || s.type === type)
      .filter(s => !topic || (s.topics || []).includes(topic))
      .filter(s => !speaker || s.speaker === speaker)
      .map(s => {
        const hay = haystack(s);
        if (!terms.every(t => hay.includes(t))) return null;
        let score = 0;
        terms.forEach(t => {
          if (s._title.includes(t)) score += 5;
          if (norm((s.topics || []).join(' ')).includes(t)) score += 3;
          if (norm(s.scripture).includes(t)) score += 2;
        });
        return { s, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || byDateDesc(a.s, b.s))
      .map(r => r.s);
  }

  function highlight(text, q) {
    const safe = esc(text);
    const terms = norm(q).split(/\s+/).filter(t => t.length > 1);
    if (!terms.length) return safe;
    // Map normalised positions back onto the original string.
    const n = norm(text);
    const marks = new Array(text.length).fill(false);
    terms.forEach(t => {
      let i = n.indexOf(t);
      while (i >= 0) { for (let k = i; k < i + t.length; k++) marks[k] = true; i = n.indexOf(t, i + 1); }
    });
    // NFD-stripping keeps one char per original char for Vietnamese, so indices line up.
    if (n.length !== text.length) return safe;
    let out = '', open = false;
    for (let i = 0; i < text.length; i++) {
      if (marks[i] && !open) { out += '<mark>'; open = true; }
      if (!marks[i] && open) { out += '</mark>'; open = false; }
      out += esc(text[i]);
    }
    return out + (open ? '</mark>' : '');
  }

  /* ---------- components ---------- */

  function thumb(s) {
    const src = thumbUrl(s);
    return `<div class="thumb">
      ${src ? `<img src="${src}" alt="" loading="lazy" onerror="this.remove()">` : ''}
      <span class="play"></span>
      ${s.duration ? `<span class="dur">${esc(s.duration)}</span>` : ''}
    </div>`;
  }

  function card(s, { hero = false, q = '' } = {}) {
    const t = TYPES[s.type] || { label: s.type, cls: '' };
    return `<a class="card${hero ? ' hero' : ''}" href="#/bai/${encodeURIComponent(s.id)}">
      ${thumb(s)}
      <div class="card-body">
        <span class="badge ${t.cls}">${t.label}</span>
        <span class="card-title">${q ? highlight(s.title, q) : esc(s.title)}</span>
        ${s.scripture ? `<span class="ref">${esc(s.scripture)}</span>` : ''}
        <span class="meta">${[s.service, s.speaker, s.date && fmtDate(s.date)].filter(Boolean).map(esc).join(' · ')}</span>
      </div>
    </a>`;
  }

  const list = (items, opts = {}) => items.length
    ? `<div class="list${opts.grid ? ' grid' : ''}">${items.map(s => card(s, opts)).join('')}</div>`
    : `<p class="empty">${opts.empty || 'Chưa có bài nào.'}</p>`;

  const topicChips = (active = '', scroll = true) => `<div class="chips${scroll ? ' scroll' : ''}">
    ${allTopicNames().filter(countByTopic).map(n => `<a class="chip${n === active ? ' on' : ''}" href="#/chu-de/${slug(n)}">${topicMeta(n).emoji} ${esc(n)}</a>`).join('')}
  </div>`;

  /* ---------- pages ---------- */

  function pageHome() {
    const today = todayISO();
    const daily = ofType('hang-ngay').filter(s => s.date <= today);
    const sunday = ofType('chua-nhat');
    const todays = daily[0];
    const verse = verseForDate(today);
    const latestYT = DATA.sermons.filter(s => s.source === 'youtube')
      .sort((a, b) => (b.publishedAt || b.date || '').localeCompare(a.publishedAt || a.date || '')).slice(0, 4);
    const st = getSettings();
    return `
      ${verse && !(todays && todays.date === today) ? `
      <section class="section">
        <div class="box verse-card">
          <span class="meta">📖 Câu Kinh Thánh hôm nay · ${fmtDate(today)}</span>
          <blockquote class="scripture" style="margin:8px 0 0">${esc(verse.text)}<cite>${esc(verse.ref)}</cite></blockquote>
        </div>
      </section>` : ''}

      ${isNative && !st.verse.on ? `
      <a class="box remind-cta" href="#/cai-dat">
        <strong>🔔 Nhận câu Kinh Thánh mỗi sáng</strong>
        <span class="meta">Bật thông báo nhắc nhở hằng ngày →</span>
      </a>` : ''}

      <section class="section">
        <div class="section-head">
          <h2>Tĩnh nguyện hôm nay</h2>
          <a href="#/hang-ngay">Xem tất cả →</a>
        </div>
        ${todays ? `
          <div class="box">
            <span class="meta">${fmtDate(todays.date)}${todays.date !== today ? ' (bài gần nhất)' : ''}</span>
            <h3 style="margin-top:4px">${esc(todays.title)}</h3>
            ${todays.verse ? `<blockquote class="scripture">${esc(todays.verse)}<cite>${esc(todays.scripture)}</cite></blockquote>` : ''}
            <a class="btn primary" href="#/bai/${encodeURIComponent(todays.id)}">Đọc &amp; xem video</a>
          </div>` : '<p class="empty">Chưa có bài tĩnh nguyện.</p>'}
      </section>

      <section class="section">
        <div class="section-head">
          <h2>Bài giảng Chúa Nhật mới nhất</h2>
          <a href="#/chua-nhat">Xem tất cả →</a>
        </div>
        ${sunday[0] ? card(sunday[0], { hero: true }) : '<p class="empty">Chưa có bài giảng.</p>'}
      </section>

      <section class="section">
        <div class="section-head"><h2>Tìm theo chủ đề</h2><a href="#/chu-de">Tất cả →</a></div>
        ${topicChips()}
      </section>

      ${latestYT.length ? `
      <section class="section">
        <div class="section-head"><h2>Mới trên kênh YouTube</h2>
          <a href="${esc(CONFIG.YOUTUBE_CHANNEL_URL || '#')}" target="_blank" rel="noopener">Mở kênh →</a></div>
        ${list(latestYT, { grid: true })}
      </section>` : ''}

      ${sunday.length > 1 ? `
      <section class="section">
        <div class="section-head"><h2>Các tuần trước</h2></div>
        ${list(sunday.slice(1, 5), { grid: true })}
      </section>` : ''}
    `;
  }

  function pageWeekly(params) {
    const series = params.get('loat') || '';
    const all = ofType('chua-nhat');
    const seriesList = [...new Set(all.map(s => s.series).filter(Boolean))];
    const items = series ? all.filter(s => s.series === series) : all;
    return `
      <h1>Thờ phượng Chúa Nhật</h1>
      <p class="lead">Bài giảng trong giờ thờ phượng hằng tuần.</p>
      ${seriesList.length ? `<div class="chips scroll" style="margin-bottom:14px">
        <a class="chip${!series ? ' on' : ''}" href="#/chua-nhat">Tất cả</a>
        ${seriesList.map(x => `<a class="chip${x === series ? ' on' : ''}" href="#/chua-nhat?loat=${encodeURIComponent(x)}">${esc(x)}</a>`).join('')}
      </div>` : ''}
      ${list(items, { grid: true })}
    `;
  }

  function pageDaily(params) {
    const all = ofType('hang-ngay');
    const byDate = Object.fromEntries(all.map(s => [s.date, s]));
    const today = todayISO();
    const sel = params.get('ngay') || today;

    // Last 14 days strip
    const days = [];
    const base = parseDate(today);
    for (let i = 13; i >= 0; i--) {
      const d = new Date(base); d.setDate(base.getDate() - i);
      const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      days.push({ iso, d });
    }
    const s = byDate[sel];
    const older = all.filter(x => !days.some(d => d.iso === x.date));

    setTimeout(() => {
      const on = document.querySelector('.day.on');
      on && on.scrollIntoView({ inline: 'center', block: 'nearest' });
    });

    return `
      <h1>Tĩnh nguyện hằng ngày</h1>
      <p class="lead">Mỗi ngày một lời Chúa, một suy ngẫm, một lời cầu nguyện.</p>
      <div class="daystrip">
        ${days.map(({ iso, d }) => `<a class="day${iso === sel ? ' on' : ''}${byDate[iso] ? '' : ' none'}" href="#/hang-ngay?ngay=${iso}">
          <small>${WEEKDAYS[d.getDay()]}</small><strong>${d.getDate()}</strong></a>`).join('')}
      </div>
      ${s ? card(s, { hero: true }) : `<p class="empty">Chưa có bài tĩnh nguyện cho ngày ${fmtDate(sel)}.</p>`}
      ${s && s.verse ? `<blockquote class="scripture" style="margin-top:14px">${esc(s.verse)}<cite>${esc(s.scripture)}</cite></blockquote>` : ''}
      <section class="section" style="margin-top:24px">
        <div class="section-head"><h2>Tất cả bài tĩnh nguyện</h2></div>
        ${list(all.filter(x => x !== s).slice(0, 30))}
      </section>
      ${older.length > 30 ? '<p class="hint">Dùng Tìm kiếm để xem các bài cũ hơn.</p>' : ''}
    `;
  }

  function pageTopics() {
    // topics that have videos first; hide empty ones once there is content
    const all = allTopicNames().map(n => [n, countByTopic(n)]);
    const names = (all.some(([, c]) => c) ? all.filter(([, c]) => c) : all)
      .sort((a, b) => b[1] - a[1]).map(([n]) => n);
    return `
      <h1>Chủ đề</h1>
      <p class="lead">Chọn một chủ đề để xem tất cả bài giảng và bài tĩnh nguyện liên quan.</p>
      <div class="topic-grid">
        ${names.map(n => {
          const c = countByTopic(n);
          return `<a class="topic-tile" href="#/chu-de/${slug(n)}">
            <span class="emoji">${topicMeta(n).emoji}</span>
            <strong>${esc(n)}</strong>
            <span>${c} bài</span>
          </a>`;
        }).join('')}
      </div>
    `;
  }

  function pageTopic(sl, params) {
    const name = topicByslug(sl);
    if (!name) return notFound();
    const type = params.get('loai') || '';
    const items = search({ topic: name, type });
    const seg = (val, label) => `<button data-loai="${val}" class="${type === val ? 'on' : ''}">${label}</button>`;
    setTimeout(() => {
      document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
        location.hash = `#/chu-de/${sl}${b.dataset.loai ? '?loai=' + b.dataset.loai : ''}`;
      }));
    });
    return `
      <h1>${topicMeta(name).emoji} ${esc(name)}</h1>
      <div class="filters">
        <div class="seg">${seg('', 'Tất cả')}${seg('chua-nhat', 'Chúa Nhật')}${seg('hang-ngay', 'Hằng ngày')}</div>
      </div>
      <p class="result-count">${items.length} bài</p>
      ${list(items, { grid: true })}
      <section class="section" style="margin-top:24px">
        <div class="section-head"><h2>Chủ đề khác</h2></div>
        ${topicChips(name)}
      </section>
    `;
  }

  function pageSearch(params) {
    const state = {
      q: params.get('q') || '',
      type: params.get('loai') || '',
      topic: params.get('chude') || '',
      speaker: params.get('dien-gia') || '',
    };
    const speakers = [...new Set(DATA.sermons.map(s => s.speaker).filter(Boolean))];

    setTimeout(() => {
      const input = document.getElementById('q');
      const typeSel = document.getElementById('f-type');
      const topicSel = document.getElementById('f-topic');
      const spSel = document.getElementById('f-speaker');
      const out = document.getElementById('results');

      const run = () => {
        state.q = input.value; state.type = typeSel.value; state.topic = topicSel.value; state.speaker = spSel.value;
        const items = search(state);
        const hasQuery = state.q || state.type || state.topic || state.speaker;
        out.innerHTML = `<p class="result-count">${hasQuery ? items.length + ' kết quả' : 'Tất cả ' + items.length + ' bài'}</p>` +
          list(items, { grid: true, q: state.q, empty: 'Không tìm thấy bài nào. Thử từ khóa khác, ví dụ: "đức tin", "Giăng 3", "cầu nguyện".' });
        // keep URL shareable without re-rendering the page
        const p = new URLSearchParams();
        if (state.q) p.set('q', state.q);
        if (state.type) p.set('loai', state.type);
        if (state.topic) p.set('chude', state.topic);
        if (state.speaker) p.set('dien-gia', state.speaker);
        history.replaceState(null, '', '#/tim-kiem' + (p.toString() ? '?' + p : ''));
      };
      input.addEventListener('input', run);
      [typeSel, topicSel, spSel].forEach(el => el.addEventListener('change', run));
      run();
      if (!state.q) input.focus();
    });

    const opt = (val, label, cur) => `<option value="${esc(val)}"${val === cur ? ' selected' : ''}>${esc(label)}</option>`;
    return `
      <h1>Tìm kiếm</h1>
      <div class="searchbox">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M10 2a8 8 0 0 1 6.32 12.9l5.39 5.4-1.41 1.4-5.4-5.39A8 8 0 1 1 10 2Zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z"/></svg>
        <input id="q" type="search" value="${esc(state.q)}" placeholder="Tên bài, câu Kinh Thánh, chủ đề…" autocomplete="off" enterkeyhint="search">
      </div>
      <div class="filters" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
        <select id="f-type" aria-label="Loại">${opt('', 'Mọi loại', state.type)}${opt('chua-nhat', 'Chúa Nhật', state.type)}${opt('hang-ngay', 'Hằng ngày', state.type)}${opt('khac', 'Video khác', state.type)}</select>
        <select id="f-topic" aria-label="Chủ đề">${opt('', 'Mọi chủ đề', state.topic)}${allTopicNames().map(n => opt(n, n, state.topic)).join('')}</select>
        <select id="f-speaker" aria-label="Diễn giả">${opt('', 'Mọi diễn giả', state.speaker)}${speakers.map(n => opt(n, n, state.speaker)).join('')}</select>
      </div>
      <div id="results"></div>
      <p class="hint">Mẹo: tìm được cả khi gõ không dấu, ví dụ "duc tin", "gia dinh".</p>
    `;
  }

  function pageDetail(id) {
    const s = DATA.sermons.find(x => x.id === id);
    if (!s) return notFound();
    const vid = youtubeId(s.video);
    const t = TYPES[s.type] || { label: s.type, cls: '' };
    const isFav = getFavs().includes(s.id);
    const related = DATA.sermons
      .filter(x => x !== s && (x.topics || []).some(tp => (s.topics || []).includes(tp)))
      .sort(byDateDesc).slice(0, 4);

    setTimeout(() => {
      const favBtn = document.getElementById('fav');
      favBtn && favBtn.addEventListener('click', () => {
        const on = toggleFav(s.id);
        favBtn.classList.toggle('on', on);
        favBtn.textContent = on ? '♥ Đã lưu' : '♡ Lưu';
      });
      const shareBtn = document.getElementById('share');
      shareBtn && shareBtn.addEventListener('click', async () => {
        const url = location.href;
        try {
          if (navigator.share) await navigator.share({ title: s.title, text: `${s.title} – ${s.scripture || ''}`, url });
          else { await navigator.clipboard.writeText(url); shareBtn.textContent = 'Đã sao chép link'; }
        } catch { /* cancelled */ }
      });
    });

    return `
      <div class="player">
        ${vid
          ? `<iframe src="https://www.youtube-nocookie.com/embed/${vid}?rel=0" title="${esc(s.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe>`
          : `<div class="novideo"><div><strong>Chưa gắn video</strong><br><small>Thêm link YouTube vào trường "video" trong data/sermons.json</small></div></div>`}
      </div>
      <span class="badge ${t.cls}">${t.label}</span>
      <h1 style="margin-top:6px">${esc(s.title)}</h1>
      <div class="detail-meta">
        ${s.service ? `<span>⛪ ${esc(s.service)}</span>` : ''}
        ${s.speaker ? `<span>🎤 ${esc(s.speaker)}</span>` : ''}
        ${s.date ? `<span>📅 ${fmtDate(s.date)}</span>` : ''}
        ${s.series ? `<a href="#/chua-nhat?loat=${encodeURIComponent(s.series)}">📚 ${esc(s.series)}</a>` : ''}
      </div>
      <div class="chips">${(s.topics || []).map(n => `<a class="chip" href="#/chu-de/${slug(n)}">${topicMeta(n).emoji} ${esc(n)}</a>`).join('')}</div>
      <div class="actions">
        <button id="fav" class="btn${isFav ? ' on' : ''}">${isFav ? '♥ Đã lưu' : '♡ Lưu'}</button>
        <button id="share" class="btn">↗ Chia sẻ</button>
        ${vid ? `<a class="btn" href="https://www.youtube.com/watch?v=${vid}" target="_blank" rel="noopener">▶ Mở trên YouTube</a>` : ''}
      </div>

      ${s.verse ? `<blockquote class="scripture">${esc(s.verse)}<cite>${esc(s.scripture)}</cite></blockquote>`
        : s.scripture ? `<p class="ref">📖 ${esc(s.scripture)}</p>` : ''}

      <div class="prose">
        ${s.summary ? `<p>${esc(s.summary)}</p>` : ''}
        ${s.points && s.points.length ? `<div class="box"><h3>Dàn bài</h3><ol>${s.points.map(p => `<li>${esc(p)}</li>`).join('')}</ol></div>` : ''}
        ${s.questions && s.questions.length ? `<div class="box"><h3>Suy ngẫm &amp; áp dụng</h3><ul>${s.questions.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}
        ${s.prayer ? `<div class="box"><h3>Cầu nguyện</h3><p>${esc(s.prayer)}</p></div>` : ''}
      </div>

      ${related.length ? `<section class="section"><div class="section-head"><h2>Cùng chủ đề</h2></div>${list(related)}</section>` : ''}
    `;
  }

  function pageFavorites() {
    const favs = getFavs();
    const items = favs.map(id => DATA.sermons.find(s => s.id === id)).filter(Boolean);
    return `
      <h1>Đã lưu</h1>
      <p class="lead">Những bài bạn đã bấm "Lưu" (lưu trên thiết bị này).</p>
      ${list(items, { grid: true, empty: 'Bạn chưa lưu bài nào. Mở một bài giảng và bấm ♡ Lưu.' })}
    `;
  }

  // Helper for the person who maintains the content: fill a form, get JSON to paste.
  function pageAdd() {
    setTimeout(() => {
      const f = document.getElementById('addform');
      const out = document.getElementById('json-out');
      const prev = document.getElementById('preview');
      const build = () => {
        const v = Object.fromEntries(new FormData(f));
        const id = (v.type === 'hang-ngay' ? 'hn-' : 'cn-') + (v.date || 'ngay') + (v.suffix ? '-' + slug(v.suffix) : '');
        const lines = x => (x || '').split('\n').map(l => l.trim()).filter(Boolean);
        const obj = {
          id, type: v.type, title: v.title, speaker: v.speaker, date: v.date, video: v.video, duration: v.duration,
          series: v.series, scripture: v.scripture, verse: v.verse,
          topics: (v.topics || '').split(',').map(t => t.trim()).filter(Boolean),
          summary: v.summary, points: lines(v.points), questions: lines(v.questions), prayer: v.prayer,
        };
        Object.keys(obj).forEach(k => (obj[k] === '' || (Array.isArray(obj[k]) && !obj[k].length)) && k !== 'video' && delete obj[k]);
        out.textContent = JSON.stringify(obj, null, 2) + ',';
        const vid = youtubeId(v.video);
        prev.innerHTML = vid ? `<img src="https://i.ytimg.com/vi/${vid}/hqdefault.jpg" alt="Ảnh video" style="border-radius:10px">` :
          (v.video ? '<p class="hint">⚠️ Không nhận ra link YouTube.</p>' : '');
      };
      f.addEventListener('input', build);
      build();
      document.getElementById('copy').addEventListener('click', async e => {
        try { await navigator.clipboard.writeText(out.textContent); e.target.textContent = 'Đã sao chép ✓'; } catch { /* ignore */ }
      });
    });
    const topicList = DATA.topics.map(t => t.name).join(', ');
    return `
      <h1>Thêm bài giảng</h1>
      <p class="lead">Điền thông tin, sau đó sao chép đoạn mã bên dưới và dán vào danh sách <code>"sermons"</code> trong file <code>data/sermons.json</code>.</p>
      <form id="addform" class="form" onsubmit="return false">
        <label>Loại
          <select name="type"><option value="chua-nhat">Chúa Nhật</option><option value="hang-ngay">Hằng ngày (tĩnh nguyện)</option></select>
        </label>
        <label>Link YouTube <input name="video" placeholder="https://www.youtube.com/watch?v=..." inputmode="url"></label>
        <div id="preview"></div>
        <label>Tiêu đề <input name="title" required></label>
        <label>Diễn giả <input name="speaker" value="Mục sư Quản nhiệm"></label>
        <label>Ngày <input name="date" type="date" value="${todayISO()}"></label>
        <label>Thời lượng (tuỳ chọn) <input name="duration" placeholder="45:10"></label>
        <label>Loạt bài (tuỳ chọn) <input name="series"></label>
        <label>Kinh Thánh <input name="scripture" placeholder="Giăng 3:16"></label>
        <label>Câu gốc <textarea name="verse"></textarea></label>
        <label>Chủ đề (cách nhau bằng dấu phẩy) <input name="topics" placeholder="Đức tin, Cầu nguyện"></label>
        <p class="hint">Chủ đề có sẵn: ${esc(topicList)}</p>
        <label>Tóm tắt <textarea name="summary"></textarea></label>
        <label>Dàn bài (mỗi ý một dòng) <textarea name="points"></textarea></label>
        <label>Câu hỏi suy ngẫm (mỗi câu một dòng) <textarea name="questions"></textarea></label>
        <label>Lời cầu nguyện <textarea name="prayer"></textarea></label>
      </form>
      <h2 style="margin-top:20px">Đoạn mã để dán</h2>
      <pre class="code" id="json-out"></pre>
      <button id="copy" class="btn primary">Sao chép</button>
    `;
  }

  function pageSettings() {
    const st = getSettings();
    if (!isNative) {
      const apk = CONFIG.APK_URL || '';
      return `
        <h1>Nhắc nhở</h1>
        <div class="box">
          <h3>🔔 Thông báo câu Kinh Thánh mỗi ngày</h3>
          <p>Thông báo nhắc nhở hằng ngày và nhắc giờ thờ phượng Chúa Nhật có trong <strong>app cài trên điện thoại Android</strong>.
          Trình duyệt web không hẹn giờ thông báo được.</p>
          ${apk ? `<a class="btn primary" href="${esc(apk)}">⬇ Tải app Android (APK)</a>` : ''}
        </div>
        <div class="box">
          <h3>📖 Câu Kinh Thánh hôm nay</h3>
          ${(() => { const v = verseForDate(todayISO()); return v ? `<blockquote class="scripture">${esc(v.text)}<cite>${esc(v.ref)}</cite></blockquote>` : ''; })()}
        </div>`;
    }

    setTimeout(() => {
      const $ = id => document.getElementById(id);
      const status = $('notif-status');
      const save = async () => {
        const next = {
          verse: { on: $('verse-on').checked, time: $('verse-time').value || '06:00' },
          sunday: { on: $('sunday-on').checked, time: $('sunday-time').value || '07:30' },
        };
        if ((next.verse.on || next.sunday.on) && !(await ensurePermission())) {
          next.verse.on = next.sunday.on = false;
          $('verse-on').checked = $('sunday-on').checked = false;
          status.textContent = '⚠️ Chưa được cấp quyền thông báo. Hãy bật trong Cài đặt điện thoại → Ứng dụng → Immanuel HN → Thông báo.';
        } else {
          status.textContent = next.verse.on || next.sunday.on ? '✓ Đã lưu nhắc nhở.' : 'Đã tắt nhắc nhở.';
        }
        saveSettings(next);
        await scheduleReminders();
      };
      ['verse-on', 'verse-time', 'sunday-on', 'sunday-time'].forEach(id => $(id).addEventListener('change', save));
      $('test').addEventListener('click', async () => {
        status.textContent = (await sendTestNotification()) ? 'Sẽ có thông báo thử sau 3 giây…' : '⚠️ Chưa được cấp quyền thông báo.';
      });
    });

    return `
      <h1>Nhắc nhở</h1>
      <p class="lead">Thông báo được hẹn sẵn trên máy, vẫn hiện khi không có mạng.</p>
      <div class="box setting">
        <label class="switch-row"><span><strong>📖 Câu Kinh Thánh mỗi ngày</strong><br>
          <small class="meta">Câu gốc của bài tĩnh nguyện hôm đó, hoặc một câu Kinh Thánh khích lệ</small></span>
          <input type="checkbox" id="verse-on" ${st.verse.on ? 'checked' : ''}></label>
        <label class="time-row">Giờ nhắc <input type="time" id="verse-time" value="${esc(st.verse.time)}"></label>
      </div>
      <div class="box setting">
        <label class="switch-row"><span><strong>⛪ Nhắc thờ phượng Chúa Nhật</strong><br>
          <small class="meta">Mỗi sáng Chúa Nhật</small></span>
          <input type="checkbox" id="sunday-on" ${st.sunday.on ? 'checked' : ''}></label>
        <label class="time-row">Giờ nhắc <input type="time" id="sunday-time" value="${esc(st.sunday.time)}"></label>
      </div>
      <button class="btn" id="test">Gửi thông báo thử</button>
      <p class="hint" id="notif-status" role="status"></p>
    `;
  }

  const notFound = () => `<p class="empty">Không tìm thấy trang này. <a href="#/">Về trang chủ</a></p>`;

  /* ---------- router ---------- */

  const routes = [
    [/^\/?$/, () => pageHome(), 'home'],
    [/^\/chua-nhat$/, (m, p) => pageWeekly(p), 'weekly'],
    [/^\/hang-ngay$/, (m, p) => pageDaily(p), 'daily'],
    [/^\/chu-de$/, () => pageTopics(), 'topics'],
    [/^\/chu-de\/([^/]+)$/, (m, p) => pageTopic(m[1], p), 'topics'],
    [/^\/tim-kiem$/, (m, p) => pageSearch(p), ''],
    [/^\/bai\/(.+)$/, m => pageDetail(decodeURIComponent(m[1])), ''],
    [/^\/yeu-thich$/, () => pageFavorites(), 'favorites'],
    [/^\/them$/, () => pageAdd(), ''],
    [/^\/cai-dat$/, () => pageSettings(), ''],
  ];

  function render() {
    const raw = location.hash.slice(1) || '/';
    const [path, qs = ''] = raw.split('?');
    const params = new URLSearchParams(qs);
    let html = notFound(), tab = '';
    for (const [re, fn, t] of routes) {
      const m = path.match(re);
      if (m) { html = fn(m, params); tab = t; break; }
    }
    $app.innerHTML = html + `<p class="footer-note">${esc(DATA.church.name || '')} · Soli Deo Gloria · <a href="privacy.html">Quyền riêng tư</a></p>`;
    document.querySelectorAll('.tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
    window.scrollTo(0, 0);
  }

  /* ---------- data loading ---------- */

  async function fetchJSON(url, timeoutMs = 8000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { cache: 'no-cache', signal: ctl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally { clearTimeout(t); }
  }

  // In the installed app, fetch the latest data from the website (updated daily by GitHub Actions);
  // fall back to the last good copy, then to the copy bundled inside the app.
  async function loadFile(name, optional = false) {
    const sources = [];
    if (isNative && CONFIG.REMOTE_BASE) sources.push(CONFIG.REMOTE_BASE + 'data/' + name + '?t=' + Date.now());
    sources.push('data/' + name);
    for (const url of sources) {
      try {
        const j = await fetchJSON(url);
        if (url.startsWith('http')) { try { localStorage.setItem(CACHE_KEY + ':' + name, JSON.stringify(j)); } catch { /* full */ } }
        return j;
      } catch {
        if (url.startsWith('http')) {
          try { const c = JSON.parse(localStorage.getItem(CACHE_KEY + ':' + name)); if (c) return c; } catch { /* none */ }
        }
      }
    }
    if (optional) return null;
    throw new Error('không tải được ' + name);
  }

  // Manual entries (data/sermons.json) win over auto-imported YouTube entries for the same video,
  // and can hide a YouTube video with "hidden": true.
  function mergeData(base, yt) {
    const manual = (base.sermons || []).filter(s => s && (s.id || s.video));
    const byVideo = new Map();
    manual.forEach(s => { const id = youtubeId(s.video); if (id) byVideo.set(id, s); });
    const auto = ((yt && yt.videos) || []).flatMap(v => {
      const m = byVideo.get(youtubeId(v.video));
      if (!m) return [v];
      Object.keys(m).forEach(k => { if (m[k] !== '' && m[k] != null) v[k] = m[k]; });
      v.id = m.id || v.id;
      byVideo.delete(youtubeId(v.video));
      manual.splice(manual.indexOf(m), 1);
      return [v];
    });
    return [...manual, ...auto].filter(s => s.id && !s.hidden);
  }

  async function init() {
    try {
      const [base, yt, verses] = await Promise.all([
        loadFile('sermons.json'),
        loadFile('youtube.json', true),
        loadFile('verses.json', true),
      ]);
      DATA = { ...base, topics: base.topics || [], sermons: mergeData(base, yt), verses: (verses && verses.verses) || [] };
    } catch (e) {
      $app.innerHTML = `<p class="empty">Không tải được dữ liệu bài giảng (${esc(e.message)}).<br>
        Nếu mở file trực tiếp trên máy, hãy chạy: <code>python3 -m http.server</code></p>`;
      return;
    }
    window.addEventListener('hashchange', render);
    render();

    const LN = plugin('LocalNotifications');
    if (LN) {
      LN.addListener('localNotificationActionPerformed', e => {
        const route = e.notification && e.notification.extra && e.notification.extra.route;
        if (route) location.hash = route;
      });
      // Roll the reminder window forward and pick up new devotion verses.
      scheduleReminders().catch(() => {});
    }
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !isNative) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  init();
})();
