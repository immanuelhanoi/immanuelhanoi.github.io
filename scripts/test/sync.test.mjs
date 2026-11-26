import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { parseRss, toSermon, findScripture, findSpeaker, topicsFor, classify } from '../sync-youtube.mjs';

test('parse RSS feed fixture', async () => {
  const xml = await fs.readFile(new URL('./sample-feed.xml', import.meta.url), 'utf8');
  const v = parseRss(xml);
  assert.equal(v.length, 5);
  assert.equal(v[1].description.includes('bình an & tin cậy'), true);
  assert.equal(v[4].isShort, true);
});

test('scripture references', () => {
  assert.equal(findScripture('Thi Thiên 23:1'), 'Thi thiên 23:1');
  assert.equal(findScripture('đọc I Cô-rinh-tô 13:4-7 nhé'), '1 Cô-rinh-tô 13:4-7');
  assert.equal(findScripture('1 Giăng 1:9'), '1 Giăng 1:9');
  assert.equal(findScripture('Giăng 3:16'), 'Giăng 3:16');
  assert.equal(findScripture('Phúc âm Mác 10'), 'Mác 10');
  assert.equal(findScripture('Chúa Nhật 23/11/2025'), '');
});

test('speakers', () => {
  assert.equal(findSpeaker('Bài giảng | MS. NGUYỄN VĂN AN'), 'Mục sư Nguyễn Văn An');
  assert.equal(findSpeaker('Truyền đạo Trần Thị Bình chia sẻ'), 'Truyền đạo Trần Thị Bình');
  assert.equal(findSpeaker('Không có tên'), '');
});

test('topics ignore church name', () => {
  assert.deepEqual(topicsFor('Hội Thánh Tin Lành Immanuel'), []);
  assert.deepEqual(topicsFor('Sống bởi đức tin và cầu nguyện'), ['Đức tin', 'Cầu nguyện']);
});

test('classification', () => {
  const sunday = new Date('2025-11-23T02:00:00Z');
  const monday = new Date('2025-11-24T02:00:00Z');
  assert.equal(classify({ title: 'Tĩnh nguyện sáng', at: sunday }), 'hang-ngay');
  assert.equal(classify({ title: 'Thờ phượng Chúa Nhật', at: monday }), 'chua-nhat');
  assert.equal(classify({ title: 'Biệt thánh ca', at: sunday }), 'khac');
  assert.equal(classify({ title: 'Sống đẹp lòng Chúa', at: sunday }), 'chua-nhat');
  assert.equal(classify({ title: 'Sống đẹp lòng Chúa', at: monday }), 'hang-ngay');
});

test('date from title wins; Vietnam time zone otherwise', () => {
  const a = toSermon({ videoId: 'x', title: 'Chúa Nhật 9/11/2025', at: new Date('2025-11-12T00:00:00Z') });
  assert.equal(a.date, '2025-11-09');
  const b = toSermon({ videoId: 'y', title: 'Bài mới', at: new Date('2025-11-24T22:00:00Z') });
  assert.equal(b.date, '2025-11-25');
  assert.equal(b.video, 'https://www.youtube.com/watch?v=y');
});
