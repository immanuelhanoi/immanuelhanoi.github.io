#!/usr/bin/env node
/**
 * Tải tranh cho mục "Kinh Thánh thiếu nhi" (data/kids.json) từ Wikimedia Commons,
 * nén thành WebP rộng ~1000px và lưu vào data/kids/img/<truyện>-<trang>.webp.
 *
 *   node scripts/fetch-kids-images.mjs           # chỉ tải tranh còn thiếu
 *   node scripts/fetch-kids-images.mjs --force   # tải lại tất cả
 *
 * Trước khi tải, script đọc trang mô tả của từng file trên Commons và CHỈ nhận file có đúng giấy phép
 * của bộ tranh khai báo trong data/kids.json (imageSets[...].licenseCheck). File khác giấy phép bị bỏ qua
 * và báo lỗi, để không bao giờ đưa vào app một bức tranh không được phép dùng.
 * Wikimedia giới hạn tốc độ tải, nên script tải chậm, từng file một, và thử lại khi bị từ chối (HTTP 429).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data/kids/img');
const UA = 'ImmanuelHanoiKidsBible/1.0 (https://immanuelhanoi.github.io; GitHub Actions)';
const WIDTH = 1000;
const FORCE = process.argv.includes('--force');

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** The file a story page is saved as (the app uses the same rule) */
export const imagePath = (storyId, i) => `data/kids/img/${storyId}-${i + 1}.webp`;

async function get(url, as = 'text') {
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    if (res.ok) return as === 'text' ? res.text() : Buffer.from(await res.arrayBuffer());
    if (res.status === 429 || res.status >= 500) {
      const wait = (+res.headers.get('retry-after') || 0) * 1000 || Math.min(120000, 5000 * 2 ** attempt);
      console.log(`  … máy chủ bận (HTTP ${res.status}), chờ ${Math.round(wait / 1000)} giây`);
      await sleep(wait);
      continue;
    }
    throw new Error(`HTTP ${res.status} ${url}`);
  }
  throw new Error(`Hết lượt thử: ${url}`);
}

const commonsTitle = file => 'File:' + file.replace(/ /g, '_');

/** The file's wikitext, following a redirect to the file's current name */
async function fileWikitext(file) {
  let title = commonsTitle(file);
  for (let hop = 0; hop < 3; hop++) {
    const raw = await get(`https://commons.wikimedia.org/w/index.php?title=${encodeURIComponent(title)}&action=raw`);
    const redirect = raw.match(/^#REDIRECT\s*\[\[([^\]]+)\]\]/i);
    if (!redirect) return raw;
    title = redirect[1].replace(/ /g, '_');
  }
  throw new Error('Chuyển hướng quá nhiều lần: ' + file);
}

async function main() {
  const kids = JSON.parse(await fs.readFile(path.join(ROOT, 'data/kids.json'), 'utf8'));
  await fs.mkdir(OUT, { recursive: true });
  let fetched = 0, kept = 0;
  const failed = [];
  for (const story of kids.stories) {
    for (const [i, page] of story.pages.entries()) {
      const dest = path.join(ROOT, imagePath(story.id, i));
      if (!FORCE && await fs.access(dest).then(() => true, () => false)) { kept++; continue; }
      const set = kids.imageSets[page.set];
      try {
        if (!set) throw new Error(`không có bộ tranh "${page.set}"`);
        const wikitext = await fileWikitext(page.img);
        if (!new RegExp(set.licenseCheck, 'i').test(wikitext)) {
          throw new Error(`giấy phép trên Commons không khớp bộ tranh "${page.set}" — KHÔNG dùng file này`);
        }
        await sleep(1500);
        // Special:FilePath gives a thumbnail of the requested width (1280 is one of Wikimedia's standard sizes)
        const original = await get(`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(page.img.replace(/ /g, '_'))}?width=1280`, 'buffer');
        const webp = await sharp(original).resize({ width: WIDTH, withoutEnlargement: true }).webp({ quality: 72, effort: 6 }).toBuffer();
        await fs.writeFile(dest, webp);
        fetched++;
        console.log(`✓ ${path.basename(dest)}  ${Math.round(webp.length / 1024)} KB  ← ${page.img}`);
      } catch (e) {
        failed.push(`${story.id} trang ${i + 1} (${page.img}): ${e.message}`);
        console.log(`✗ ${story.id} trang ${i + 1}: ${e.message}`);
      }
      await sleep(1500);
    }
  }
  console.log(`\nĐã tải ${fetched} tranh, giữ nguyên ${kept} tranh có sẵn.`);
  if (failed.length) {
    console.error(`\n${failed.length} tranh chưa tải được:\n- ` + failed.join('\n- '));
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
