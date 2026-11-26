#!/usr/bin/env node
/**
 * Tóm tắt bài giảng bằng AI (Claude) và gắn tâm trạng / chủ đề — ghi vào data/ai.json.
 *
 * Với mỗi video chưa có tóm tắt (mới nhất trước):
 *   1. lấy phụ đề tiếng Việt của video bằng yt-dlp (phụ đề tự động của YouTube),
 *   2. gửi phụ đề cho Claude để tóm tắt, rút ý chính, câu Kinh Thánh chính,
 *      chọn chủ đề và tâm trạng mà bài giảng có thể khích lệ.
 *
 * Chỉ chạy khi có ANTHROPIC_API_KEY (có tính phí theo lượng dùng). Không có khoá thì chỉ kiểm tra
 * xem có lấy được phụ đề không (--probe), không tốn tiền.
 *
 * Biến môi trường:
 *   ANTHROPIC_API_KEY   khoá API (GitHub secret)
 *   AI_MODEL            mặc định claude-opus-5-5
 *   AI_EFFORT           low | medium | high (mặc định low — tóm tắt là việc đơn giản)
 *   AI_MAX_PER_RUN      số bài tối đa mỗi lần chạy (mặc định 8)
 *
 *   node scripts/ai-enrich.mjs            # tóm tắt tối đa AI_MAX_PER_RUN bài
 *   node scripts/ai-enrich.mjs --probe    # chỉ thử lấy phụ đề 1 video, không gọi AI
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AI_FILE = path.join(ROOT, 'data/ai.json');
const run = promisify(execFile);

const MODEL = process.env.AI_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.AI_EFFORT || 'low';
const MAX_PER_RUN = +(process.env.AI_MAX_PER_RUN || 8);
const PROMPT_VERSION = 1;             // bump to re-summarize everything after changing the prompt
const RETRY_NO_TRANSCRIPT_DAYS = 14;  // captions often appear a few days after upload
const MIN_TRANSCRIPT_CHARS = 1500;    // shorter than this is not a sermon we can summarize
const MAX_TRANSCRIPT_CHARS = 400_000; // ~5 hours of speech; longer is almost certainly a mistake

// $ per million tokens (input, output) — for the cost line in the log only
const PRICES = {
  'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5], 'claude-fable-5-2': [8, 40],
};
// server-side refusal fallback is available on these; Haiku has none
const SUPPORTS_FALLBACK = /^claude-(opus-5|sonnet-5-5|fable-5)/;

/* ---------------- captions ---------------- */

/** WebVTT from YouTube (auto captions repeat each line as it scrolls) → plain text. */
export function vttToText(vtt) {
  const out = [];
  for (let line of String(vtt).split(/\r?\n/)) {
    line = line.trim();
    if (!line || line === 'WEBVTT' || /^(Kind|Language|NOTE|STYLE)\b/.test(line) || line.includes('-->') || /^\d+$/.test(line)) continue;
    line = line.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    if (!line || line === out[out.length - 1]) continue;
    out.push(line);
  }
  return out.join(' ');
}

export async function fetchTranscript(videoId) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'subs-'));
  try {
    await run('yt-dlp', ['--skip-download', '--write-subs', '--write-auto-subs', '--sub-langs', 'vi,vi-orig,vi.*',
      '--sub-format', 'vtt', '--no-warnings', '--no-progress', '-o', path.join(dir, '%(id)s.%(ext)s'),
      `https://www.youtube.com/watch?v=${videoId}`], { timeout: 3 * 60 * 1000, maxBuffer: 32 * 1024 * 1024 }).catch(e => {
      // yt-dlp exits non-zero when one of several caption tracks fails; a file may still have been written
      if (!/subtitles|Unable to download video subtitles/i.test(String(e.stderr || ''))) throw e;
    });
    const files = (await fs.readdir(dir)).filter(f => f.endsWith('.vtt'))
      // prefer captions the church uploaded (".vi.vtt") over YouTube's automatic ones
      .sort((a, b) => (/\.vi\.vtt$/.test(b) ? 1 : 0) - (/\.vi\.vtt$/.test(a) ? 1 : 0));
    if (!files.length) return { text: '', reason: 'không có phụ đề tiếng Việt' };
    return { text: vttToText(await fs.readFile(path.join(dir, files[0]), 'utf8')), track: files[0].replace(/^[^.]+\./, '') };
  } catch (e) {
    return { text: '', reason: String(e.stderr || e.message).split('\n').filter(Boolean).pop()?.slice(0, 200) || 'lỗi' };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/* ---------------- Claude ---------------- */

export function buildSystem(topics, moods) {
  return `Bạn tóm tắt bài giảng cho ứng dụng của Hội thánh Tin Lành Immanuel Hà Nội, giúp tín hữu tìm đúng sứ điệp khi cần.

Bản ghi là phụ đề tự động của YouTube nên có thể sai chính tả, sai từ, thiếu dấu câu; hãy hiểu theo ngữ cảnh.
Chỉ tóm tắt những gì diễn giả thực sự giảng. Không thêm giáo lý, ý kiến hay lời khuyên không có trong bài.
Viết tiếng Việt tự nhiên, ấm áp, dễ hiểu; dùng thuật ngữ quen thuộc của Hội thánh Tin Lành Việt Nam.

Các trường cần trả về:
- summary: 3–5 câu nêu sứ điệp chính của bài.
- keyPoints: 3–5 ý chính, mỗi ý một câu ngắn.
- keyVerses: tham chiếu các câu Kinh Thánh diễn giả đọc hoặc nhấn mạnh (vd "Giăng 14:6", "Công vụ 1:8"), tên sách theo bản Truyền Thống 1926. Chỉ ghi tham chiếu, không chép nội dung câu. Không đoán nếu không nghe rõ.
- application: 1–2 câu: người nghe có thể áp dụng điều gì trong tuần này.
- topics: các chủ đề phù hợp, chỉ chọn trong danh sách: ${topics.join(', ')}.
- moods: những tâm trạng mà người đang trải qua có thể được bài giảng này an ủi hoặc khích lệ rõ rệt (để trống nếu không có). Danh sách:
${moods.map(m => `  ${m.id}: ${m.name}`).join('\n')}
- speaker: tên diễn giả nếu bài giảng nói rõ (vd "Mục sư Nguyễn Văn A"), nếu không thì chuỗi rỗng.
- transcriptQuality: "tot", "trung-binh" hoặc "kem". Nếu bản ghi quá kém để hiểu, chọn "kem" và chỉ tóm tắt những gì chắc chắn.`;
}

export async function makeSchema(topics, moods) {
  const { z } = await import('zod');
  return z.object({
    summary: z.string(),
    keyPoints: z.array(z.string()),
    keyVerses: z.array(z.string()),
    application: z.string(),
    topics: z.array(z.enum(topics)),
    moods: z.array(z.enum(moods.map(m => m.id))),
    speaker: z.string(),
    transcriptQuality: z.enum(['tot', 'trung-binh', 'kem']),
  });
}

export async function summarize(client, schema, system, video, transcript) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const { zodOutputFormat } = await import('@anthropic-ai/sdk/helpers/zod');
  const params = {
    model: MODEL,
    max_tokens: 16000,
    system,
    output_config: { effort: EFFORT, format: zodOutputFormat(schema) },
    messages: [{
      role: 'user',
      content: `Tiêu đề: ${video.raw?.title || video.title}\nNgày: ${video.date || 'không rõ'}\n\n<ban_ghi>\n${transcript}\n</ban_ghi>`,
    }],
  };
  let response;
  try {
    response = SUPPORTS_FALLBACK.test(MODEL)
      // if a safety classifier declines, the API retries on Anthropic's recommended fallback model
      ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      : await client.messages.create(params);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('ANTHROPIC_API_KEY không hợp lệ');
    if (e instanceof Anthropic.RateLimitError) throw new Error('vượt giới hạn tốc độ — lần chạy sau sẽ tiếp tục');
    throw e;
  }
  if (response.stop_reason === 'refusal') return { error: `từ chối (${response.stop_details?.category || 'không rõ'})`, usage: response.usage };
  if (response.stop_reason === 'max_tokens') return { error: 'câu trả lời bị cắt (max_tokens)', usage: response.usage };
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  let parsed;
  try { parsed = schema.safeParse(JSON.parse(text)); } catch { parsed = { success: false }; }
  if (!parsed.success) return { error: 'kết quả không đúng định dạng', usage: response.usage };
  return { data: parsed.data, usage: response.usage, model: response.model };
}

const cost = (usage, model) => {
  const [inP, outP] = PRICES[model] || PRICES['claude-opus-5-5'];
  return ((usage?.input_tokens || 0) * inP + (usage?.output_tokens || 0) * outP) / 1e6;
};

/* ---------------- main ---------------- */

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

export function pickCandidates(videos, items, now = Date.now()) {
  const retryMs = RETRY_NO_TRANSCRIPT_DAYS * 864e5;
  return videos
    .filter(v => v.type !== 'khac' && v.video)
    .filter(v => {
      const it = items[v.id];
      if (!it) return true;
      if (it.status === 'ok') return (it.v || 0) < PROMPT_VERSION;
      return now - Date.parse(it.at || 0) > retryMs;   // no captions / error: try again later
    })
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

async function main() {
  const probe = process.argv.includes('--probe');
  const [yt, cfg, moodsFile, ai] = await Promise.all([
    readJson(path.join(ROOT, 'data/youtube.json'), { videos: [] }),
    readJson(path.join(ROOT, 'data/sermons.json'), {}),
    readJson(path.join(ROOT, 'data/moods.json'), { moods: [] }),
    readJson(AI_FILE, { items: {} }),
  ]);
  const topics = (cfg.topics || []).map(t => t.name);
  const moods = moodsFile.moods || [];
  const candidates = pickCandidates(yt.videos || [], ai.items || {});
  const id = v => v.video.split('v=')[1];

  if (probe || !process.env.ANTHROPIC_API_KEY) {
    if (!probe) console.log('Chưa có ANTHROPIC_API_KEY — bỏ qua tóm tắt AI. Thử lấy phụ đề 1 video để kiểm tra:');
    const v = candidates[0];
    if (!v) return console.log('Không có video nào cần tóm tắt.');
    const t = await fetchTranscript(id(v));
    console.log(t.text ? `  ✓ ${v.title}: ${t.text.length} ký tự phụ đề (${t.track}). Mẫu: "${t.text.slice(0, 160)}…"`
      : `  ✗ ${v.title}: ${t.reason}`);
    return;
  }

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const schema = await makeSchema(topics, moods);
  const system = buildSystem(topics, moods);
  ai.items = ai.items || {};
  let done = 0, spent = 0;
  console.log(`${candidates.length} bài chờ tóm tắt; lần này tối đa ${MAX_PER_RUN} (model ${MODEL}, effort ${EFFORT}).`);

  for (const v of candidates.slice(0, MAX_PER_RUN)) {
    const t = await fetchTranscript(id(v));
    const now = new Date().toISOString();
    if (t.text.length < MIN_TRANSCRIPT_CHARS) {
      ai.items[v.id] = { status: 'no-transcript', reason: t.reason || `phụ đề quá ngắn (${t.text.length})`, at: now };
      console.log(`  – ${v.title}: ${ai.items[v.id].reason}`);
    } else {
      if (t.text.length > MAX_TRANSCRIPT_CHARS) {
        ai.items[v.id] = { status: 'too-long', reason: `${t.text.length} ký tự`, at: now };
        console.log(`  – ${v.title}: phụ đề quá dài (${t.text.length} ký tự), bỏ qua`);
      } else {
        try {
          const r = await summarize(client, schema, system, v, t.text);
          spent += cost(r.usage, MODEL);
          if (r.error) {
            ai.items[v.id] = { status: 'error', reason: r.error, at: now };
            console.log(`  ✗ ${v.title}: ${r.error}`);
          } else {
            ai.items[v.id] = { status: 'ok', v: PROMPT_VERSION, ...r.data, model: r.model, chars: t.text.length, at: now };
            done++;
            console.log(`  ✓ ${v.title} (${r.usage.input_tokens}+${r.usage.output_tokens} tokens)`);
          }
        } catch (e) {
          console.log(`  ✗ ${v.title}: ${e.message}`);
          if (/không hợp lệ|giới hạn/.test(e.message)) break;
        }
      }
    }
    // save after every video so a cancelled run keeps its progress
    ai.updatedAt = now;
    await fs.writeFile(AI_FILE, JSON.stringify(ai, null, 2) + '\n');
  }
  console.log(`Xong: ${done} bài tóm tắt mới, ước tính ~$${spent.toFixed(3)}. Còn lại ${Math.max(0, candidates.length - MAX_PER_RUN)} bài.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(e => { console.error('Lỗi tóm tắt AI:', e.message); process.exit(1); });
}
