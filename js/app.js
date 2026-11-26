/* Immanuel Hà Nội – Bài giảng & Tĩnh nguyện
 * Single-page app, no build step. Data lives in data/sermons.json.
 */
(() => {
  'use strict';

  // order = order of the category chips in the sermon library
  const TYPES = {
    'chua-nhat': { label: 'Chúa Nhật', cls: '' },
    'giua-tuan': { label: 'Thứ 4', cls: 'mid' },
    'thanh-thieu-nien': { label: 'Thanh Thiếu Niên', cls: 'youth' },
    'camp': { label: 'Camp', cls: 'camp' },
    'su-diep': { label: 'Sứ điệp', cls: 'guest' },
    'hang-ngay': { label: 'Tĩnh nguyện', cls: 'daily' },
    'khac': { label: 'Video khác', cls: 'other' },
  };
  const PAGE_SIZE = 24;
  const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const FAV_KEY = 'immanuel.favorites';
  const SETTINGS_KEY = 'immanuel.settings';
  const CACHE_KEY = 'immanuel.dataCache';
  const CONFIG = window.APP_CONFIG || {};

  const $app = document.getElementById('app');
  let DATA = { church: {}, topics: [], sermons: [], verses: [], moods: [], hymns: [] };

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
  const fmtDate = (iso, approx = false) => {
    if (!iso) return '';
    if (approx) { const d = parseDate(iso); return `khoảng ${d.getMonth() + 1}/${d.getFullYear()}`; }
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
        s.ai && s.ai.summary, s.ai && (s.ai.keyPoints || []).join(' '), s.ai && (s.ai.keyVerses || []).join(' '), channelName(s.channel),
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
        <span class="badge ${t.cls}">${esc(typeLabel(s))}</span>
        ${s.ai ? '<span class="ai-dot" title="Có tóm tắt">📝</span>' : ''}
        <span class="card-title">${q ? highlight(s.title, q) : esc(s.title)}</span>
        ${s.scripture ? `<span class="ref">${esc(s.scripture)}</span>` : ''}
        <span class="meta">${(() => {
          const date = s.date ? fmtDate(s.date, s.dateApprox) : '';
          const service = s.service && !date.startsWith(s.service) ? s.service : '';   // no "Thứ 4 · Thứ 4, 4/11"
          return [service, s.speaker, s.type === 'su-diep' ? '' : guestChannel(s), date].filter(Boolean).map(esc).join(' · ');
        })()}</span>
      </div>
    </a>`;
  }

  const list = (items, opts = {}) => items.length
    ? `<div class="list${opts.grid ? ' grid' : ''}">${items.map(s => card(s, opts)).join('')}</div>`
    : `<p class="empty">${opts.empty || 'Chưa có bài nào.'}</p>`;

  const topicChips = (active = '', scroll = true) => `<div class="chips${scroll ? ' scroll' : ''}">
    ${allTopicNames().filter(countByTopic).map(n => `<a class="chip${n === active ? ' on' : ''}" href="#/chu-de/${slug(n)}">${topicMeta(n).emoji} ${esc(n)}</a>`).join('')}
  </div>`;

  /* ---------- channels, moods, hymns ---------- */

  const channels = () => (DATA.church.channels || []);
  const channelName = h => ((channels().find(c => c.handle === h) || {}).name || '');
  const mainChannel = () => (channels()[0] || {}).handle;
  const guestChannel = s => (s.channel && s.channel !== mainChannel() ? channelName(s.channel) : '');
  // "Sứ điệp" videos are labelled by their channel ("Sứ điệp Mục sư Hàn Quốc")
  const typeLabel = s => (s.type === 'su-diep' && channelName(s.channel)) || (TYPES[s.type] || { label: s.type }).label;
  const moodById = id => DATA.moods.find(m => m.id === id);
  const isSermon = s => s.type !== 'khac';

  /** Which mood does a free-text sentence ("dạo này mình chán quá") describe? Longest matching phrase wins. */
  function matchMood(text) {
    const t = ' ' + norm(text).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ') + ' ';
    let best = null, bestScore = 0;
    for (const m of DATA.moods) {
      const score = (m.words || []).reduce((sum, w) => sum + (t.includes(' ' + w + ' ') ? w.length : 0), 0);
      if (score > bestScore) { best = m; bestScore = score; }
    }
    return best;
  }

  /** Sermons for a mood: AI-tagged first, then by shared topics and keywords; newer wins ties. */
  function sermonsForMood(m, limit = 8) {
    const kws = m.keywords || [];
    return DATA.sermons.filter(isSermon).map(s => {
      const hay = haystack(s);
      let score = (s.moods || []).includes(m.id) ? 10 : 0;
      score += (s.topics || []).filter(t => (m.topics || []).includes(t)).length * 2;
      score += kws.filter(k => hay.includes(k)).length;
      return { s, score };
    }).filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score || byDateDesc(a.s, b.s))
      .slice(0, limit).map(r => r.s);
  }

  /**
   * One entry per hymn: versions from different channels with the same number (or name) are grouped,
   * so a hymn has a "listen" version and, where available, a karaoke one.
   */
  function buildHymns(manual, videos) {
    // Group by song name, not number: each hymnal (HTTLVN, Báp-tít…) numbers its songs differently.
    const groups = new Map();
    const keyOf = h => norm(h.ten).replace(/[^a-z0-9]/g, '');
    const add = (g, x) => { if (x.so && !g.numbers.includes(x.so)) g.numbers.push(x.so); if (!g.so) g.so = x.so || ''; };
    for (const h of manual) {
      const g = { so: '', numbers: [], ten: h.ten, moods: h.moods || [], topics: h.topics || [], listen: h.video ? [h.video] : [], karaoke: [], sources: [] };
      add(g, h);
      groups.set(keyOf(h), g);
    }
    for (const v of videos) {
      const k = keyOf(v);
      const g = groups.get(k) || { so: '', numbers: [], ten: v.ten, moods: [], topics: [], listen: [], karaoke: [], sources: [] };
      add(g, v);
      (v.karaoke ? g.karaoke : g.listen).push(v.video);
      if (!g.sources.includes(v.source)) g.sources.push(v.source);
      groups.set(k, g);
    }
    const num = h => parseInt((h.so || '').replace(/\D/g, ''), 10) || 1e9;
    return [...groups.entries()].map(([key, g]) => ({ key, ...g, words: norm(g.ten) }))
      .sort((a, b) => num(a) - num(b) || a.ten.localeCompare(b.ten, 'vi'));
  }

  function hymnsFor({ mood = '', topics = [] } = {}) {
    const m = moodById(mood);
    const words = (m && m.hymnWords) || [];
    return DATA.hymns.filter(h => (mood && h.moods.includes(mood)) || h.topics.some(t => topics.includes(t)) ||
      words.some(w => (' ' + h.words + ' ').includes(' ' + w + ' ')));
  }
  const ytSearch = q => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
  const hymnUrl = (h, karaoke = false) => `#/thanh-ca/bai/${encodeURIComponent(h.key)}${karaoke ? '?karaoke=1' : ''}`;

  function hymnCard(h) {
    return `<div class="hymn">
      <a class="hymn-main" href="${hymnUrl(h)}">
        <span class="hymn-icon">🎵</span>
        <span><strong>${esc(h.ten)}</strong>${h.so ? `<br><small class="meta">${esc(h.so)}</small>` : ''}</span>
      </a>
      ${h.listen.length ? `<a class="hymn-btn" href="${hymnUrl(h)}" aria-label="Nghe">▶</a>` : ''}
      ${h.karaoke.length ? `<a class="hymn-btn" href="${hymnUrl(h, true)}" aria-label="Karaoke">🎤</a>` : ''}
    </div>`;
  }

  function hymnSection(m) {
    const hymns = hymnsFor({ mood: m.id, topics: m.topics || [] }).slice(0, 6);
    const term = ((m.topics || [])[0] || m.name).toLowerCase();
    return `<section class="section">
      <div class="section-head"><h2>🎵 Thánh ca gợi ý</h2><a href="#/thanh-ca?tam-trang=${m.id}">Thêm →</a></div>
      ${hymns.length ? `<div class="list">${hymns.map(hymnCard).join('')}</div>`
        : `<a class="btn" href="${ytSearch('Thánh ca Tin Lành ' + term)}" target="_blank" rel="noopener">▶ Nghe thánh ca về ${esc(term)} trên YouTube</a>`}
    </section>`;
  }

  const moodChips = (limit = 99) => `<div class="mood-grid">${DATA.moods.slice(0, limit).map(m =>
    `<a class="mood" href="#/tam-trang/${m.id}"><span>${m.emoji}</span>${esc(m.name)}</a>`).join('')}</div>`;

  /* ---------- pages ---------- */

  function pageHome() {
    const today = todayISO();
    const daily = ofType('hang-ngay').filter(s => s.date <= today);
    const sunday = ofType('chua-nhat');
    const todays = daily[0];
    const verse = verseForDate(today);
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

      ${(DATA.journeys.tracks || []).length ? (() => {
        const t = DATA.journeys.tracks.map(tr => ({ tr, i: tr.stages.findIndex((s, k) => unlocked(tr, k) && !stageProgress(tr.id, s.id).passed) }))
          .find(x => x.i >= 0) || {};
        const s = t.tr && t.tr.stages[t.i];
        return `<a class="box journey-cta" href="${s ? `#/hanh-trinh/${t.tr.id}/${s.id}` : '#/hanh-trinh'}">
          <span class="float">${s ? s.emoji : '🗺️'}</span>
          <span><strong>Hành trình Kinh Thánh</strong><br><span class="meta">${s ? `Tiếp tục: ${esc(s.title)}` : 'Bắt đầu đọc Kinh Thánh theo từng chặng'} →</span></span>
        </a>`;
      })() : ''}

      ${DATA.moods.length ? `
      <section class="section">
        <div class="section-head"><h2>Hôm nay bạn thấy thế nào?</h2><a href="#/tam-trang">Thêm →</a></div>
        ${moodChips(6)}
      </section>` : ''}

      ${todays ? `
      <section class="section">
        <div class="section-head">
          <h2>Tĩnh nguyện hôm nay</h2>
          <a href="#/hang-ngay">Xem tất cả →</a>
        </div>
          <div class="box">
            <span class="meta">${fmtDate(todays.date)}${todays.date !== today ? ' (bài gần nhất)' : ''}</span>
            <h3 style="margin-top:4px">${esc(todays.title)}</h3>
            ${todays.verse ? `<blockquote class="scripture">${esc(todays.verse)}<cite>${esc(todays.scripture)}</cite></blockquote>` : ''}
            <a class="btn primary" href="#/bai/${encodeURIComponent(todays.id)}">Đọc &amp; xem video</a>
          </div>
      </section>` : ''}

      <section class="section">
        <div class="section-head">
          <h2>Bài giảng Chúa Nhật mới nhất</h2>
          <a href="#/bai-giang?loai=chua-nhat">Xem tất cả →</a>
        </div>
        ${sunday[0] ? card(sunday[0], { hero: true }) : '<p class="empty">Chưa có bài giảng.</p>'}
      </section>

      ${['camp', 'su-diep', 'giua-tuan', 'thanh-thieu-nien'].map(type => {
        const items = ofType(type).slice(0, 2);
        return items.length ? `<section class="section">
          <div class="section-head"><h2>${esc(type === 'su-diep' ? typeLabel(items[0]) : TYPES[type].label + ' gần đây')}</h2>
            <a href="#/bai-giang?loai=${type}">Xem tất cả →</a></div>
          ${list(items, { grid: true })}
        </section>` : '';
      }).join('')}

      <section class="section">
        <div class="section-head"><h2>Tìm theo chủ đề</h2><a href="#/chu-de">Tất cả →</a></div>
        ${topicChips()}
      </section>

      ${sunday.length > 1 ? `
      <section class="section">
        <div class="section-head"><h2>Các tuần trước</h2></div>
        ${list(sunday.slice(1, 5), { grid: true })}
      </section>` : ''}
    `;
  }

  /** All sermons with category chips (Chúa Nhật / Thứ 4 / Camp / Sứ điệp …) and "Xem thêm" paging. */
  function pageLibrary(params) {
    const type = params.get('loai') || '';
    const page = Math.max(1, +params.get('trang') || 1);
    const present = Object.keys(TYPES).filter(t => DATA.sermons.some(s => s.type === t));
    const all = DATA.sermons.filter(s => (type ? s.type === type : isSermon(s))).sort(byDateDesc);
    const shown = all.slice(0, page * PAGE_SIZE);
    const label = t => (t === 'su-diep' ? (channels().find(c => c.type === 'su-diep') || {}).name || TYPES[t].label : TYPES[t].label);
    const url = (t, p) => '#/bai-giang' + (t || p > 1 ? '?' + new URLSearchParams({ ...(t ? { loai: t } : {}), ...(p > 1 ? { trang: p } : {}) }) : '');
    setTimeout(() => {
      const more = document.getElementById('more');
      // keep the scroll position when loading more
      more && more.addEventListener('click', e => { e.preventDefault(); const y = scrollY; history.replaceState(null, '', url(type, page + 1)); render(); scrollTo(0, y); });
    });
    return `
      <h1>Bài giảng</h1>
      <div class="chips scroll" style="margin-bottom:10px">
        <a class="chip${!type ? ' on' : ''}" href="${url('')}">Tất cả</a>
        ${present.map(t => `<a class="chip${t === type ? ' on' : ''}" href="${url(t)}">${esc(label(t))} <span class="n">${DATA.sermons.filter(s => s.type === t).length}</span></a>`).join('')}
      </div>
      <p class="lead"><a href="#/chu-de">🗂 Theo chủ đề</a> · <a href="#/tim-kiem">🔍 Tìm kiếm</a> · <a href="#/tam-trang">💛 Theo tâm trạng</a></p>
      <p class="result-count">${all.length} bài</p>
      ${list(shown, { grid: true })}
      ${shown.length < all.length ? `<p style="text-align:center"><a id="more" class="btn" href="${url(type, page + 1)}">Xem thêm (${all.length - shown.length})</a></p>` : ''}
    `;
  }

  function pageMoods(params) {
    const q = params.get('q') || '';
    const found = q ? matchMood(q) : null;
    if (found) { setTimeout(() => location.replace('#/tam-trang/' + found.id)); return ''; }
    setTimeout(() => {
      const f = document.getElementById('feel');
      f && f.addEventListener('submit', e => { e.preventDefault(); location.hash = '#/tam-trang?q=' + encodeURIComponent(f.q.value); });
    });
    return `
      <h1>Hôm nay bạn thấy thế nào?</h1>
      <p class="lead">Chọn cảm xúc gần nhất, hoặc kể vài chữ — app sẽ gợi ý câu Kinh Thánh, sứ điệp và thánh ca phù hợp.</p>
      <form id="feel" class="feel">
        <input name="q" value="${esc(q)}" placeholder="Ví dụ: dạo này mình thấy chán nản, mệt mỏi…" autocomplete="off" enterkeyhint="search">
        <button class="btn primary">Tìm</button>
      </form>
      ${q ? `<p class="hint">Mình chưa hiểu rõ “${esc(q)}”. Bạn chọn cảm xúc gần nhất bên dưới nhé, hoặc <a href="#/tim-kiem?q=${encodeURIComponent(q)}">tìm bài giảng có từ này</a>.</p>` : ''}
      ${moodChips()}
    `;
  }

  function pageMood(id) {
    const m = moodById(id);
    if (!m) return notFound();
    const sermons = sermonsForMood(m);
    return `
      <p class="crumb"><a href="#/tam-trang">← Cảm xúc khác</a></p>
      <h1>${m.emoji} ${esc(m.name)}</h1>
      <p class="mood-message">${esc(m.message)}</p>
      ${m.care ? `<div class="box care">
        <strong>💛 Bạn không đơn độc.</strong>
        <p>Nếu cảm giác này kéo dài nhiều tuần, hãy chia sẻ với Mục sư, người bạn tin cậy, hoặc gặp bác sĩ — tìm sự giúp đỡ là điều đúng đắn và can đảm.
        Nếu bạn có ý nghĩ làm hại bản thân, hãy gọi <a href="tel:115"><strong>115</strong></a> hoặc đến cơ sở y tế gần nhất ngay.</p>
      </div>` : ''}
      <section class="section">
        <h2>📖 Lời Chúa cho bạn</h2>
        ${(m.verses || []).map(v => `<blockquote class="scripture">${esc(v.text)}<cite>${esc(v.ref)}</cite></blockquote>`).join('')}
      </section>
      <section class="section">
        <div class="section-head"><h2>🎧 Sứ điệp dành cho bạn</h2></div>
        ${list(sermons, { grid: true, empty: 'Chưa tìm được bài giảng phù hợp — hãy xem các bài giảng mới nhất.' })}
      </section>
      ${hymnSection(m)}
    `;
  }

  function pageHymns(params) {
    const mood = params.get('tam-trang') || '';
    const karaoke = params.get('karaoke') === '1';
    const q = params.get('q') || '';
    const page = Math.max(1, +params.get('trang') || 1);
    let hymns = mood ? hymnsFor({ mood, topics: (moodById(mood) || {}).topics || [] }) : DATA.hymns;
    if (karaoke) hymns = hymns.filter(h => h.karaoke.length);
    if (q) {
      const n = norm(q).trim();
      hymns = hymns.filter(h => (/^\d+$/.test(n) ? h.numbers.some(x => x.replace(/\D/g, '') === n) : h.words.includes(n)));
    }
    const shown = hymns.slice(0, page * 40);
    const url = extra => {
      const p = { ...(mood ? { 'tam-trang': mood } : {}), ...(karaoke ? { karaoke: 1 } : {}), ...(q ? { q } : {}), ...extra };
      Object.keys(p).forEach(k => p[k] === '' && delete p[k]);
      return '#/thanh-ca' + (Object.keys(p).length ? '?' + new URLSearchParams(p) : '');
    };
    setTimeout(() => {
      const f = document.getElementById('hymn-search');
      f && f.addEventListener('submit', e => { e.preventDefault(); location.hash = url({ q: f.q.value }); });
      const more = document.getElementById('more');
      more && more.addEventListener('click', e => { e.preventDefault(); const y = scrollY; history.replaceState(null, '', url({ trang: page + 1 })); render(); scrollTo(0, y); });
    });
    return `
      <h1>Thánh ca</h1>
      <form id="hymn-search" class="feel">
        <input name="q" value="${esc(q)}" placeholder="Số bài hoặc tên bài…" inputmode="search" autocomplete="off">
        <button class="btn primary">Tìm</button>
      </form>
      <div class="seg" style="margin-bottom:10px">
        <a class="${!karaoke ? 'on' : ''}" href="${url({ karaoke: '' })}">🎧 Nghe</a>
        <a class="${karaoke ? 'on' : ''}" href="${url({ karaoke: 1 })}">🎤 Karaoke</a>
      </div>
      <div class="chips scroll" style="margin-bottom:12px">
        <a class="chip${!mood ? ' on' : ''}" href="#/thanh-ca${karaoke ? '?karaoke=1' : ''}">Tất cả</a>
        ${DATA.moods.map(m => `<a class="chip${m.id === mood ? ' on' : ''}" href="#/thanh-ca?tam-trang=${m.id}${karaoke ? '&karaoke=1' : ''}">${m.emoji} ${esc(m.name)}</a>`).join('')}
      </div>
      ${DATA.hymns.length
        ? `<p class="result-count">${hymns.length} bài</p>
           ${shown.length ? `<div class="list">${shown.map(hymnCard).join('')}</div>` : '<p class="empty">Không có bài phù hợp.</p>'}
           ${shown.length < hymns.length ? `<p style="text-align:center"><a id="more" class="btn" href="${url({ trang: page + 1 })}">Xem thêm (${hymns.length - shown.length})</a></p>` : ''}`
        : `<div class="box"><p>Danh sách thánh ca đang được cập nhật từ YouTube. Trong lúc chờ, bạn có thể nghe theo chủ đề:</p>
            <div class="chips">${DATA.moods.map(m => `<a class="chip" target="_blank" rel="noopener" href="${ytSearch('Thánh ca Tin Lành ' + ((m.topics || [])[0] || m.name).toLowerCase())}">${m.emoji} ${esc(((m.topics || [])[0] || m.name))}</a>`).join('')}</div></div>`}
    `;
  }

  /** One hymn: plays inside the app; switch between the listening and karaoke versions. */
  function pageHymn(key, params) {
    const h = DATA.hymns.find(x => x.key === key);
    if (!h) return notFound();
    const wantKaraoke = params.get('karaoke') === '1' && h.karaoke.length;
    const versions = wantKaraoke ? h.karaoke : (h.listen.length ? h.listen : h.karaoke);
    const i = Math.min(+params.get('ban') || 0, versions.length - 1);
    const vid = youtubeId(versions[i] || '');
    const moods = DATA.moods.filter(m => hymnsFor({ mood: m.id, topics: m.topics || [] }).includes(h));
    return `
      <p class="crumb"><a href="#/thanh-ca">← Thánh ca</a></p>
      <div class="player">${vid ? `<iframe src="https://www.youtube-nocookie.com/embed/${vid}?rel=0" title="${esc(h.ten)}" allow="autoplay; encrypted-media; picture-in-picture; web-share" allowfullscreen></iframe>` : ''}</div>
      <h1>${esc(h.ten)}</h1>
      ${h.so ? `<p class="meta">${esc(h.so)}</p>` : ''}
      <div class="seg" style="margin:8px 0 12px">
        ${h.listen.length ? `<a class="${!wantKaraoke ? 'on' : ''}" href="${hymnUrl(h)}">🎧 Nghe</a>` : ''}
        ${h.karaoke.length ? `<a class="${wantKaraoke ? 'on' : ''}" href="${hymnUrl(h, true)}">🎤 Karaoke</a>` : ''}
      </div>
      ${versions.length > 1 ? `<div class="chips">${versions.map((v, n) => `<a class="chip${n === i ? ' on' : ''}" href="${hymnUrl(h, wantKaraoke)}${wantKaraoke ? '&' : '?'}ban=${n}">Bản ${n + 1}</a>`).join('')}</div>` : ''}
      ${moods.length ? `<p class="meta" style="margin-top:14px">💛 Dành cho khi bạn: ${moods.map(m => `<a href="#/tam-trang/${m.id}">${m.emoji} ${esc(m.name.toLowerCase())}</a>`).join(', ')}</p>` : ''}
      ${vid ? `<p><a class="btn" href="https://www.youtube.com/watch?v=${vid}" target="_blank" rel="noopener">▶ Mở trên YouTube</a></p>` : ''}
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
        ${guestChannel(s) ? `<span>📺 ${esc(guestChannel(s))}</span>` : ''}
        ${s.date ? `<span>📅 ${fmtDate(s.date, s.dateApprox)}</span>` : ''}
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

      ${s.ai ? `<div class="box ai-box">
        <h3>📝 Tóm tắt sứ điệp</h3>
        <p>${esc(s.ai.summary)}</p>
        ${(s.ai.keyPoints || []).length ? `<h4>Ý chính</h4><ul>${s.ai.keyPoints.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
        ${(s.ai.keyVerses || []).length ? `<h4>Câu Kinh Thánh</h4><div class="chips">${s.ai.keyVerses.map(v => `<a class="chip" href="#/tim-kiem?q=${encodeURIComponent(v)}">📖 ${esc(v)}</a>`).join('')}</div>` : ''}
        ${s.ai.application ? `<h4>Áp dụng</h4><p>${esc(s.ai.application)}</p>` : ''}
        <p class="hint">Tóm tắt tự động bằng AI từ phụ đề video${s.ai.transcriptQuality === 'kem' ? ' (phụ đề chất lượng thấp)' : ''} — có thể chưa chính xác hoàn toàn.</p>
      </div>` : ''}
      ${(s.moods || []).length ? `<p class="meta">💛 Dành cho khi bạn: ${s.moods.map(moodById).filter(Boolean).map(m => `<a href="#/tam-trang/${m.id}">${m.emoji} ${esc(m.name.toLowerCase())}</a>`).join(', ')}</p>` : ''}

      <div class="prose">
        ${s.summary && !s.ai ? `<p>${esc(s.summary)}</p>` : ''}
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

  /* ---------- Bible journey (data/journeys.json) ---------- */

  const JOURNEY_KEY = 'immanuel.journey';
  const getProgress = () => { try { return JSON.parse(localStorage.getItem(JOURNEY_KEY)) || {}; } catch { return {}; } };
  const saveProgress = p => { try { localStorage.setItem(JOURNEY_KEY, JSON.stringify(p)); } catch { /* private mode */ } };
  const stageProgress = (t, s) => ((getProgress()[t] || {})[s]) || { read: [], best: 0, passed: false };
  function updateStage(t, s, fn) {
    const p = getProgress();
    p[t] = p[t] || {};
    p[t][s] = fn({ read: [], best: 0, passed: false, ...(p[t][s] || {}) });
    saveProgress(p);
  }
  const trackById = id => ((DATA.journeys || {}).tracks || []).find(t => t.id === id);
  const bookName = code => (((DATA.journeys || {}).books || []).find(b => b.code === code) || {}).name || code;
  const unlocked = (track, i) => i === 0 || stageProgress(track.id, track.stages[i - 1].id).passed;
  const doneCount = track => track.stages.filter(s => stageProgress(track.id, s.id).passed).length;
  const stars = score => (score >= 1 ? 3 : score >= 0.8 ? 2 : score >= 0.6 ? 1 : 0);
  const starStr = n => '★'.repeat(n) + '☆'.repeat(3 - n);

  // Bible text: data/bible/<BOOK>.json, fetched once per book
  const bibleCache = {};
  async function loadBook(code) {
    if (!(code in bibleCache)) bibleCache[code] = loadFile(`bible/${code}.json`, true).catch(() => null);
    return bibleCache[code];
  }
  const bibleLink = (code, ch) => `https://www.bible.com/bible/193/${code}.${ch}`;
  const readUrl = (code, ch, back = '') => `#/doc/${code}/${ch}${back ? '?ht=' + encodeURIComponent(back) : ''}`;

  // Sermons from the church whose main scripture is in one of the stage's books
  function sermonsForBooks(codes, limit = 4) {
    const names = codes.map(c => norm(bookName(c)));
    const alias = { ACT: ['cong vu'], PSA: ['thi thien'] };
    return DATA.sermons.filter(s => {
      if (!s.scripture || !isSermon(s)) return false;
      const ref = norm(s.scripture);
      return codes.some((c, i) => ref.startsWith(names[i] + ' ') || (alias[c] || []).some(a => ref.startsWith(a + ' ')));
    }).sort(byDateDesc).slice(0, limit);
  }

  function pageJourneys() {
    const tracks = (DATA.journeys || {}).tracks || [];
    return `
      <h1>Hành trình Kinh Thánh</h1>
      <p class="lead">Đọc Kinh Thánh theo từng chặng. Mỗi chặng có bài đọc, câu gốc, bài giảng liên quan và một bài kiểm tra nhỏ — đúng từ 4/5 câu để mở chặng tiếp theo.</p>
      <div class="track-list">
        ${tracks.map(t => {
          const done = doneCount(t), total = t.stages.length;
          const next = t.stages.find((s, i) => unlocked(t, i) && !stageProgress(t.id, s.id).passed);
          return `<a class="track-card" href="#/hanh-trinh/${t.id}">
            <span class="track-emoji">${t.emoji}</span>
            <span class="track-body">
              <strong>${esc(t.title)}</strong>
              <span class="meta">${esc(t.desc)}</span>
              <span class="bar"><span style="width:${Math.round(done / total * 100)}%"></span></span>
              <span class="meta">${done}/${total} chặng${next ? ` · Tiếp theo: ${esc(next.title)}` : ' · Đã hoàn thành 🎉'}</span>
            </span>
          </a>`;
        }).join('')}
      </div>`;
  }

  function pageTrack(trackId) {
    const t = trackById(trackId);
    if (!t) return notFound();
    let era = '';
    setTimeout(() => { const cur = document.querySelector('.node.current'); cur && cur.scrollIntoView({ block: 'center' }); });
    return `
      <p class="crumb"><a href="#/hanh-trinh">← Hành trình</a></p>
      <h1>${t.emoji} ${esc(t.title)}</h1>
      <p class="lead">${doneCount(t)}/${t.stages.length} chặng đã hoàn thành</p>
      <div class="path">
        ${t.stages.map((s, i) => {
          const p = stageProgress(t.id, s.id);
          const open = unlocked(t, i);
          const state = p.passed ? 'done' : open ? 'current' : 'locked';
          const head = s.era !== era ? `<div class="era">${esc(era = s.era)}</div>` : '';
          return `${head}<a class="node ${state} ${i % 2 ? 'right' : 'left'}" href="${open ? `#/hanh-trinh/${t.id}/${s.id}` : '#/hanh-trinh/' + t.id}" ${open ? '' : 'aria-disabled="true"'}>
            <span class="node-dot">${state === 'locked' ? '🔒' : s.emoji}</span>
            <span class="node-label"><small>Chặng ${i + 1}</small>${esc(s.title)}${p.passed ? `<span class="stars">${starStr(stars(p.best))}</span>` : ''}</span>
          </a>`;
        }).join('')}
      </div>`;
  }

  function pageStage(trackId, stageId) {
    const t = trackById(trackId);
    const i = t ? t.stages.findIndex(s => s.id === stageId) : -1;
    if (i < 0) return notFound();
    const s = t.stages[i];
    if (!unlocked(t, i)) return `<p class="empty">🔒 Hãy hoàn thành chặng trước để mở chặng này. <a href="#/hanh-trinh/${t.id}">Về bản đồ</a></p>`;
    const p = stageProgress(t.id, s.id);
    const books = [...new Set(s.readings.map(r => r.book))];
    const sermons = sermonsForBooks(books);
    const back = `${t.id}/${s.id}`;
    const v = s.verse;
    setTimeout(async () => {      // fill the key verse from the Bible text when it is available
      const el = document.getElementById('key-verse');
      if (!el || (v.text && !v.v)) return;
      const book = await loadBook(v.book);
      const text = book && (book.chapters[v.ch - 1] || []).slice(v.v[0] - 1, v.v[1]).join(' ');
      if (text) el.textContent = text;
      else if (!v.text) el.closest('blockquote').classList.add('ref-only');
    });
    return `
      <p class="crumb"><a href="#/hanh-trinh/${t.id}">← ${esc(t.title)}</a></p>
      <div class="stage-hero"><span class="float">${s.emoji}</span></div>
      <p class="meta">Chặng ${i + 1}/${t.stages.length} · ${esc(s.era)}</p>
      <h1>${esc(s.title)}</h1>
      <p>${esc(s.intro)}</p>
      <blockquote class="scripture"><span id="key-verse">${esc(v.text || '')}</span><cite>${esc(v.ref)}</cite></blockquote>
      <section class="section">
        <h2>📖 Bài đọc</h2>
        <div class="list">
          ${s.readings.map((r, k) => {
            const read = p.read.includes(k);
            return `<a class="reading${read ? ' read' : ''}" href="${readUrl(r.book, r.from, back + '/' + k)}">
              <span class="check">${read ? '✓' : k + 1}</span><span>${esc(r.label)}</span><span class="hymn-go">›</span></a>`;
          }).join('')}
        </div>
        <p class="hint">${p.read.length}/${s.readings.length} bài đã đọc</p>
      </section>
      ${sermons.length ? `<section class="section"><div class="section-head"><h2>🎧 Bài giảng liên quan</h2></div>${list(sermons, { grid: true })}</section>` : ''}
      <section class="section quiz-cta">
        ${p.passed ? `<p>✅ Bạn đã qua chặng này <span class="stars">${starStr(stars(p.best))}</span></p>` : ''}
        <a class="btn primary big" href="#/hanh-trinh/${t.id}/${s.id}/kiem-tra">${p.passed ? 'Làm lại bài kiểm tra' : '🎯 Làm bài kiểm tra'}</a>
        ${p.passed && t.stages[i + 1] ? `<a class="btn" href="#/hanh-trinh/${t.id}/${t.stages[i + 1].id}">Chặng tiếp theo →</a>` : ''}
      </section>`;
  }

  // Quiz state lives in memory while the quiz page is open
  let quiz = null;
  function pageQuiz(trackId, stageId) {
    const t = trackById(trackId);
    const i = t ? t.stages.findIndex(s => s.id === stageId) : -1;
    if (i < 0 || !unlocked(t, i)) return notFound();
    const s = t.stages[i];
    if (!quiz || quiz.key !== `${t.id}/${s.id}`) quiz = { key: `${t.id}/${s.id}`, n: 0, picked: null, correct: 0 };
    const pass = (DATA.journeys.passScore || 0.8);

    if (quiz.n >= s.quiz.length) {               // result screen
      const score = quiz.correct / s.quiz.length;
      const passed = score >= pass;
      const st = stars(score);
      updateStage(t.id, s.id, p => ({ ...p, best: Math.max(p.best || 0, score), passed: p.passed || passed }));
      const next = t.stages[i + 1];
      quiz = null;
      return `
        <div class="result ${passed ? 'win' : ''}">
          ${passed ? `<div class="confetti">${Array.from({ length: 24 }, (_, k) => `<i style="--x:${(k * 37) % 100}%;--d:${(k % 6) * 0.15}s">${['🎉', '⭐', '✨', '🕊️'][k % 4]}</i>`).join('')}</div>` : ''}
          <div class="result-emoji">${passed ? '🏆' : '💪'}</div>
          <h1>${passed ? 'Tuyệt vời!' : 'Cố lên nhé!'}</h1>
          <p class="big-score">${Math.round(score * s.quiz.length)}/${s.quiz.length} câu đúng</p>
          <p class="stars big">${starStr(st)}</p>
          <p>${passed ? (next ? `Bạn đã mở khóa chặng “${esc(next.title)}”.` : 'Bạn đã hoàn thành cả hành trình! Ha-lê-lu-gia! 🙌')
            : `Cần đúng ít nhất ${Math.ceil(pass * s.quiz.length)} câu để qua chặng. Đọc lại bài và thử lần nữa nhé.`}</p>
          <div class="actions" style="justify-content:center">
            ${passed && next ? `<a class="btn primary big" href="#/hanh-trinh/${t.id}/${next.id}">Chặng tiếp theo →</a>` : ''}
            <a class="btn" href="#/hanh-trinh/${t.id}/${s.id}/kiem-tra" onclick="setTimeout(()=>dispatchEvent(new HashChangeEvent('hashchange')))">↺ Làm lại</a>
            <a class="btn" href="#/hanh-trinh/${t.id}">Bản đồ</a>
          </div>
        </div>`;
    }

    const q = s.quiz[quiz.n];
    const pics = q.options.every(o => o.img);
    setTimeout(() => {
      document.querySelectorAll('.opt').forEach(b => b.addEventListener('click', () => {
        if (quiz.picked !== null) return;
        quiz.picked = +b.dataset.i;
        if (quiz.picked === q.a) quiz.correct++;
        const y = scrollY; render(); scrollTo(0, y);
        const fb = document.querySelector('.feedback');      // bring the explanation and "next" button into view
        fb && fb.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }));
      const nx = document.getElementById('next-q');
      nx && nx.addEventListener('click', () => { quiz.n++; quiz.picked = null; render(); });
    });
    const answered = quiz.picked !== null;
    return `
      <p class="crumb"><a href="#/hanh-trinh/${t.id}/${s.id}">✕ Thoát</a></p>
      <div class="qbar">${s.quiz.map((_, k) => `<span class="${k < quiz.n ? 'done' : k === quiz.n ? 'now' : ''}"></span>`).join('')}</div>
      <p class="meta">Câu ${quiz.n + 1}/${s.quiz.length}</p>
      <h2 class="question">${esc(q.q)}</h2>
      <div class="${pics ? 'opts pics' : 'opts'}">
        ${q.options.map((o, k) => {
          const cls = !answered ? '' : k === q.a ? ' right' : k === quiz.picked ? ' wrong' : ' dim';
          return `<button class="opt${cls}" data-i="${k}" ${answered ? 'disabled' : ''} style="--i:${k}">
            ${o.img ? `<span class="opt-img">${o.img}</span>` : ''}<span>${esc(o.t)}</span></button>`;
        }).join('')}
      </div>
      ${answered ? `<div class="feedback ${quiz.picked === q.a ? 'ok' : 'no'}">
        <strong>${quiz.picked === q.a ? '🎉 Chính xác!' : '💡 Chưa đúng'}</strong>
        <p>${esc(q.why)}</p><p class="ref">📖 ${esc(q.ref)}</p>
        <button id="next-q" class="btn primary big">${quiz.n + 1 < s.quiz.length ? 'Câu tiếp theo →' : 'Xem kết quả'}</button>
      </div>` : ''}`;
  }

  function pageRead(code, ch, params) {
    ch = +ch;
    const back = params.get('ht') || '';            // "track/stage/readingIndex" when opened from a journey
    const [tId, sId, rIdx] = back.split('/');
    const total = ((((DATA.journeys || {}).books || []).find(b => b.code === code)) || {}).chapters || ch;
    setTimeout(async () => {
      const box = document.getElementById('bible-text');
      const book = await loadBook(code);
      const verses = book && book.chapters[ch - 1];
      box.innerHTML = verses && verses.length
        ? verses.map((v, k) => v ? `<p class="verse"><sup>${k + 1}</sup>${esc(v)}</p>` : '').join('')
        : `<div class="box"><p>Bản Kinh Thánh trong app đang được cập nhật. Bạn có thể đọc chương này trên bible.com (bản Truyền Thống 1925):</p>
            <a class="btn primary" href="${bibleLink(code, ch)}" target="_blank" rel="noopener">📖 Đọc ${esc(bookName(code))} ${ch}</a></div>`;
      const mark = document.getElementById('mark-read');
      mark && mark.addEventListener('click', () => {
        updateStage(tId, sId, p => ({ ...p, read: [...new Set([...(p.read || []), +rIdx])] }));
        location.hash = `#/hanh-trinh/${tId}/${sId}`;
      });
    });
    const nav = (n, label) => (n >= 1 && n <= total ? `<a class="btn" href="${readUrl(code, n, back)}">${label}</a>` : '<span></span>');
    return `
      ${back ? `<p class="crumb"><a href="#/hanh-trinh/${tId}/${sId}">← Về chặng</a></p>` : ''}
      <h1>${esc(bookName(code))} ${ch}</h1>
      <div id="bible-text" class="bible"><p class="loading">Đang tải…</p></div>
      <div class="read-nav">${nav(ch - 1, '← Chương trước')}${nav(ch + 1, 'Chương sau →')}</div>
      ${back ? `<button id="mark-read" class="btn primary big" style="width:100%;margin-top:14px">✓ Tôi đã đọc xong</button>` : ''}
      <p class="hint">Kinh Thánh Tiếng Việt, Bản Truyền Thống 1926.</p>`;
  }

  const notFound = () => `<p class="empty">Không tìm thấy trang này. <a href="#/">Về trang chủ</a></p>`;

  /* ---------- router ---------- */

  const routes = [
    [/^\/?$/, () => pageHome(), 'home'],
    [/^\/bai-giang$/, (m, p) => pageLibrary(p), 'library'],
    [/^\/chua-nhat$/, () => pageLibrary(new URLSearchParams('loai=chua-nhat')), 'library'],
    [/^\/tam-trang$/, (m, p) => pageMoods(p), 'moods'],
    [/^\/tam-trang\/([\w-]+)$/, m => pageMood(m[1]), 'moods'],
    [/^\/thanh-ca$/, (m, p) => pageHymns(p), 'hymns'],
    [/^\/thanh-ca\/bai\/([^/]+)$/, (m, p) => pageHymn(decodeURIComponent(m[1]), p), 'hymns'],
    [/^\/hang-ngay$/, (m, p) => pageDaily(p), 'library'],
    [/^\/chu-de$/, () => pageTopics(), 'library'],
    [/^\/chu-de\/([^/]+)$/, (m, p) => pageTopic(m[1], p), 'library'],
    [/^\/tim-kiem$/, (m, p) => pageSearch(p), ''],
    [/^\/bai\/(.+)$/, m => pageDetail(decodeURIComponent(m[1])), ''],
    [/^\/yeu-thich$/, () => pageFavorites(), ''],
    [/^\/hanh-trinh$/, () => pageJourneys(), 'journey'],
    [/^\/hanh-trinh\/([\w-]+)$/, m => pageTrack(m[1]), 'journey'],
    [/^\/hanh-trinh\/([\w-]+)\/([\w-]+)$/, m => pageStage(m[1], m[2]), 'journey'],
    [/^\/hanh-trinh\/([\w-]+)\/([\w-]+)\/kiem-tra$/, m => pageQuiz(m[1], m[2]), 'journey'],
    [/^\/doc\/(\w{3})\/(\d+)$/, (m, p) => pageRead(m[1], m[2], p), 'journey'],
    [/^\/them$/, () => pageAdd(), ''],
    [/^\/cai-dat$/, () => pageSettings(), ''],
  ];

  function render() {
    const raw = location.hash.slice(1) || '/';
    const [path, qs = ''] = raw.split('?');
    const params = new URLSearchParams(qs);
    if (!path.endsWith('/kiem-tra')) quiz = null;   // leaving a quiz starts it over next time
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

  // AI summaries (data/ai.json) add a summary, extra topics, moods and sometimes the speaker.
  function applyAI(sermons, ai) {
    const items = (ai && ai.items) || {};
    for (const s of sermons) {
      const it = items[s.id];
      if (!it || it.status !== 'ok') continue;
      s.ai = it;
      s.topics = [...new Set([...(s.topics || []), ...(it.topics || [])])];
      s.moods = it.moods || [];
      if (!s.speaker && it.speaker) s.speaker = it.speaker;
    }
    return sermons;
  }

  async function init() {
    try {
      const [base, yt, verses, moods, hymns, hymnVids, ai, journeys] = await Promise.all([
        loadFile('sermons.json'),
        loadFile('youtube.json', true),
        loadFile('verses.json', true),
        loadFile('moods.json', true),
        loadFile('hymns.json', true),
        loadFile('hymn-videos.json', true),
        loadFile('ai.json', true),
        loadFile('journeys.json', true),
      ]);
      DATA = {
        ...base, topics: base.topics || [], sermons: applyAI(mergeData(base, yt), ai),
        verses: (verses && verses.verses) || [], moods: (moods && moods.moods) || [], hymns: buildHymns((hymns && hymns.hymns) || [], (hymnVids && hymnVids.videos) || []),
        journeys: journeys || { tracks: [], books: [] },
      };
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
