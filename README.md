# App Bài giảng – Hội thánh Imanuel Hà Nội

Ứng dụng web (cài được lên điện thoại như app) để xem **bài giảng video** của Mục sư,
**tìm theo chủ đề**, và theo dõi **thờ phượng Chúa Nhật** cùng **tĩnh nguyện hằng ngày**.

## Tính năng

| Màn hình | Nội dung |
|---|---|
| **Trang chủ** | Tĩnh nguyện hôm nay, bài giảng Chúa Nhật mới nhất, chủ đề |
| **Chúa Nhật** | Danh sách bài giảng hằng tuần, lọc theo loạt bài |
| **Hằng ngày** | Lịch 14 ngày, chọn ngày để xem bài tĩnh nguyện |
| **Chủ đề** | Đức tin, Cầu nguyện, Gia đình, Ân điển… kèm số bài |
| **Tìm kiếm** | Theo tên bài, câu Kinh Thánh, chủ đề, diễn giả. Gõ **không dấu** vẫn tìm được |
| **Chi tiết bài** | Video YouTube, câu gốc, dàn bài, câu hỏi suy ngẫm, lời cầu nguyện, chia sẻ, lưu |
| **Đã lưu** | Các bài đã bấm ♡ (lưu trên máy) |
| **#/them** | Biểu mẫu giúp người quản lý tạo nội dung bài mới (không cần biết code) |

Không cần máy chủ hay cơ sở dữ liệu: toàn bộ nội dung nằm trong một file `data/sermons.json`.

## Chạy thử trên máy

```bash
python3 -m http.server 8000
# mở http://localhost:8000
```

## Thêm bài giảng mới

**Cách dễ:** mở `http://.../#/them`, điền form, dán link YouTube, bấm **Sao chép**,
rồi dán vào danh sách `"sermons"` trong `data/sermons.json`.

**Hoặc sửa trực tiếp** `data/sermons.json`:

```json
{
  "id": "cn-2026-11-29",
  "type": "chua-nhat",
  "title": "Tên bài giảng",
  "speaker": "Mục sư ...",
  "date": "2026-11-29",
  "video": "https://www.youtube.com/watch?v=XXXXXXXXXXX",
  "series": "Tên loạt bài (nếu có)",
  "scripture": "Giăng 3:16",
  "verse": "Câu Kinh Thánh...",
  "topics": ["Đức tin", "Ân điển"],
  "summary": "Tóm tắt...",
  "points": ["Ý 1", "Ý 2"],
  "questions": ["Câu hỏi suy ngẫm"],
  "prayer": "Lời cầu nguyện (cho bài hằng ngày)"
}
```

- `type`: `"chua-nhat"` (thờ phượng Chúa Nhật) hoặc `"hang-ngay"` (tĩnh nguyện).
- `video`: link YouTube nào cũng được (watch, youtu.be, live, shorts).
- `id`: phải khác nhau giữa các bài.
- Chủ đề mới chỉ cần ghi vào `topics` là tự xuất hiện; muốn có biểu tượng thì thêm vào danh sách `"topics"` ở đầu file.

> ⚠️ Các bài hiện có trong `data/sermons.json` là **dữ liệu mẫu**, chưa gắn video.
> Hãy thay bằng bài giảng thật của Hội thánh.

## Đưa lên mạng miễn phí (GitHub Pages)

1. Vào **Settings → Pages** của repository.
2. *Source*: **Deploy from a branch**, chọn nhánh và thư mục `/ (root)`.
3. Sau 1–2 phút, app có địa chỉ dạng `https://<tên>.github.io/<repo>/`.
4. Trên điện thoại: mở link → **Thêm vào màn hình chính** để dùng như app.

## Cấu trúc

```
index.html            Khung trang + thanh điều hướng
css/style.css         Giao diện (tự động sáng/tối)
js/app.js             Logic: định tuyến, tìm kiếm, hiển thị
data/sermons.json     Nội dung bài giảng & tĩnh nguyện
sw.js, manifest.*     Cài như app, xem được khi mất mạng
```

## Hướng phát triển tiếp

- Tự động lấy video mới từ kênh YouTube của Hội thánh (YouTube Data API).
- Thông báo nhắc tĩnh nguyện mỗi sáng.
- Trang quản trị có đăng nhập để thêm bài mà không cần sửa file.
- Đóng gói thành app Android/iOS (Capacitor) nếu cần đưa lên cửa hàng ứng dụng.
