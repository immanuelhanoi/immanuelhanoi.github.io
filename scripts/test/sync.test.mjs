import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { parseRss, toSermon, findScripture, findSpeaker, topicsFor, classify, parseTitle } from '../sync-youtube.mjs';

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

// Titles exactly as they appear on youtube.com/@immanuelhanoi
test('channel title convention', () => {
  assert.deepEqual(parseTitle('20261122 [Lễ tạ ơn] Người sở hữu nước thiên đàng (Giăng 14;1-14)'),
    { date: '2026-11-22', service: 'Lễ tạ ơn', title: 'Người sở hữu nước thiên đàng' });
  assert.deepEqual(parseTitle('20261115 Lễ 2 Người được mời dự tiệc thiên đàng (Mat 22;1-14)'),
    { date: '2026-11-15', service: 'Lễ 2', title: 'Người được mời dự tiệc thiên đàng' });
  assert.deepEqual(parseTitle('20261018  Lễ 1 Cầu nguyện cá nhân (Công 2;1-4)'),
    { date: '2026-10-18', service: 'Lễ 1', title: 'Cầu nguyện cá nhân' });
  assert.deepEqual(parseTitle('20261022 Thứ 4 Lập nhân sự truyền đạo nhóm (Công vụ 11;19-30)'),
    { date: '2026-10-22', service: 'Thứ 4', title: 'Lập nhân sự truyền đạo nhóm' });
  assert.deepEqual(parseTitle('Bài giảng không theo mẫu'), { date: '', service: '', title: 'Bài giảng không theo mẫu' });
  // a bracket that is not a Bible reference stays in the title
  assert.equal(parseTitle('Sống đẹp lòng Chúa (phần 2)').title, 'Sống đẹp lòng Chúa (phần 2)');
});

test('channel scripture style', () => {
  assert.equal(findScripture('(Giăng 14;1-14)'), 'Giăng 14:1-14');
  assert.equal(findScripture('(Mat 22;1-14)'), 'Ma-thi-ơ 22:1-14');
  assert.equal(findScripture('(Công 2;32-41)'), 'Công vụ 2:32-41');
  assert.equal(findScripture('(Công vụ 11;19-30)'), 'Công vụ 11:19-30');
  assert.equal(findScripture('(Giăng 14;16-17, 26-27)'), 'Giăng 14:16-17, 26-27');
  assert.equal(findScripture('công việc 3 người'), '');
});

test('channel classification and record', () => {
  const sun = toSermon({ videoId: 'a', title: '20261115 Lễ 1 Bông trái - thời gian biểu và môn đồ (Công 2;32-41)',
    description: 'Bông trái - thời gian biểu và môn đồ (Công 2;32-41)', at: new Date('2026-11-15T09:05:00Z') });
  assert.equal(sun.type, 'chua-nhat');
  assert.equal(sun.service, 'Lễ 1');
  assert.equal(sun.title, 'Bông trái - thời gian biểu và môn đồ');
  assert.equal(sun.scripture, 'Công vụ 2:32-41');
  assert.equal(sun.summary, undefined);           // description only repeats the title
  const wed = toSermon({ videoId: 'b', title: '20261022 Thứ 4 Lập nhân sự truyền đạo nhóm (Công vụ 11;19-30)',
    at: new Date('2026-10-21T16:55:00Z') });
  assert.equal(wed.type, 'hang-ngay');
  assert.equal(wed.date, '2026-10-22');           // title date wins over upload time
  assert.deepEqual(wed.topics, ['Truyền giáo', 'Hội thánh & Nhóm']);
});
