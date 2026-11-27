import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// Guards data/kids.json (Kinh Thánh thiếu nhi) against editing mistakes: wrong answer index, a page without a picture,
// a picture from an image set without a licence, a memory verse that does not match the 1926 Bible text…
const root = new URL('../../', import.meta.url);
const K = JSON.parse(await fs.readFile(new URL('data/kids.json', root), 'utf8'));
const J = JSON.parse(await fs.readFile(new URL('data/journeys.json', root), 'utf8'));
const books = Object.fromEntries(J.books.map(b => [b.code, b]));
const exists = p => fs.access(new URL(p, root)).then(() => true, () => false);
const bible = async code => (await exists(`data/bible/${code}.json`)) ? JSON.parse(await fs.readFile(new URL(`data/bible/${code}.json`, root), 'utf8')) : null;
// eBible marks Vietnamese verse numbers that differ from the English ones, e.g. "(02-10)"; they are not part of the text
const plain = s => s.replace(/\(\d+-\d+\)\s*/g, '').replace(/\s+/g, ' ').trim();

// Spellings that differ from the 1926 Bible (Bản Truyền Thống) — the stories must use the 1926 names
const NOT_1926 = ['Giê-su', 'Giêsu', 'Giê-xu', 'Nô-a', 'Abraham', 'Môsê', 'Mô-sê', 'Đavít', 'Đa-vid', 'Goliath', 'Gô-li-a ', 'Đaniên', 'Gioan',
  'Giôna', 'Giu-se', 'Ma-ri-a', 'Bê-lem', 'Ai Cập', 'Israel', 'It-ra-en', 'Pha-ra-ông', 'Dakêu', 'Xa-kê', 'Ê-đen ', 'Adam'];

test('kids stories: structure, quiz and names', () => {
  assert.ok(K.stories.length >= 10, 'cần ít nhất 10 truyện');
  const ids = new Set();
  for (const s of K.stories) {
    const where = s.id;
    assert.match(s.id, /^[a-z0-9-]+$/, `${where}: id chỉ gồm chữ thường, số, gạch nối`);
    assert.ok(!['nguon-tranh'].includes(s.id), `${where}: id trùng tên trang`);
    assert.ok(!ids.has(s.id), `${where}: id trùng`); ids.add(s.id);
    assert.ok(s.title && s.emoji && s.ref && s.testament && /^#[0-9a-f]{6}$/i.test(s.color), `${where}: thiếu tiêu đề/emoji/tham chiếu/màu`);
    assert.ok(['Cựu Ước', 'Tân Ước'].includes(s.testament), `${where}: testament`);
    assert.ok(books[s.read.book] && s.read.ch >= 1 && s.read.ch <= books[s.read.book].chapters, `${where}: nút "Đọc trong Kinh Thánh"`);
    assert.ok(s.cover === undefined || (Number.isInteger(s.cover) && s.cover >= 0 && s.cover < s.pages.length), `${where}: ảnh bìa (cover) không có`);
    assert.ok(s.pages.length >= 5 && s.pages.length <= 8, `${where}: cần 5–8 trang (đang có ${s.pages.length})`);
    for (const [i, p] of s.pages.entries()) {
      assert.ok(K.imageSets[p.set], `${where} trang ${i + 1}: bộ tranh "${p.set}" chưa khai báo giấy phép`);
      assert.ok(p.img && /\.(jpe?g|png|tif)$/i.test(p.img), `${where} trang ${i + 1}: thiếu tên file tranh trên Commons`);
      const sentences = p.text.split(/[.!?…]+(?:\s|$)/).filter(x => x.trim()).length;
      assert.ok(sentences >= 1 && sentences <= 3, `${where} trang ${i + 1}: 1–3 câu cho mỗi trang (đang có ${sentences})`);
      assert.ok(p.text.length <= 260, `${where} trang ${i + 1}: chữ quá dài cho trẻ (${p.text.length} ký tự)`);
    }
    assert.equal(s.quiz.length, 3, `${where}: cần đúng 3 câu đố vui`);
    for (const q of s.quiz) {
      assert.ok(q.q && q.why, `${where}: câu hỏi thiếu nội dung/giải thích`);
      assert.ok(Number.isInteger(q.a) && q.a >= 0 && q.a < q.options.length, `${where}: đáp án sai vị trí — ${q.q}`);
      assert.ok(q.options.length >= 2 && q.options.length <= 4, `${where}: 2–4 lựa chọn — ${q.q}`);
      assert.equal(new Set(q.options.map(o => o.t)).size, q.options.length, `${where}: lựa chọn trùng — ${q.q}`);
      for (const o of q.options) {
        assert.ok(o.img || Number.isInteger(o.pic), `${where}: lựa chọn "${o.t}" cần hình (emoji hoặc tranh)`);
        if (Number.isInteger(o.pic)) assert.ok(o.pic >= 0 && o.pic < s.pages.length, `${where}: tranh ${o.pic} không có`);
      }
    }
    const m = s.memory;
    assert.ok(m && m.text && m.ref && books[m.book] && m.ch <= books[m.book].chapters && m.v[0] <= m.v[1], `${where}: câu học thuộc`);
    const all = JSON.stringify(s);
    for (const bad of NOT_1926) assert.ok(!all.includes(bad), `${where}: dùng "${bad}" — hãy dùng tên theo Bản Truyền Thống 1926`);
  }
});

test('kids stories: memory verses match the 1926 Bible text', async t => {
  for (const s of K.stories) {
    const b = await bible(s.memory.book);
    if (!b) { t.skip('chưa có data/bible'); return; }
    const text = plain(b.chapters[s.memory.ch - 1].slice(s.memory.v[0] - 1, s.memory.v[1]).join(' '));
    assert.ok(text.includes(plain(s.memory.text)), `${s.id}: câu học thuộc không khớp ${s.memory.ref}:\n  app:  ${s.memory.text}\n  1926: ${text}`);
  }
});

test('kids pictures: every page has a compressed picture with a licence', async () => {
  for (const [key, set] of Object.entries(K.imageSets)) {
    assert.ok(set.name && set.author && set.license && set.licenseUrl && set.source && set.credit && set.licenseCheck, `bộ tranh ${key}: thiếu thông tin nguồn/giấy phép`);
  }
  for (const s of K.stories) {
    for (let i = 0; i < s.pages.length; i++) {
      const p = `data/kids/img/${s.id}-${i + 1}.webp`;
      assert.ok(await exists(p), `thiếu tranh ${p} — chạy: node scripts/fetch-kids-images.mjs (hoặc workflow "Tải tranh Kinh Thánh thiếu nhi")`);
      const { size } = await fs.stat(new URL(p, root));
      assert.ok(size < 300 * 1024, `${p} quá nặng (${Math.round(size / 1024)} KB)`);
    }
  }
});
