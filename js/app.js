/* Imanuel Hà Nội – Bài giảng & Tĩnh nguyện
 * Single-page app, no build step. Data lives in data/sermons.json.
 */
(() => {
  'use strict';

  const TYPES = {
    'chua-nhat': { label: 'Chúa Nhật', cls: '' },
    'hang-ngay': { label: 'Hằng ngày', cls: 'daily' },
  };
  const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const FAV_KEY = 'imanuel.favorites';

  const $app = document.getElementById('app');
  let DATA = { church: {}, topics: [], sermons: [] };

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

  const todayISO = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };

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

  /* ---------- search ---------- */

  function haystack(s) {
    if (!s._hay) {
      s._hay = norm([
        s.title, s.speaker, s.series, s.scripture, s.verse, s.summary,
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
      ${src ? `<img src="${src}" alt="" loading="lazy">` : ''}
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
        <span class="meta">${esc(s.speaker || '')}${s.date ? ' · ' + fmtDate(s.date) : ''}</span>
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
    return `
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
    const names = allTopicNames();
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
        <select id="f-type" aria-label="Loại">${opt('', 'Mọi loại', state.type)}${opt('chua-nhat', 'Chúa Nhật', state.type)}${opt('hang-ngay', 'Hằng ngày', state.type)}</select>
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
    $app.innerHTML = html + `<p class="footer-note">${esc(DATA.church.name || '')} · Soli Deo Gloria</p>`;
    document.querySelectorAll('.tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
    window.scrollTo(0, 0);
  }

  async function init() {
    try {
      const res = await fetch('data/sermons.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.status);
      DATA = await res.json();
      DATA.topics = DATA.topics || [];
      DATA.sermons = (DATA.sermons || []).filter(s => s && s.id);
    } catch (e) {
      $app.innerHTML = `<p class="empty">Không tải được dữ liệu bài giảng (${esc(e.message)}).<br>
        Nếu mở file trực tiếp trên máy, hãy chạy: <code>python3 -m http.server</code></p>`;
      return;
    }
    window.addEventListener('hashchange', render);
    render();
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  init();
})();
