import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUsfm, cleanUsfm } from '../fetch-bible.mjs';

// Markup seen in eBible USFM files: headings, paragraphs, poetry lines, footnotes, word markers, several verses per line
const SAMPLE = String.raw`\id GEN Vietnamese Bible 1926
\h Sáng-thế Ký
\toc1 Sáng-thế Ký
\mt1 Sáng-thế Ký
\c 1
\s1 Sự sáng tạo
\p
\v 1 Ban đầu Đức Chúa Trời dựng nên trời đất.
\v 2 Vả, đất là vô-hình và trống không,\f + \fr 1:2 \ft chú thích\f* sự mờ-tối ở trên mặt vực;
Thần Đức Chúa Trời vận-hành trên mặt nước.
\v 3 Đức Chúa Trời phán rằng: Phải có sự sáng; \v 4 thì có sự sáng.
\c 2
\q1
\v 1 \w Ấy|strong="H1"\w* vậy, trời đất
\q2 và muôn vật đã dựng nên xong rồi.
\v 2 \nd Đức Giê-hô-va\nd* nghỉ.
`;

test('USFM to verses', () => {
  const b = parseUsfm(SAMPLE);
  assert.equal(b.code, 'GEN');
  assert.equal(b.chapters.length, 2);
  assert.deepEqual(b.chapters[0], [
    'Ban đầu Đức Chúa Trời dựng nên trời đất.',
    'Vả, đất là vô-hình và trống không, sự mờ-tối ở trên mặt vực; Thần Đức Chúa Trời vận-hành trên mặt nước.',
    'Đức Chúa Trời phán rằng: Phải có sự sáng;',
    'thì có sự sáng.',
  ]);
  assert.deepEqual(b.chapters[1], ['Ấy vậy, trời đất và muôn vật đã dựng nên xong rồi.', 'Đức Giê-hô-va nghỉ.']);
});

test('markup cleanup', () => {
  assert.equal(cleanUsfm(String.raw`\+w lời|x\+w* \x - \xo 1:1 \xt Giăng 1:1\x* Chúa`), 'lời Chúa');
});
