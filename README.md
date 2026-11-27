# App Bài giảng – Hội thánh Immanuel Hà Nội

Ứng dụng xem **bài giảng video** của Mục sư, **tìm theo chủ đề**, theo dõi **thờ phượng Chúa Nhật**
và **tĩnh nguyện hằng ngày**, kèm **thông báo câu Kinh Thánh mỗi sáng**.

- 🌐 **Bản web**: dùng trên mọi điện thoại/máy tính, có thể “Thêm vào màn hình chính”.
- 📱 **App Android (.apk)**: có thêm thông báo nhắc nhở hằng ngày.
- 🔄 **Tự cập nhật**: video mới trên kênh [youtube.com/@immanuelhanoi](https://www.youtube.com/@immanuelhanoi)
  tự xuất hiện trong app, không cần nhập tay, không cần cài lại app.

## Cách hoạt động

```
Kênh YouTube @immanuelhanoi
        │  GitHub Actions chạy tự động: 6h17 & 17h47 mỗi ngày,
        │  và 10h, 13h, 16h Chúa Nhật (ngay sau giờ thờ phượng)
        ▼
data/youtube.json  ── tự phân loại: Chúa Nhật / Hằng ngày / Video khác
        │              tự gắn chủ đề, câu Kinh Thánh, tên diễn giả
        ▼
Trang web (GitHub Pages) ◄── App Android tải dữ liệu từ đây mỗi lần mở
```

Thông báo câu Kinh Thánh được **hẹn sẵn ngay trên điện thoại** (60 ngày tới, tự gia hạn mỗi lần mở app).
Thông báo vẫn hiện khi không có mạng và không cần máy chủ. Ngày nào có bài tĩnh nguyện thì thông báo
dùng câu gốc của bài đó; ngày khác lấy lần lượt từ `data/verses.json`.

## Cài đặt lần đầu (làm một lần)

1. **Gộp code vào nhánh `main`** (tạo Pull Request rồi Merge).
2. **Bật GitHub Pages**: *Settings → Pages → Build and deployment → Source:* chọn **GitHub Actions**.
3. Vào tab **Actions** → chọn **“Cập nhật video & đăng web”** → **Run workflow**.
   Sau 1–2 phút, web chạy tại: **https://immanuelhanoi.github.io/**
4. Workflow **“Đóng gói app Android”** tự chạy. Sau khoảng 5–10 phút, file APK có tại:
   **https://github.com/immanuelhanoi/immanuelhanoi.github.io/releases/tag/app-android**

### Cài app lên điện thoại Android
Mở link Releases ở trên bằng điện thoại → tải `immanuel-hanoi.apk` → mở file → cho phép
“Cài ứng dụng không rõ nguồn” → Cài đặt. Mở app, bấm 🔔 để bật nhắc nhở.

### iPhone
Mở trang web bằng Safari → nút Chia sẻ → **Thêm vào MH chính**.

### Đưa lên CH Play và App Store
Xem hướng dẫn từng bước: **[store/HUONG-DAN.md](store/HUONG-DAN.md)**. Không cần máy Mac: GitHub build cả bản iPhone.

## Tuỳ chọn nâng cao

| Việc | Cách làm |
|---|---|
| **Lấy toàn bộ video cũ của kênh** (mặc định chỉ lấy 15 video mới nhất, sau đó tích luỹ dần) | Tạo khoá *YouTube Data API v3* miễn phí trên Google Cloud Console, thêm vào *Settings → Secrets and variables → Actions* với tên `YOUTUBE_API_KEY`. |
| **Cập nhật APK mà không phải gỡ app cũ** / đưa lên CH Play | Tạo khoá ký: xem [store/HUONG-DAN.md](store/HUONG-DAN.md) mục A1. |
| **Sửa thông tin một video** (tên diễn giả, chủ đề, dàn bài…) | Thêm vào `"sermons"` trong `data/sermons.json` một mục có cùng link `video`; các trường điền ở đây sẽ thay cho thông tin tự động. Trang `#/them` có biểu mẫu tạo sẵn đoạn mã. |
| **Ẩn video không phải bài giảng** | Thêm `{ "video": "link-youtube", "hidden": true }` vào `"sermons"`. |
| **Thêm bài không có trên YouTube** | Dùng biểu mẫu ở `#/them`, dán vào `"sermons"`. |
| **Đổi câu Kinh Thánh trong thông báo** | Sửa `data/verses.json`. |
| **Cập nhật ngay** (không chờ lịch) | Actions → “Cập nhật video & đăng web” → Run workflow. |

Không có video mới thì app cũng không cần cài lại. Chỉ khi đổi giao diện/tính năng mới cần cài APK mới.

### Quy tắc phân loại tự động
- Tiêu đề có *tĩnh nguyện, hằng ngày, mỗi ngày, linh lương…* → **Hằng ngày**
- Tiêu đề có *Chúa Nhật, thờ phượng, bài giảng…*, hoặc video phát vào Chúa Nhật → **Chúa Nhật**
- *Thánh ca, biệt thánh ca, tôn vinh*, Shorts… → **Video khác** (vẫn tìm được)
- Chủ đề lấy theo từ khoá trong tiêu đề/mô tả (danh sách trong `scripts/sync-youtube.mjs`).

Phân loại sai thì sửa tay theo bảng trên, hoặc nhờ chỉnh từ khoá cho khớp cách đặt tên video của kênh.

## Tóm tắt sứ điệp bằng AI (tuỳ chọn, có phí)

Mỗi lần chạy, workflow lấy **phụ đề tiếng Việt** của video (phụ đề tự động của YouTube) và nhờ **Claude**
(AI của Anthropic) viết: tóm tắt 3–5 câu, ý chính, câu Kinh Thánh chính, gợi ý áp dụng, chủ đề, và
**những tâm trạng bài giảng có thể khích lệ**. Phần này giúp trang *Tâm tình* gợi ý đúng bài hơn nhiều.

**Bật:** tạo khoá tại console.anthropic.com (nạp tiền trả trước), rồi thêm secret `ANTHROPIC_API_KEY`
trong *Settings → Secrets and variables → Actions*. Không có khoá thì bước này tự bỏ qua, không tốn gì.

**Chi phí ước tính** (một bài giảng ~1 giờ ≈ 20–30 nghìn token):

| Model (đặt trong *Variables* → `AI_MODEL`) | Mỗi bài | ~600 bài cũ | Hằng tháng (~15 bài mới) |
|---|---|---|---|
| `claude-opus-5-5` (mặc định, chất lượng cao nhất) | ~0,12 USD | ~70 USD | ~2 USD |
| `claude-sonnet-5-5` | ~0,06 USD | ~35 USD | ~1 USD |
| `claude-haiku-5-5` (rẻ nhất) | ~0,003 USD | ~2 USD | < 0,1 USD |

Mặc định tóm tắt **8 bài mỗi lần chạy** (2 lần/ngày) để chi phí rải đều; muốn nhanh hơn: *Run workflow*
và tăng *Số bài tóm tắt AI*. Có thể đặt giới hạn chi tiêu hằng tháng trong console.anthropic.com.
Tóm tắt do AI viết nên có thể chưa chính xác hoàn toàn; app ghi rõ điều này dưới mỗi bản tóm tắt.

## Thêm kênh YouTube, Thánh ca, Tâm trạng

- **Kênh:** `data/sermons.json` → `church.channels`. Kênh có `"type": "su-diep"` hiện thành mục riêng.
- **Thánh ca:** `data/hymns.json` — số bài, tên, tâm trạng/chủ đề phù hợp, link video (không chép lời).
- **Tâm trạng & câu Kinh Thánh an ủi:** `data/moods.json`.
- **Lấy lại toàn bộ video cũ:** *Actions → Cập nhật video & đăng web → Run workflow →* tick *Lấy lại TOÀN BỘ video*.

## Hành trình Kinh Thánh

- Nội dung trong `data/journeys.json`: 2 lộ trình (**Theo dòng Kinh Thánh**: 17 chặng; **Theo nhân vật**: 16 chặng), mỗi chặng có bài đọc, câu gốc và 5 câu hỏi (`a` = vị trí đáp án đúng, tính từ 0). Qua chặng khi đúng từ 4/5 câu; tiến độ lưu trên máy người dùng.
- Chữ Kinh Thánh (Bản Truyền Thống 1926, phạm vi công cộng) do GitHub tự tải một lần vào `data/bible/` (`scripts/fetch-bible.mjs`); khi chưa có thì app mở bible.com.
- Mỗi lần chạy, bài kiểm thử tự kiểm tra dữ liệu hành trình (sai vị trí đáp án, sai tên sách/chương…) trước khi đăng web.

## Kinh Thánh & Sổ tay cảm nghĩ

- Tab **Kinh Thánh**: tìm nhanh theo tham chiếu ("Giăng 3:16"), đọc theo sách/chương, đọc tiếp chỗ đang đọc, Hành trình, Sổ tay.
- Khi đọc: chạm vào câu để chọn (một câu hoặc cả đoạn) → **Viết cảm nghĩ**. Ghi chép lưu trên máy người dùng (không gửi đi đâu); có tìm kiếm, sửa, xoá, chia sẻ, và **lưu/khôi phục bản sao** (file .json) khi đổi điện thoại.

## Cập nhật giao diện
- Mỗi lần đăng web có một mã phiên bản (`version.json`); trình duyệt luôn tải giao diện mới sau khi cập nhật.
- App Android đã cài mang sẵn giao diện bên trong; khi web có phiên bản mới, app hiện thông báo **“Đã có phiên bản mới”** kèm nút tải APK. (Bài giảng, thánh ca, câu Kinh Thánh… thì app luôn tự cập nhật, không cần cài lại.)

## Dành cho người phát triển

```bash
npm install
npm run serve            # xem web tại http://localhost:8000
npm test                 # kiểm thử phần đồng bộ YouTube
npm run sync-youtube     # lấy video mới (cần mạng tới YouTube)
npm run native:prepare   # cập nhật icon & chép giao diện vào android/ và ios/
```

```
index.html, css/, js/       Giao diện web (js/config.js: địa chỉ web & link APK)
data/sermons.json           Chủ đề + bài thêm/sửa tay
data/youtube.json           Video tự động từ kênh (do GitHub Actions ghi)
data/verses.json            Câu Kinh Thánh cho thông báo
scripts/sync-youtube.mjs    Đồng bộ & phân loại video
.github/workflows/          Tự động cập nhật, đăng web, build APK
android/, ios/              Dự án app Android & iPhone (Capacitor)
capacitor.config.json       Cấu hình app
store/                      Hướng dẫn & ảnh cho cửa hàng
privacy.html                Chính sách quyền riêng tư
```
