#!/usr/bin/env node
/**
 * Tải Kinh Thánh Tiếng Việt Bản Truyền Thống (1926, phạm vi công cộng) từ eBible.org
 * và chuyển thành data/bible/<MÃ SÁCH>.json để đọc ngay trong app (cả khi không có mạng).
 *
 *   node scripts/fetch-bible.mjs            # tải và chuyển đổi (bỏ qua nếu đã có)
 *   node scripts/fetch-bible.mjs --force    # tải lại
 *   node scripts/fetch-bible.mjs --usfm DIR # chuyển đổi từ thư mục USFM có sẵn
 *
 * Mỗi file: { "code": "GEN", "name": "Sáng thế ký", "chapters": [["câu 1", "câu 2", …], …] }
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data/bible');
const SOURCE = 'https://ebible.org/Scriptures/vie1934_usfm.zip';
const run = promisify(execFile);

/** Strip USFM markup from one line of verse text. */
export function cleanUsfm(text) {
  return text
    .replace(/\\f\s[\s\S]*?\\f\*/g, '')                    // footnotes
    .replace(/\\x\s[\s\S]*?\\x\*/g, '')                    // cross references
    .replace(/\\\+?w\s+([^|\\]*?)(\|[^\\]*?)?\\\+?w\*/g, '$1') // \w word|lemma="…"\w*
    .replace(/\\\+?[a-z]+\d*\*/g, '')                       // closing markers  \nd*  \+wj*
    .replace(/\\\+?[a-z]+\d*\s?/g, '')                      // opening markers  \nd  \q1  \p
    .replace(/\s+/g, ' ')
    .trim();
}

/** One USFM book → { code, chapters } */
export function parseUsfm(src) {
  const code = (src.match(/^\\id\s+(\w{3})/m) || [])[1];
  if (!code) return null;
  const chapters = [];
  let ch = null, verse = null;
  // markers that start a new paragraph/line can also carry verse text: treat every line as a continuation
  for (const raw of src.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;
    const c = line.match(/^\\c\s+(\d+)/);
    if (c) { ch = []; chapters[+c[1] - 1] = ch; verse = null; continue; }
    if (!ch) continue;                                     // headers before chapter 1
    if (/^\\(s\d?|ms\d?|mr|r|d|sp|cl|cp|toc\d|h|mt\d?|ide|rem)\b/.test(line)) continue;   // headings, not verse text
    // a line may contain several verses: "\v 1 ... \v 2 ..."
    const parts = line.split(/(?=\\v\s+\d+)/);
    for (const part of parts) {
      const v = part.match(/^\\v\s+(\d+)(?:-(\d+))?\s*([\s\S]*)$/);
      if (v) {
        verse = +v[1] - 1;
        ch[verse] = cleanUsfm(v[3]);
        if (v[2]) for (let k = +v[1]; k < +v[2]; k++) ch[k] = ch[k] || '';   // bridged verses "1-2"
      } else if (verse !== null) {
        const t = cleanUsfm(part);
        if (t) ch[verse] = (ch[verse] ? ch[verse] + ' ' : '') + t;
      }
    }
  }
  return { code, chapters: chapters.map(c => Array.from(c || [], x => x || '')) };
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const usfmArg = args.includes('--usfm') ? args[args.indexOf('--usfm') + 1] : null;
  const journeys = JSON.parse(await fs.readFile(path.join(ROOT, 'data/journeys.json'), 'utf8'));
  const names = Object.fromEntries(journeys.books.map(b => [b.code, b.name]));

  if (!force && !usfmArg) {
    try { await fs.access(path.join(OUT, 'REV.json')); console.log('Kinh Thánh đã có trong data/bible — bỏ qua.'); return; } catch { /* not yet */ }
  }

  let dir = usfmArg;
  if (!dir) {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bible-'));
    const res = await fetch(SOURCE);
    if (!res.ok) throw new Error(`tải ${SOURCE}: HTTP ${res.status}`);
    const zip = path.join(dir, 'bible.zip');
    await fs.writeFile(zip, Buffer.from(await res.arrayBuffer()));
    await run('unzip', ['-o', '-q', zip, '-d', dir]);
  }

  await fs.mkdir(OUT, { recursive: true });
  const index = [];
  for (const f of (await fs.readdir(dir)).filter(f => /\.(usfm|sfm|SFM)$/.test(f))) {
    const book = parseUsfm(await fs.readFile(path.join(dir, f), 'utf8'));
    if (!book || !names[book.code]) continue;                // skip front matter, glossary, deuterocanon
    const verses = book.chapters.reduce((n, c) => n + c.filter(Boolean).length, 0);
    await fs.writeFile(path.join(OUT, `${book.code}.json`), JSON.stringify({ code: book.code, name: names[book.code], chapters: book.chapters }));
    index.push({ code: book.code, chapters: book.chapters.length, verses });
  }
  const order = journeys.books.map(b => b.code);
  index.sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code));
  const missing = order.filter(c => !index.some(i => i.code === c));
  await fs.writeFile(path.join(OUT, 'index.json'), JSON.stringify({
    source: 'Kinh Thánh Tiếng Việt, Bản Truyền Thống 1926 (phạm vi công cộng) — eBible.org vie1934', books: index,
  }, null, 1));
  console.log(`Đã ghi ${index.length} sách, ${index.reduce((n, b) => n + b.verses, 0)} câu vào data/bible.` +
    (missing.length ? ` Thiếu: ${missing.join(', ')}` : ''));
  if (index.length < 60) throw new Error('quá ít sách — kiểm tra lại nguồn');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(e => { console.error('Lỗi tải Kinh Thánh:', e.message); process.exit(1); });
}
