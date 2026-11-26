#!/usr/bin/env node
/**
 * Tạo ảnh cho Google Play & App Store từ chính app (dữ liệu thật trong data/).
 *   node scripts/store-assets.mjs        → thư mục store/generated/
 *
 *  - Google Play: ảnh điện thoại 1080×1920, ảnh nổi bật 1024×500, icon 512×512
 *  - App Store:   ảnh iPhone 6.9" 1320×2868 (kích thước Apple bắt buộc)
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WWW = path.join(ROOT, 'www');
const OUT = path.join(ROOT, 'store/generated');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer(async (req, res) => {
  const p = path.join(WWW, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
  try {
    const body = await fs.readFile(p);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/`;

const sermons = JSON.parse(await fs.readFile(path.join(WWW, 'data/youtube.json'), 'utf8')).videos || [];
const latestSunday = sermons.filter(s => s.type === 'chua-nhat').sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];

const SHOTS = [
  ['01-trang-chu', '#/'],
  ['02-chua-nhat', '#/chua-nhat'],
  ['03-bai-giang', latestSunday ? `#/bai/${encodeURIComponent(latestSunday.id)}` : null],
  ['04-hang-ngay', '#/hang-ngay'],
  ['05-chu-de', '#/chu-de'],
  ['06-nhac-nho', '#/cai-dat'],
].filter(([, h]) => h);

const DEVICES = {
  android: { viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },   // 1080×1920
  ios: { viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },       // 1320×2868
};

const browser = await chromium.launch();

for (const [platform, device] of Object.entries(DEVICES)) {
  const dir = path.join(OUT, platform);
  await fs.mkdir(dir, { recursive: true });
  const ctx = await browser.newContext({ ...device, colorScheme: 'light', locale: 'vi-VN' });
  // Show the store screenshots as the installed app: reminders available and switched on.
  await ctx.addInitScript(() => {
    localStorage.setItem('immanuel.settings', JSON.stringify({ verse: { on: true, time: '06:00' }, sunday: { on: true, time: '07:30' } }));
    const ok = async () => ({ display: 'granted', notifications: [] });
    window.Capacitor = { isNativePlatform: () => true, Plugins: { LocalNotifications: {
      checkPermissions: ok, requestPermissions: ok, getPending: ok, cancel: ok, schedule: ok, addListener: () => {},
    } } };
  });
  // The app would fetch from the live site; serve the local build instead.
  await ctx.route('https://immanuelhanoi.github.io/**', r => r.abort());
  // Replace the YouTube player with its thumbnail so the screenshot is clean and deterministic.
  await ctx.route(/youtube-nocookie\.com\/embed\//, r => {
    const id = new URL(r.request().url()).pathname.split('/').pop();
    r.fulfill({ contentType: 'text/html', body: `<body style="margin:0;background:#000;display:grid;place-items:center;height:100vh">
      <img src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">
      <div style="position:relative;width:68px;height:48px;background:#f00;border-radius:12px;display:grid;place-items:center">
      <div style="border-left:18px solid #fff;border-top:11px solid transparent;border-bottom:11px solid transparent;margin-left:4px"></div></div></body>` });
  });
  const page = await ctx.newPage();
  for (const [name, hash] of SHOTS) {
    await page.goto(BASE + hash);
    await page.waitForSelector('#app > :not(.loading)');
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(dir, `${name}.png`) });
  }
  await ctx.close();
  console.log(`${platform}: ${SHOTS.length} ảnh → ${path.relative(ROOT, dir)}`);
}

// Feature graphic (Google Play, 1024×500) and store icon (512×512, PNG 32-bit).
const page = await browser.newPage({ viewport: { width: 1024, height: 500 } });
const icon = await fs.readFile(path.join(ROOT, 'icons/icon.svg'), 'utf8');
await page.setContent(`<html><body style="margin:0;width:1024px;height:500px;display:flex;align-items:center;gap:48px;padding:0 72px;box-sizing:border-box;
  background:linear-gradient(135deg,#7a2e1f 0%,#5a1f14 60%,#3a140c 100%);font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#f6e7c8">
  <div style="flex:none;width:200px;height:200px;filter:drop-shadow(0 10px 30px rgba(0,0,0,.35))">${icon.replace('<svg ', '<svg width="200" height="200" ')}</div>
  <div><div style="font-size:64px;font-weight:800;line-height:1.05">Immanuel Hà Nội</div>
  <div style="font-size:30px;margin-top:16px;opacity:.92">Bài giảng · Tĩnh nguyện<br>Câu Kinh Thánh mỗi ngày</div></div></body></html>`);
await page.screenshot({ path: path.join(OUT, 'feature-graphic-1024x500.png') });
await page.setViewportSize({ width: 512, height: 512 });
await page.setContent(`<body style="margin:0;background:transparent">${icon.replace('<svg ', '<svg width="512" height="512" ').replace('rx="112"', 'rx="0"')}</body>`);
await page.screenshot({ path: path.join(OUT, 'icon-512.png'), omitBackground: true });
console.log('feature-graphic-1024x500.png, icon-512.png');

await browser.close();
server.close();
