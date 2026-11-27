// TEMPORARY: contact sheets of candidate Commons illustrations (removed before the PR)
import fs from 'node:fs/promises';
import sharp from 'sharp';
const UA = 'ImmanuelHanoiKidsBible/1.0 (https://immanuelhanoi.github.io; GitHub Actions)';
const cats = JSON.parse(await fs.readFile('tmp-preview/cats.json', 'utf8'));
await fs.mkdir('tmp-preview/sheets', { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url) {
  for (let a = 0; a < 6; a++) {
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    console.log('retry', r.status, url); await sleep(4000 * 2 ** a);
  }
  return null;
}
const W = 250, H = 200, COLS = 5;
for (const [cat, files] of Object.entries(cats)) {
  const tiles = [];
  for (const f of files) {
    const buf = await get(`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(f.replace(/ /g, '_'))}?width=250`);
    await sleep(400);
    if (!buf) continue;
    const label = f.replace(/ \(Bible Illustrations by Sweet Media\)\.jpg|\.jpg/g, '').replace(/^.*(Chapter |Genesis )/, '');
    const img = await sharp(buf).resize(W - 6, H - 26, { fit: 'contain', background: '#fff' }).toBuffer();
    const text = Buffer.from(`<svg width="${W}" height="24"><text x="4" y="17" font-size="16" font-family="sans-serif" fill="red">${label.replace(/&/g, '&amp;')}</text></svg>`);
    tiles.push({ img, text });
  }
  const rows = Math.ceil(tiles.length / COLS);
  const comp = tiles.flatMap((t, i) => [
    { input: t.img, left: (i % COLS) * W + 3, top: Math.floor(i / COLS) * H + 2 },
    { input: t.text, left: (i % COLS) * W, top: Math.floor(i / COLS) * H + H - 24 },
  ]);
  await sharp({ create: { width: COLS * W, height: rows * H, channels: 3, background: '#fff' } }).composite(comp).jpeg({ quality: 70 }).toFile(`tmp-preview/sheets/${cat}.jpg`);
  console.log(cat, tiles.length);
}
