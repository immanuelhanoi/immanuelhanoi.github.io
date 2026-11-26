#!/usr/bin/env node
/**
 * Lấy video mới từ kênh YouTube của Hội thánh và ghi vào data/youtube.json.
 *
 *  - Không cần khoá: đọc RSS của kênh (15 video mới nhất). Chạy hằng ngày nên
 *    video cũ vẫn được giữ lại trong file, danh sách lớn dần theo thời gian.
 *  - Có biến môi trường YOUTUBE_API_KEY: dùng YouTube Data API để lấy TOÀN BỘ
 *    video của kênh (kể cả video cũ) và cả thời lượng.
 *
 * Mỗi video được tự động phân loại (Chúa Nhật / Hằng ngày / Khác), gắn chủ đề
 * theo từ khoá, tìm câu Kinh Thánh và tên diễn giả trong tiêu đề / mô tả.
 *
 *   node scripts/sync-youtube.mjs                  # chạy thật
 *   node scripts/sync-youtube.mjs --fixture f.xml  # thử với file RSS có sẵn
 */
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data/youtube.json');
const TZ = 'Asia/Ho_Chi_Minh';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const args = process.argv.slice(2);
const fixture = args.includes('--fixture') ? args[args.indexOf('--fixture') + 1] : null;
const offline = args.includes('--offline');   // don't fetch; just re-derive stored videos with the current rules
const outPath = args.includes('--out') ? path.resolve(args[args.indexOf('--out') + 1]) : OUT;

/* ---------------- text helpers ---------------- */

export const norm = (s = '') => String(s)
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

const decodeXml = (s = '') => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? decodeXml(m[1].trim()) : '';
};
const attr = (xml, name, a) => {
  const m = xml.match(new RegExp(`<${name}\\s[^>]*?${a}="([^"]*)"`));
  return m ? decodeXml(m[1]) : '';
};

const localDate = d => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const isSunday = d => new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(d) === 'Sun';

function isoDuration(s = '') {
  const m = s.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return '';
  const h = (+m[1] || 0) * 24 + (+m[2] || 0), mi = +m[3] || 0, se = +m[4] || 0;
  if (!h && !mi && !se) return '';
  const p = n => String(n).padStart(2, '0');
  return h ? `${h}:${p(mi)}:${p(se)}` : `${mi}:${p(se)}`;
}

/* ---------------- classification ---------------- */

const DAILY = /tinh nguyen|hang ngay|moi ngay|linh luong|daily|devotion|suy gam|suy ngam/;
const SUNDAY = /chua nhat|chu nhat|tho phuong|le thanh chua nhat|sunday|bai giang|giang luan/;
const OTHER = /thanh ca|biet thanh ca|ton vinh|hop xuong|lyric|\bmv\b|music|thong bao|trailer|teaser|highlight|hau truong|livestream test/;

export function classify(v) {
  const t = norm(v.title);
  if (v.isShort) return 'khac';
  const service = norm(parseTitle(v.title).service);
  if (/^le( |$)/.test(service) || /chua nhat|chu nhat/.test(service)) return 'chua-nhat';  // "Lễ 1", "Lễ tạ ơn"
  if (/^thu [2-7]/.test(service)) return 'hang-ngay';                                       // "Thứ 4" mid-week service
  if (DAILY.test(t)) return 'hang-ngay';
  if (SUNDAY.test(t)) return 'chua-nhat';
  if (OTHER.test(t)) return 'khac';
  if (v.at && isSunday(v.at)) return 'chua-nhat';
  return 'hang-ngay';
}

const TOPIC_WORDS = {
  'Đức tin': ['duc tin', 'tin cay', 'tin nhan chua', 'tiep nhan'],
  'Cầu nguyện': ['cau nguyen', 'nai xin', 'cau thay'],
  'Ân điển': ['an dien', 'cuu roi', 'thap tu', 'thap gia', 'chuoc', 'cuu chuoc'],
  'Tình yêu thương': ['yeu thuong', 'tinh yeu', 'yeu nhau'],
  'Gia đình': ['gia dinh', 'hon nhan', 'vo chong', 'cha me', 'con cai'],
  'Tạ ơn': ['ta on', 'biet on', 'cam ta'],
  'Hy vọng': ['hy vong', 'hi vong', 'trong cay', 'trong doi'],
  'Lời Chúa': ['loi chua', 'loi hang song', 'loi cua chua'],
  'Sự bình an': ['binh an', 'lo lang', 'so hai', 'lo au'],
  'Ăn năn & tha thứ': ['an nan', 'tha thu', 'xung toi', 'toi loi'],
  'Truyền giáo': ['truyen giao', 'truyen dao', 'phuc am', 'lam chung', 'dai mang lenh'],
  'Môn đồ': ['mon do', 'hau viec', 'phuc vu chua', 'theo chua', 'bong trai', 'ket qua', 'doi song'],
  'Thánh Linh': ['thanh linh', 'duc thanh linh', 'thuoc linh', 'ngu tuan'],
  'Nước Thiên Đàng': ['thien dang', 'nuoc duc chua troi', 'nuoc troi', 'vua muon vua'],
  'Hội thánh & Nhóm': ['nhom', 'nhom nho', 'than the dang christ'],  // not "hội thánh": it is in the church's own name
  'Giáng sinh': ['giang sinh', 'noel', 'mua vong', 'giang ha'],
  'Phục sinh': ['phuc sinh', 'song lai'],
};

export function topicsFor(text) {
  const t = norm(text);
  return Object.entries(TOPIC_WORDS)
    .filter(([, words]) => words.some(w => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(t)))
    .map(([name]) => name);
}

const BOOKS = [
  'Sáng thế ký', 'Xuất Ê-díp-tô ký', 'Lê-vi ký', 'Dân số ký', 'Phục truyền luật lệ ký', 'Giô-suê',
  'Các quan xét', 'Ru-tơ', '1 Sa-mu-ên', '2 Sa-mu-ên', '1 Các vua', '2 Các vua', '1 Sử ký', '2 Sử ký',
  'E-xơ-ra', 'Nê-hê-mi', 'Ê-xơ-tê', 'Gióp', 'Thi thiên', 'Châm ngôn', 'Truyền đạo', 'Nhã ca', 'Ê-sai',
  'Giê-rê-mi', 'Ca thương', 'Ê-xê-chi-ên', 'Đa-ni-ên', 'Ô-sê', 'Giô-ên', 'A-mốt', 'Áp-đia', 'Giô-na',
  'Mi-chê', 'Na-hum', 'Ha-ba-cúc', 'Sô-phô-ni', 'A-ghê', 'Xa-cha-ri', 'Ma-la-chi',
  'Ma-thi-ơ', 'Mác', 'Lu-ca', 'Giăng', 'Công vụ', 'Rô-ma', '1 Cô-rinh-tô', '2 Cô-rinh-tô', 'Ga-la-ti',
  'Ê-phê-sô', 'Phi-líp', 'Cô-lô-se', '1 Tê-sa-lô-ni-ca', '2 Tê-sa-lô-ni-ca', '1 Ti-mô-thê', '2 Ti-mô-thê',
  'Tít', 'Phi-lê-môn', 'Hê-bơ-rơ', 'Gia-cơ', '1 Phi-e-rơ', '2 Phi-e-rơ', '1 Giăng', '2 Giăng', '3 Giăng',
  'Giu-đe', 'Khải huyền',
];
// Short forms this church (and Vietnamese Bibles generally) use in titles, e.g. "Mat 22;1-14", "Công 2;32".
const ALIASES = {
  'Ma-thi-ơ': ['Mat', 'Mt'], 'Công vụ': ['Công', 'Cv'], 'Rô-ma': ['Rô'], 'Hê-bơ-rơ': ['Hê'], 'Khải huyền': ['Khải'],
  'Lu-ca': ['Lu'], 'Thi thiên': ['Thi'], 'Châm ngôn': ['Châm'], 'Sáng thế ký': ['Sáng'], 'Xuất Ê-díp-tô ký': ['Xuất'],
  '1 Cô-rinh-tô': ['1 Cô'], '2 Cô-rinh-tô': ['2 Cô'], 'Ga-la-ti': ['Ga'], 'Ê-phê-sô': ['Êph'], 'Phi-líp': ['Phil'],
  'Gia-cơ': ['Gia'], 'Ê-sai': ['Ês'],
};
const VERSES = String.raw`\d{1,3}(?:\s*[-–]\s*\d{1,3})?(?:\s*,\s*\d{1,3}(?:\s*[-–]\s*\d{1,3})?)*`;
const BOOK_RES = BOOKS.map(name => {
  const forms = [name, ...(ALIASES[name] || [])].map(f => {
    const m = f.match(/^([123]) (.+)$/);
    const num = m ? `(?:${m[1]}|${'i'.repeat(+m[1])})[\\s.]*` : '';
    return num + norm(m ? m[2] : f).replace(/[\s-]+/g, '[\\s-]*');
  });
  return {
    name,
    re: new RegExp(`(?:^|[^a-z0-9])(?:${forms.join('|')})\\.?\\s*(\\d{1,3})(?:\\s*[:;.]\\s*(${VERSES}))?(?![0-9])`, 'g'),
  };
});

export function findScripture(text) {
  const t = norm(text);
  let best = null;
  for (const b of BOOK_RES) {
    b.re.lastIndex = 0;
    const m = b.re.exec(t);
    if (m && (!best || m.index < best.index)) best = { index: m.index, b, m };
  }
  if (!best) return '';
  const [, ch, verses] = best.m;
  const v = verses ? ':' + verses.replace(/\s+/g, '').replace(/–/g, '-').replace(/,/g, ', ') : '';
  return `${best.b.name} ${ch}${v}`;
}

/**
 * Split the channel's title convention into parts:
 *   "20261122 [Lễ tạ ơn] Người sở hữu nước thiên đàng (Giăng 14;1-14)"
 *   → { date: '2026-11-22', service: 'Lễ tạ ơn', title: 'Người sở hữu nước thiên đàng' }
 * Titles that don't follow it come back unchanged.
 */
export function parseTitle(raw = '') {
  let t = String(raw).trim(), date = '', service = '';
  const d = t.match(/^(20\d{2})(\d{2})(\d{2})(?!\d)[\s._-]*/);
  if (d && +d[2] >= 1 && +d[2] <= 12 && +d[3] >= 1 && +d[3] <= 31) {
    date = `${d[1]}-${d[2]}-${d[3]}`;
    t = t.slice(d[0].length);
  }
  const b = t.match(/^\[([^\]]{1,40})\]\s*[-–:|]?\s*/);
  const w = !b && t.match(/^(Lễ\s*\d+|Thứ\s*[2-7]|Chúa Nhật|Chủ Nhật)(?![\p{L}])\s*[-–:|]?\s*/iu);
  if (b) { service = b[1].trim(); t = t.slice(b[0].length); }
  else if (w) { service = w[1].replace(/\s+/g, ' '); t = t.slice(w[0].length); }
  const ref = t.match(/\s*[(\[]([^()\[\]]+)[)\]]\s*$/);
  if (ref && findScripture(ref[1])) t = t.slice(0, ref.index);
  t = t.trim();
  return { date, service, title: t || String(raw).trim() };
}

const TITLES = { 'ms': 'Mục sư', 'mục sư': 'Mục sư', 'msnc': 'Mục sư Nhiệm chức', 'mục sư nhiệm chức': 'Mục sư Nhiệm chức', 'tđ': 'Truyền đạo', 'truyền đạo': 'Truyền đạo', 'mstđ': 'Mục sư', 'giáo sĩ': 'Giáo sĩ' };
// No /i flag: with it \p{Lu} would also match lowercase letters and swallow the next words.
const SPEAKER_RE = /(?<![\p{L}])(Mục sư nhiệm chức|Mục Sư Nhiệm Chức|MỤC SƯ|Mục sư|Mục Sư|TRUYỀN ĐẠO|Truyền đạo|Truyền Đạo|GIÁO SĨ|Giáo sĩ|MSNC|MS|Ms|TĐ)\.?\s*:?\s*((?:\p{Lu}[\p{L}]*[ \t]+){0,3}\p{Lu}[\p{L}]*)/u;
const titleCase = s => s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toUpperCase());

export function findSpeaker(text) {
  const m = String(text).match(SPEAKER_RE);
  if (!m) return '';
  const prefix = TITLES[m[1].toLowerCase()] || m[1];
  const name = m[2].trim();
  // reject things like "Mục sư Quản Nhiệm" being cut, or a following sentence word
  return `${prefix} ${name === name.toUpperCase() ? titleCase(name) : name}`;
}

function dateFromTitle(title) {
  const m = title.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)/);
  if (!m) return '';
  let [, d, mo, y] = m.map(Number);
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Lines that appear in most descriptions (address, social links, bank account…) are boilerplate.
function boilerplate(descs) {
  const counts = new Map();
  descs.forEach(d => new Set(d.split('\n').map(l => l.trim()).filter(Boolean)).forEach(l => counts.set(l, (counts.get(l) || 0) + 1)));
  const limit = Math.max(3, descs.length * 0.4);
  return new Set([...counts].filter(([, n]) => n >= limit).map(([l]) => l));
}

function cleanDescription(desc, common) {
  return desc.split('\n').map(l => l.trim())
    .filter(l => l && !common.has(l) && !/https?:\/\/|www\.|^#|^[-–—_=*•]+$/.test(l))
    .join('\n');
}

export function toSermon(v, common = new Set()) {
  const desc = cleanDescription(v.description || '', common);
  const text = `${v.title}\n${desc}`;
  const parts = parseTitle(v.title);
  const date = parts.date || dateFromTitle(v.title) || (v.at ? localDate(v.at) : '');
  let summary = desc.split('\n').slice(0, 4).join(' ').slice(0, 420);
  if (norm(summary).replace(/[^a-z0-9]/g, '').startsWith(norm(parts.title).replace(/[^a-z0-9]/g, '')) &&
      summary.length < parts.title.length + 40) summary = '';
  const out = {
    id: `yt-${v.videoId}`,
    type: classify(v),
    title: parts.title,
    service: parts.service,
    speaker: findSpeaker(text),
    date,
    video: `https://www.youtube.com/watch?v=${v.videoId}`,
    duration: v.duration || '',
    scripture: findScripture(text),
    topics: topicsFor(text),
    summary: summary + (summary.length >= 420 ? '…' : ''),
    source: 'youtube',
    publishedAt: v.at ? v.at.toISOString() : '',
    // Original YouTube data, so later rule changes can re-derive every field (see --offline).
    raw: { title: v.title, description: (v.description || '').slice(0, 1500), at: v.at ? v.at.toISOString() : '', isShort: !!v.isShort, duration: v.duration || '' },
  };
  Object.keys(out).forEach(k => (out[k] === '' || (Array.isArray(out[k]) && !out[k].length)) && delete out[k]);
  return out;
}

/* ---------------- fetching ---------------- */

async function get(url, type = 'text') {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'vi,en;q=0.8', Cookie: 'CONSENT=YES+cb; SOCS=CAI' },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} – ${url.replace(/key=[^&]+/, 'key=***')}`);
  return type === 'json' ? res.json() : res.text();
}

async function resolveChannelId(handle, known) {
  if (process.env.YT_CHANNEL_ID) return process.env.YT_CHANNEL_ID;
  if (known) return known;
  const h = handle.startsWith('@') ? handle : '@' + handle;
  if (process.env.YOUTUBE_API_KEY) {
    const j = await get(`https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(h)}&key=${process.env.YOUTUBE_API_KEY}`, 'json');
    if (j.items?.[0]?.id) return j.items[0].id;
  }
  const html = await get(`https://www.youtube.com/${h}`);
  const m = html.match(/"externalId":"(UC[\w-]{22})"/) ||
    html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/) ||
    html.match(/"channelId":"(UC[\w-]{22})"/);
  if (!m) throw new Error(`Không tìm thấy channel ID cho ${h}`);
  return m[1];
}

export function parseRss(xml) {
  return xml.split('<entry>').slice(1).map(e => {
    const link = attr(e, 'link', 'href');
    return {
      videoId: tag(e, 'yt:videoId'),
      title: tag(e, 'title'),
      description: tag(e, 'media:description'),
      at: new Date(tag(e, 'published')),
      isShort: /\/shorts\//.test(link),
    };
  }).filter(v => v.videoId);
}

async function fromRss(channelId) {
  return parseRss(await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`));
}

async function fromApi(channelId, knownIds) {
  const key = process.env.YOUTUBE_API_KEY;
  const uploads = 'UU' + channelId.slice(2);
  const max = +(process.env.MAX_VIDEOS || 2000);
  const items = [];
  let token = '';
  do {
    const j = await get(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId=${uploads}&key=${key}${token ? '&pageToken=' + token : ''}`, 'json');
    const ids = j.items.map(i => i.contentDetails.videoId);
    items.push(...ids);
    // after the first full sync, stop once a whole page is already known
    if (knownIds.size && ids.every(id => knownIds.has(id))) break;
    token = j.nextPageToken;
  } while (token && items.length < max);

  const videos = [];
  for (let i = 0; i < items.length; i += 50) {
    const batch = items.slice(i, i + 50).join(',');
    const j = await get(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,liveStreamingDetails&id=${batch}&key=${key}`, 'json');
    for (const it of j.items) {
      if (it.snippet.liveBroadcastContent === 'upcoming') continue;
      const dur = it.contentDetails.duration;
      const seconds = (() => { const m = dur.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; })();
      videos.push({
        videoId: it.id,
        title: it.snippet.title,
        description: it.snippet.description,
        at: new Date(it.liveStreamingDetails?.actualStartTime || it.snippet.publishedAt),
        duration: isoDuration(dur),
        isShort: seconds > 0 && seconds <= 60,
      });
    }
  }
  return videos;
}

/* ---------------- main ---------------- */

async function main() {
  const cfg = JSON.parse(await fs.readFile(path.join(ROOT, 'data/sermons.json'), 'utf8'));
  const handle = process.env.YT_HANDLE || cfg.church?.youtubeChannel || '@immanuelhanoi';
  let existing = { videos: [] };
  try { existing = JSON.parse(await fs.readFile(outPath, 'utf8')); } catch { /* first run */ }

  let channelId = existing.channelId || '';
  let fresh;
  if (offline) {
    fresh = [];
  } else if (fixture) {
    fresh = parseRss(await fs.readFile(fixture, 'utf8'));
  } else {
    channelId = await resolveChannelId(handle, channelId);
    const known = new Set((existing.videos || []).map(v => v.id.replace(/^yt-/, '')));
    fresh = process.env.YOUTUBE_API_KEY ? await fromApi(channelId, known) : await fromRss(channelId);
  }
  console.log(`Kênh ${handle} (${channelId || 'fixture'}): nhận ${fresh.length} video.`);

  // Every stored video keeps its original YouTube data, so re-derive all of them: improved rules
  // then also fix older videos that RSS no longer returns. Older entries without `raw` are rebuilt
  // from what was stored.
  const rawById = new Map();
  for (const v of existing.videos || []) {
    const r = v.raw || { title: v.title, description: v.summary || '', at: v.publishedAt || '', duration: v.duration || '' };
    rawById.set(v.id.replace(/^yt-/, ''), { videoId: v.id.replace(/^yt-/, ''), ...r, at: r.at ? new Date(r.at) : null });
  }
  let added = 0;
  for (const v of fresh) {
    if (!rawById.has(v.videoId)) added++;
    const prevRaw = rawById.get(v.videoId);
    rawById.set(v.videoId, { ...v, duration: v.duration || (prevRaw && prevRaw.duration) || '' });
  }
  const raws = [...rawById.values()];
  const common = boilerplate(raws.map(v => v.description || ''));
  const videos = raws.map(v => toSermon(v, common))
    // newest day first; within a day "Lễ 1" before "Lễ 2"
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (a.service || '').localeCompare(b.service || '', 'vi', { numeric: true }) ||
      (b.publishedAt || '').localeCompare(a.publishedAt || ''));

  const out = { channel: handle, channelId, videos };
  const prev = JSON.stringify({ ...existing, updatedAt: undefined });
  if (JSON.stringify({ ...out }) === prev) {
    console.log('Không có thay đổi.');
    return;
  }
  out.updatedAt = new Date().toISOString();
  await fs.writeFile(outPath, JSON.stringify(out, null, 2) + '\n');
  console.log(`Đã ghi ${videos.length} video (${added} mới) vào ${path.relative(ROOT, outPath)}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(e => { console.error('Lỗi đồng bộ YouTube:', e.message); process.exit(1); });
}
