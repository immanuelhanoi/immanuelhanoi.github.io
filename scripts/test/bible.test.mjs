import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUsfm, cleanUsfm, fixLegacyVni } from '../fetch-bible.mjs';

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

// Real artifacts found in eBible vie1934
test('legacy VNI capitals and kỳ', () => {
  const cases = {
    'Aáy vậy': 'Ấy vậy', 'Aân điển ta đủ': 'Ân điển ta đủ', 'Aùnh sáng': 'Ánh sáng', 'Oâng hãy đứng dậy': 'Ông hãy đứng dậy',
    'Eân-na-than': 'Ên-na-than', 'Eùc-ba-tan': 'Éc-ba-tan', 'Oùc, vua Ba-san': 'Óc, vua Ba-san', 'Aït-ta-xét-xe': 'Ạt-ta-xét-xe',
    'Oït-na': 'Ọt-na', 'Uûa?': 'Ủa?', 'Uùt-xơ': 'Út-xơ', 'Aên cắp': 'Ăn cắp', 'Aét tôi sẽ thuật': 'Ắt tôi sẽ thuật',
    'Oáng bễ': 'Ống bễ', 'Eách-ra-hít': 'Ếch-ra-hít', 'Aâm phủ': 'Âm phủ',
    'trong một k” ấy.': 'trong một kỳ ấy.', 'K” đã trọn': 'Kỳ đã trọn', 'ngọc hu”nh bích': 'ngọc huỳnh bích',
  };
  for (const [bad, good] of Object.entries(cases)) assert.equal(fixLegacyVni(bad), good, bad);
  // real closing quotes and ordinary words stay as they are
  for (const ok of ['“A-men” được?', 'của tôi”;', 'Đấng Yên ủi', 'Uống rượu', 'Đây là', 'Ai nấy', 'Em-ma-nu-ên', 'Ông']) assert.equal(fixLegacyVni(ok), ok);
});
