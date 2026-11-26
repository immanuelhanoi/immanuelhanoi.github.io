# App Bài giảng – Hội thánh Imanuel Hà Nội

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
Mở link Releases ở trên bằng điện thoại → tải `imanuel-hanoi.apk` → mở file → cho phép
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
