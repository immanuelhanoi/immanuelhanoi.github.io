#!/usr/bin/env node
// Copy the web app into www/ — used both for GitHub Pages and for the Android app bundle.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'www');
const ITEMS = ['index.html', 'privacy.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'icons', 'data'];

await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });
for (const item of ITEMS) {
  await fs.cp(path.join(ROOT, item), path.join(OUT, item), { recursive: true });
}
await fs.writeFile(path.join(OUT, '.nojekyll'), '');

// Build id = fingerprint of the app code (not the data). It goes into asset URLs so browsers fetch new code
// right after a deploy, and into version.json so an installed app can tell that a newer version exists.
const hash = crypto.createHash('sha1');
for (const f of ['index.html', 'js/app.js', 'js/config.js', 'css/style.css', 'sw.js']) hash.update(await fs.readFile(path.join(ROOT, f)));
const BUILD = hash.digest('hex').slice(0, 10);
let html = await fs.readFile(path.join(OUT, 'index.html'), 'utf8');
html = html.replace(/(href|src)="(css\/style\.css|js\/config\.js|js\/app\.js)"/g, `$1="$2?v=${BUILD}"`)
  .replace('<script src="js/config.js', `<script>window.APP_BUILD = '${BUILD}';</script>\n  <script src="js/config.js`);
await fs.writeFile(path.join(OUT, 'index.html'), html);
const sw = await fs.readFile(path.join(OUT, 'sw.js'), 'utf8');
await fs.writeFile(path.join(OUT, 'sw.js'), sw.replace(/const CACHE = '[^']*';/, `const CACHE = 'immanuel-${BUILD}';`));
await fs.writeFile(path.join(OUT, 'version.json'), JSON.stringify({ build: BUILD, builtAt: new Date().toISOString() }) + '\n');
// sanity check: every JSON data file must parse, so a typo never ships a blank app
for (const f of await fs.readdir(path.join(OUT, 'data'))) {
  if (f.endsWith('.json')) JSON.parse(await fs.readFile(path.join(OUT, 'data', f), 'utf8'));
}
console.log(`Built www/ (build ${BUILD})`);
