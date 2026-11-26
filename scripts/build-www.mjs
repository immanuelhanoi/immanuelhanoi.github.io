#!/usr/bin/env node
// Copy the web app into www/ — used both for GitHub Pages and for the Android app bundle.
import fs from 'node:fs/promises';
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
// sanity check: every JSON data file must parse, so a typo never ships a blank app
for (const f of await fs.readdir(path.join(OUT, 'data'))) {
  if (f.endsWith('.json')) JSON.parse(await fs.readFile(path.join(OUT, 'data', f), 'utf8'));
}
console.log('Built www/');
