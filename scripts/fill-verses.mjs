#!/usr/bin/env node
/**
 * Điền chữ Kinh Thánh (Bản Truyền Thống 1926, data/bible) cho mọi câu tham chiếu trong app,
 * để chữ luôn đúng nguyên văn:
 *   - data/moods.json     : "verseRefs" của mỗi tâm trạng → "verses" [{ ref, text }]
 *   - data/verses.json    : câu Kinh Thánh cho thông báo hằng ngày
 *   - data/journeys.json  : câu gốc của mỗi chặng
 *
 *   node scripts/fill-verses.mjs           # ghi file
 *   node scripts/fill-verses.mjs --check   # chỉ báo lỗi tham chiếu, không ghi
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async f => JSON.parse(await fs.readFile(path.join(ROOT, f), 'utf8'));

const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
  .toLowerCase().replace(/[\s-]+/g, ' ').trim();

/** "2 Cô-rinh-tô 4:8-9" → { code: '2CO', ch: 4, from: 8, to: 9 } */
export function parseRef(ref, books) {
  const m = String(ref).trim().match(/^(.+?)\s+(\d+):(\d+)(?:\s*[-–]\s*(\d+))?$/);
  if (!m) return null;
  const name = norm(m[1]);
  const book = books.find(b => norm(b.name) === name) ||
    books.find(b => norm(b.name).startsWith(name + ' ')) ||                       // "Công vụ" → "Công vụ các Sứ đồ"
    books.find(b => name.startsWith(norm(b.name)));
  if (!book) return null;
  return { code: book.code, ch: +m[2], from: +m[3], to: +(m[4] || m[3]) };
}

export async function makeLookup(dir = path.join(ROOT, 'data/bible')) {
  const cache = {};
  return async (r) => {
    if (!r) return '';
    if (!(r.code in cache)) {
      try { cache[r.code] = JSON.parse(await fs.readFile(path.join(dir, `${r.code}.json`), 'utf8')); } catch { cache[r.code] = null; }
    }
    const verses = cache[r.code] && cache[r.code].chapters[r.ch - 1];
    if (!verses || r.to > verses.length) return '';
    return verses.slice(r.from - 1, r.to).join(' ').trim();
  };
}

async function main() {
  const check = process.argv.includes('--check');
  const journeys = await read('data/journeys.json');
  const books = journeys.books;
  const lookup = await makeLookup();
  try { await fs.access(path.join(ROOT, 'data/bible/GEN.json')); } catch {
    console.log('Chưa có data/bible — bỏ qua (chạy scripts/fetch-bible.mjs trước).');
    return;
  }
  const problems = [];
  const textOf = async (ref, where) => {
    const t = await lookup(parseRef(ref, books));
    if (!t) problems.push(`${where}: không tìm thấy "${ref}"`);
    return t;
  };

  const moods = await read('data/moods.json');
  for (const m of moods.moods) {
    const refs = m.verseRefs || (m.verses || []).map(v => v.ref);
    const verses = [];
    for (const ref of refs) {
      const text = await textOf(ref, `tâm trạng ${m.id}`);
      if (text) verses.push({ ref, text });
    }
    m.verseRefs = refs;
    m.verses = verses;
  }

  const daily = await read('data/verses.json');
  for (const v of daily.verses) v.text = (await textOf(v.ref, 'verses.json')) || v.text;

  for (const t of journeys.tracks) {
    for (const s of t.stages) {
      const v = s.verse;
      const text = await lookup({ code: v.book, ch: v.ch, from: v.v[0], to: v.v[1] });
      if (text) v.text = text; else problems.push(`hành trình ${s.id}: câu gốc ${v.ref}`);
    }
  }

  problems.forEach(p => console.log('⚠️ ' + p));
  if (check) { if (problems.length) process.exit(1); return; }
  await fs.writeFile(path.join(ROOT, 'data/moods.json'), JSON.stringify(moods, null, 2) + '\n');
  await fs.writeFile(path.join(ROOT, 'data/verses.json'), JSON.stringify(daily, null, 2) + '\n');
  await fs.writeFile(path.join(ROOT, 'data/journeys.json'), JSON.stringify(journeys, null, 1) + '\n');
  const n = moods.moods.reduce((k, m) => k + m.verses.length, 0);
  console.log(`Đã điền ${n} câu cho ${moods.moods.length} tâm trạng, ${daily.verses.length} câu hằng ngày, câu gốc ${journeys.tracks.reduce((k, t) => k + t.stages.length, 0)} chặng.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(e => { console.error('Lỗi điền câu Kinh Thánh:', e.message); process.exit(1); });
}
