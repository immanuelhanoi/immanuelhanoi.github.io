import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// Guards data/journeys.json against editing mistakes (wrong answer index, unknown book, chapter out of range…)
const J = JSON.parse(await fs.readFile(new URL('../../data/journeys.json', import.meta.url), 'utf8'));
const books = Object.fromEntries(J.books.map(b => [b.code, b]));

test('journey data is consistent', () => {
  assert.equal(J.books.length, 66);
  assert.ok(J.passScore > 0 && J.passScore <= 1);
  for (const t of J.tracks) {
    const ids = new Set();
    for (const s of t.stages) {
      const where = `${t.id}/${s.id}`;
      assert.ok(!ids.has(s.id), `${where}: id trùng`); ids.add(s.id);
      assert.ok(s.title && s.intro && s.emoji && s.era, `${where}: thiếu tiêu đề/giới thiệu`);
      assert.ok(s.readings.length, `${where}: chưa có bài đọc`);
      for (const r of s.readings) {
        assert.ok(books[r.book], `${where}: không có sách ${r.book}`);
        assert.ok(r.from >= 1 && r.from <= r.to && r.to <= books[r.book].chapters, `${where}: chương ${r.from}-${r.to} của ${r.book}`);
      }
      assert.ok(books[s.verse.book] && s.verse.ch <= books[s.verse.book].chapters, `${where}: câu gốc`);
      assert.ok(s.quiz.length >= 3, `${where}: cần ít nhất 3 câu hỏi`);
      for (const q of s.quiz) {
        assert.ok(Number.isInteger(q.a) && q.a >= 0 && q.a < q.options.length, `${where}: đáp án sai vị trí — ${q.q}`);
        assert.equal(new Set(q.options.map(o => o.t)).size, q.options.length, `${where}: lựa chọn trùng — ${q.q}`);
        assert.ok(q.why && q.ref, `${where}: thiếu giải thích/tham chiếu — ${q.q}`);
      }
    }
  }
});
