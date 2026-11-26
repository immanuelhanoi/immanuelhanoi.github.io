import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { parseRss, toSermon, findScripture, findSpeaker, topicsFor, classify, parseTitle, fromYtDlpEntry, channelsFromConfig, isHymnTitle, parseHymnTitle, parseSource, videoIdOf } from '../sync-youtube.mjs';

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
  assert.equal(classify({ title: 'Sống đẹp lòng Chúa', at: monday }), 'giua-tuan');
  // an estimated date must not decide that a video is a Sunday service
  assert.equal(classify({ title: 'Sống đẹp lòng Chúa', at: sunday, atApprox: true }), 'giua-tuan');
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
  assert.equal(wed.type, 'giua-tuan');
  assert.equal(wed.date, '2026-10-22');           // title date wins over upload time
  assert.deepEqual(wed.topics, ['Truyền giáo', 'Hội thánh & Nhóm']);
});

test('camp, guest channel and hymn categories', () => {
  assert.equal(classify({ title: 'Remnant Camp tháng 11 - Bài 1 (Công 1;8)' }), 'camp');
  assert.equal(classify({ title: '20261012 [Trại hè] Thế hệ 237' }), 'camp');
  assert.equal(classify({ title: 'Ba sự kiện của Đấng Christ', channelType: 'su-diep' }), 'su-diep');
  assert.equal(classify({ title: 'Biệt thánh ca: Ân Điển', channelType: 'su-diep' }), 'khac');
  assert.equal(classify({ title: 'Bông trái của môn đồ' }), 'giua-tuan');   // "trái" is not "trại"
});

test('yt-dlp flat entries', () => {
  const v = fromYtDlpEntry({ id: 'abcdefghijk', title: '20250105 Lễ 1 Khởi đầu mới (Ê-sai 43;18-19)', duration: 3725, upload_date: '20250105', url: 'https://www.youtube.com/watch?v=abcdefghijk' });
  assert.equal(v.videoId, 'abcdefghijk');
  assert.equal(v.duration, '1:02:05');
  assert.equal(v.atApprox, true);
  assert.equal(fromYtDlpEntry({ id: 'x', live_status: 'is_upcoming' }), null);
  const s = toSermon({ ...v, channel: '@immanuelhanoi' });
  assert.equal(s.date, '2025-01-05');
  assert.equal(s.type, 'chua-nhat');
  assert.equal(s.scripture, 'Ê-sai 43:18-19');
  assert.equal(s.dateApprox, undefined);           // the title carries the real date
});

test('channel config', () => {
  assert.deepEqual(channelsFromConfig({ church: { youtubeChannel: 'immanuelhanoi' } }), [{ handle: '@immanuelhanoi' }]);
  assert.equal(channelsFromConfig({ church: { channels: [{ handle: '@a', type: 'su-diep' }] } })[0].type, 'su-diep');
});

// Cases seen in the real channel data
test('real channel quirks', () => {
  assert.equal(classify({ title: '20240107 Lễ1 Năm mới (Giăng 1;1)' }), 'chua-nhat');
  assert.equal(classify({ title: '20240107 [CN Lễ 2] Bài giảng (Mat 5;1)' }), 'chua-nhat');
  assert.equal(classify({ title: '20250813 [Tĩnh nguyện] Lý do nhận chúc phúc (Phục 15;1-6)' }), 'hang-ngay');
  assert.equal(classify({ title: '20250701 [Kinh thánh hè] Ngày 1' }), 'camp');
  assert.equal(parseTitle('202261115 Với những người bỏ lỡ lễ thu hoạch (Ê sai 6;1-13)').title, 'Với những người bỏ lỡ lễ thu hoạch');
  // "20270927" is a typo for 2026: use the upload date instead of a date a year ahead
  const typo = toSermon({ videoId: 't', title: '20270927 Lập tháp canh (Giô 10;12-14)', at: new Date('2026-09-27T03:00:00Z') });
  assert.equal(typo.date, '2026-09-27');
  // the guest channel's short book names
  assert.equal(findScripture('(Êx 37;1-10)'), 'Ê-xê-chi-ên 37:1-10');
  assert.equal(findScripture('(Giô 10;12-14)'), 'Giô-suê 10:12-14');
  assert.equal(findScripture('(Phục 15;1-6)'), 'Phục truyền luật lệ ký 15:1-6');
  assert.equal(findScripture('(I Sam 7;1-15)'), '1 Sa-mu-ên 7:1-15');
  assert.equal(findScripture('(II Vua 2;9-11)'), '2 Các vua 2:9-11');
  assert.equal(findScripture('(I Phi 1;3-9)'), '1 Phi-e-rơ 1:3-9');
  assert.equal(findScripture('(Giô-na 1;3)'), 'Giô-na 1:3');
  assert.equal(findScripture('(Giăng 3;16)'), 'Giăng 3:16');
});

test('youth group and hand-added videos', () => {
  assert.equal(classify({ title: '20250927 [TTN] Ân điển đặc biệt của Phao lô (Phil 2;9-11)' }), 'thanh-thieu-nien');
  assert.equal(classify({ title: 'Bất kỳ tiêu đề nào', forceType: 'camp' }), 'camp');
  assert.equal(videoIdOf('https://m.youtube.com/watch?v=ztWHi656unc&pp=4gcGEgR6YWxv'), 'ztWHi656unc');
  assert.equal(videoIdOf('https://youtu.be/ztWHi656unc'), 'ztWHi656unc');
});

test('hymn sources and titles', () => {
  assert.deepEqual(parseSource({ handle: 'https://youtube.com/@onewayradioonline?si=F4uq' }),
    { kind: 'channel', id: '@onewayradioonline', url: 'https://www.youtube.com/@onewayradioonline/videos' });
  assert.equal(parseSource({ playlist: 'https://www.youtube.com/playlist?list=PLabcdefghijkl' }).id, 'PLabcdefghijkl');
  // keep hymns, drop everything else a hymn channel posts
  assert.equal(isHymnTitle('Thánh Ca 123 - Nương Cậy Chúa | Oneway'), true);
  assert.equal(isHymnTitle('TC 45 Ân Điển Lạ Lùng'), true);
  assert.equal(isHymnTitle('Karaoke Thánh ca - Chúa Chăn Giữ Tôi'), true);
  assert.equal(isHymnTitle('Bài giảng: Sống đắc thắng | Mục sư A'), false);
  assert.equal(isHymnTitle('Chương trình Tâm tình mỗi tối 12/11'), false);
  assert.equal(isHymnTitle('Lễ thờ phượng Chúa Nhật 10/11/2024'), false);
  assert.equal(isHymnTitle('Podcast: Đức tin và công việc'), false);
  assert.equal(isHymnTitle('Linh hồn tôi bình an', { filter: 'all' }), true);   // karaoke channel: everything except excluded words
  assert.deepEqual(parseHymnTitle('Thánh Ca 123 - Nương Cậy Chúa (Karaoke) | Oneway'), { so: 'Thánh ca 123', ten: 'Nương Cậy Chúa' });
  assert.deepEqual(parseHymnTitle('TC 045: Ân Điển Lạ Lùng [Lyrics]'), { so: 'Thánh ca 45', ten: 'Ân Điển Lạ Lùng' });
  assert.deepEqual(parseHymnTitle('Chúa Chăn Giữ Tôi'), { so: '', ten: 'Chúa Chăn Giữ Tôi' });
});
