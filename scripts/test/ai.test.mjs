import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { vttToText, pickCandidates, makeSchema, buildSystem, summarize } from '../ai-enrich.mjs';

const moods = JSON.parse(await fs.readFile(new URL('../../data/moods.json', import.meta.url), 'utf8')).moods;
const topics = JSON.parse(await fs.readFile(new URL('../../data/sermons.json', import.meta.url), 'utf8')).topics.map(t => t.name);

test('YouTube auto captions to text', () => {
  const vtt = `WEBVTT
Kind: captions
Language: vi

00:00:01.000 --> 00:00:03.000 align:start position:0%
xin<00:00:01.500><c> chào</c><c> anh chị em</c>

00:00:03.000 --> 00:00:03.010
xin chào anh chị em

00:00:03.010 --> 00:00:05.000
hôm nay chúng ta đọc Giăng 14
`;
  assert.equal(vttToText(vtt), 'xin chào anh chị em hôm nay chúng ta đọc Giăng 14');
});

test('which videos get summarized', () => {
  const now = Date.parse('2026-11-26T00:00:00Z');
  const videos = [
    { id: 'yt-a', type: 'chua-nhat', date: '2026-11-22', video: 'https://www.youtube.com/watch?v=a' },
    { id: 'yt-b', type: 'khac', date: '2026-11-23', video: 'https://www.youtube.com/watch?v=b' },        // hymn: skip
    { id: 'yt-c', type: 'giua-tuan', date: '2026-11-04', video: 'https://www.youtube.com/watch?v=c' },
    { id: 'yt-d', type: 'chua-nhat', date: '2026-11-15', video: 'https://www.youtube.com/watch?v=d' },
    { id: 'yt-e', type: 'chua-nhat', date: '2026-11-08', video: 'https://www.youtube.com/watch?v=e' },
  ];
  const items = {
    'yt-c': { status: 'ok', v: 1 },                                          // done
    'yt-d': { status: 'no-transcript', at: '2026-11-20T00:00:00Z' },         // retry later
    'yt-e': { status: 'no-transcript', at: '2026-10-01T00:00:00Z' },         // retry now
  };
  assert.deepEqual(pickCandidates(videos, items, now).map(v => v.id), ['yt-a', 'yt-e']);
  // only new videos: nothing before the cut-off date
  assert.deepEqual(pickCandidates(videos, items, now, '2026-11-10').map(v => v.id), ['yt-a']);
});

test('prompt lists the allowed topics and moods', () => {
  const s = buildSystem(topics, moods);
  assert.ok(s.includes('chan-nan: Chán nản, trầm cảm'));
  assert.ok(s.includes('Nước Thiên Đàng'));
});

test('summarize: parses structured output and handles refusals', async () => {
  const schema = await makeSchema(topics, moods);
  const good = {
    summary: 'Bài giảng nói về sự bình an.', keyPoints: ['Ý 1'], keyVerses: ['Giăng 14:27'], application: 'Cầu nguyện mỗi ngày.',
    topics: ['Sự bình an'], moods: ['lo-au'], speaker: '', transcriptQuality: 'tot',
  };
  let sent;
  const fake = body => ({ beta: { messages: { create: async p => (sent = p, body) } }, messages: { create: async p => (sent = p, body) } });
  const ok = await summarize(fake({ stop_reason: 'end_turn', model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 5 },
    content: [{ type: 'text', text: JSON.stringify(good) }] }), schema, 'sys', { title: 'T', date: '2026-11-22' }, 'bản ghi');
  assert.deepEqual(ok.data, good);
  assert.equal(sent.model, 'claude-opus-5-5');
  assert.equal(sent.fallbacks, 'default');
  assert.equal(sent.output_config.format.type, 'json_schema');
  assert.ok(sent.messages[0].content.includes('<ban_ghi>\nbản ghi\n</ban_ghi>'));

  const bad = await summarize(fake({ stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: JSON.stringify({ ...good, moods: ['khong-co'] }) }] }),
    schema, 'sys', { title: 'T' }, 'x');
  assert.equal(bad.error, 'kết quả không đúng định dạng');
  const refused = await summarize(fake({ stop_reason: 'refusal', stop_details: { category: 'bio' }, usage: {}, content: [] }), schema, 'sys', { title: 'T' }, 'x');
  assert.equal(refused.error, 'từ chối (bio)');
});
