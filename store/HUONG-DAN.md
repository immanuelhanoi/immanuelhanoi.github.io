# Đưa app lên CH Play (Google Play) và App Store

Code đã sẵn sàng: dự án Android (`android/`) và iPhone (`ios/`), quy trình build tự động trên GitHub
(**không cần máy Mac**), trang chính sách quyền riêng tư, ảnh chụp màn hình đúng kích thước.
Phần còn lại là **tài khoản nhà phát triển** và **điền thông tin trên cửa hàng**, chỉ người sở hữu tài khoản làm được.

---

## ⚠️ Bước 0 – Rất quan trọng: xin phép Hội thánh

App mang tên và nội dung của Hội thánh, nên:

- **Xin phép Ban Chấp sự / Mục sư quản nhiệm** trước khi đăng. Cả Google và Apple đều có thể gỡ app
  hoặc khoá tài khoản nếu app dùng tên/nội dung của một tổ chức mà người đăng không được uỷ quyền.
- **Nên đăng ký tài khoản dưới tên Hội thánh (tổ chức)** thay vì cá nhân:
  - Trên cửa hàng hiện “Hội thánh Imanuel Hà Nội” là nhà phát triển, tạo uy tín.
  - Tài khoản thuộc Hội thánh, không phụ thuộc vào một người.
  - Google Play: tài khoản tổ chức **không phải** qua bước “12 người thử trong 14 ngày”.
  - Cần **số D-U-N-S** (miễn phí, đăng ký tại dnb.com, mất khoảng 1–4 tuần) và giấy tờ pháp lý của Hội thánh.
- Thay email liên hệ giả `lienhe@example.com` trong **`privacy.html`** bằng email thật của Hội thánh.

## Chi phí & thời gian

| | Google Play (CH Play) | Apple App Store |
|---|---|---|
| Phí tài khoản | **25 USD, trả một lần** | **99 USD mỗi năm** (tổ chức phi lợi nhuận có thể xin miễn phí, tuỳ quốc gia, Apple xét duyệt) |
| Xác minh tài khoản | Vài ngày (giấy tờ tuỳ thân / tổ chức) | 2 ngày – vài tuần (tổ chức cần D-U-N-S) |
| Trước khi phát hành | Tài khoản **cá nhân**: thử nghiệm kín **≥ 12 người trong 14 ngày liên tục** | Không yêu cầu |
| Duyệt app | Vài giờ – 7 ngày | 1–3 ngày |

> Mẹo cho tài khoản cá nhân: mời 15–20 anh chị em trong Hội thánh có điện thoại Android cùng tham gia
> thử nghiệm kín, mở app mỗi ngày trong 14 ngày.

---

## A. Google Play (CH Play)

### A1. Tạo khoá ký app (làm 1 lần, giữ cẩn thận suốt đời app)
Trên máy tính có cài Java (hoặc nhờ người biết kỹ thuật):
```bash
keytool -genkey -v -keystore upload.keystore -alias imanuel -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 upload.keystore > upload.keystore.txt      # trên macOS: base64 -i upload.keystore
```
**Cất file `upload.keystore` và mật khẩu ở nơi an toàn** (2 bản sao). Mất file này thì không cập nhật app được
(Google cho phép xin đặt lại khoá upload, nhưng mất thời gian).

Thêm vào GitHub: *Settings → Secrets and variables → Actions → New repository secret*:

| Tên secret | Giá trị |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | nội dung file `upload.keystore.txt` |
| `ANDROID_KEYSTORE_PASSWORD` | mật khẩu đã đặt |
| `ANDROID_KEY_ALIAS` | `imanuel` |

### A2. Build bản đầu tiên
*Actions → **App Android (APK + CH Play)** → Run workflow* (giữ “khong”).
Xong thì tải file **`imanuel-hanoi.aab`** trong mục *Artifacts* ở cuối trang kết quả.

### A3. Tạo app trên Play Console (play.google.com/console)
1. **Create app**. Tên: `Imanuel Hà Nội`, ngôn ngữ mặc định: Tiếng Việt, App, Free.
2. Mục *App content*, điền theo [phần D](#d-trả-lời-các-biểu-mẫu) bên dưới.
3. *Store listing*: chữ ở [phần C](#c-nội-dung-trang-cửa-hàng); ảnh lấy từ workflow **Ảnh cho cửa hàng ứng dụng**
   (thư mục `android/`, `feature-graphic-1024x500.png`, `icon-512.png`).
4. *Testing → Internal testing → Create release*: **tải file `.aab` lên bằng tay lần đầu**
   (Google bắt buộc lần đầu phải tải thủ công). Chấp nhận *Play App Signing*.
5. Tài khoản cá nhân: tạo *Closed testing*, thêm email người thử, chạy đủ 14 ngày rồi xin *Production access*.

### A4. Tự động đưa bản mới lên (tuỳ chọn)
Tạo *Service account* có quyền “Release manager” trong Play Console (*Setup → API access*), tải file JSON, rồi thêm secret
`PLAY_SERVICE_ACCOUNT_JSON` (dán toàn bộ nội dung JSON). Từ đó: *Run workflow → chọn kênh* (internal / alpha / production).

---

## B. Apple App Store (không cần máy Mac)

### B1. Tài khoản
1. Đăng ký **Apple Developer Program** (developer.apple.com/programs). Chọn *Organization* nếu đăng ký cho Hội thánh.
2. Lấy **Team ID** (10 ký tự) tại developer.apple.com → *Membership details*.

### B2. Khoá API để GitHub build thay máy Mac
App Store Connect → *Users and Access → Integrations → App Store Connect API → Team Keys* → tạo khoá quyền **Admin**
(cần quyền Admin để tự tạo chứng chỉ ký app). Tải file `AuthKey_XXXX.p8` (**chỉ tải được 1 lần**).

| Tên secret | Giá trị |
|---|---|
| `APPLE_TEAM_ID` | Team ID |
| `APP_STORE_CONNECT_KEY_ID` | Key ID (ví dụ `ABC123DEFG`) |
| `APP_STORE_CONNECT_ISSUER_ID` | Issuer ID (dạng `xxxxxxxx-xxxx-…`) ở đầu trang Keys |
| `APP_STORE_CONNECT_KEY_P8` | mở file `.p8` bằng Notepad, dán **toàn bộ** nội dung |

### B3. Tạo app trên App Store Connect
1. developer.apple.com → *Identifiers* → đăng ký Bundle ID **`org.imanuelhanoi.baigiang`** (bật *Push Notifications* không cần thiết; thông báo trong app là thông báo cục bộ).
2. App Store Connect → *Apps → +  New App*: iOS, tên `Imanuel Hà Nội`, ngôn ngữ Vietnamese, Bundle ID ở trên, SKU `imanuel-hanoi`.

### B4. Build & tải lên
*Actions → **App iPhone (TestFlight / App Store)** → Run workflow*. Sau khoảng 15–30 phút, bản build xuất hiện
trong *TestFlight*: cài app **TestFlight** trên iPhone để thử.

### B5. Gửi duyệt
Trong App Store Connect: điền [phần C](#c-nội-dung-trang-cửa-hàng) và [phần D](#d-trả-lời-các-biểu-mẫu), tải ảnh trong
thư mục `ios/` (1320×2868 – iPhone 6.9"), chọn bản build, **Add for Review**.
App chỉ hỗ trợ iPhone nên không cần ảnh iPad.

---

## C. Nội dung trang cửa hàng

**Tên app** (≤ 30 ký tự): `Imanuel Hà Nội`

**Phụ đề – Apple** (≤ 30): `Bài giảng & Tĩnh nguyện`

**Mô tả ngắn – Google** (≤ 80): `Bài giảng video, tĩnh nguyện hằng ngày và câu Kinh Thánh mỗi sáng.`

**Từ khoá – Apple** (≤ 100): `bài giảng,tĩnh nguyện,kinh thánh,hội thánh,tin lành,cơ đốc,mục sư,thờ phượng,cầu nguyện`

**Mô tả đầy đủ:**
```
Ứng dụng của Hội thánh Imanuel Hà Nội giúp anh chị em gắn bó với Lời Chúa mỗi ngày.

• BÀI GIẢNG CHÚA NHẬT – Xem lại video bài giảng trong giờ thờ phượng hằng tuần, được cập nhật tự động ngay sau buổi nhóm.
• TĨNH NGUYỆN HẰNG NGÀY – Lịch tĩnh nguyện theo ngày với câu gốc, suy ngẫm và lời cầu nguyện.
• CÂU KINH THÁNH MỖI SÁNG – Bật nhắc nhở để nhận một câu Kinh Thánh vào giờ bạn chọn, kể cả khi không có mạng.
• NHẮC GIỜ THỜ PHƯỢNG – Thông báo vào sáng Chúa Nhật.
• TÌM THEO CHỦ ĐỀ – Đức tin, Cầu nguyện, Gia đình, Ân điển, Tạ ơn, Hy vọng… hoặc tìm theo tên bài, câu Kinh Thánh, diễn giả. Gõ không dấu vẫn tìm được.
• LƯU BÀI YÊU THÍCH và chia sẻ cho người thân, bạn bè.

Không cần đăng ký tài khoản. Không quảng cáo. Không thu thập dữ liệu cá nhân.

“Lời Chúa là ngọn đèn cho chân tôi, ánh sáng cho đường lối tôi.” – Thi thiên 119:105
```

**Danh mục:** Google: *Lối sống (Lifestyle)* · Apple: chính *Lifestyle*, phụ *Reference*

**Trang chính sách quyền riêng tư:** `https://immanuelhanoi.github.io/privacy.html`

**Trang hỗ trợ (Apple bắt buộc):** `https://immanuelhanoi.github.io/`
(hoặc trang web / Facebook chính thức của Hội thánh)

---

## D. Trả lời các biểu mẫu

| Biểu mẫu | Trả lời |
|---|---|
| Google – **Data safety** | *Does your app collect or share user data?* → **No**. Dữ liệu được mã hoá khi truyền: **Yes** (HTTPS). |
| Google – **Content rating** (IARC) | Danh mục *Reference, News, or Educational*; trả lời **No** cho mọi câu về bạo lực, tình dục, ngôn từ, cờ bạc… → kết quả *Everyone / 3+* |
| Google – **Target audience** | 13+ hoặc 18+ (chọn “không nhắm tới trẻ em” để tránh yêu cầu Families) |
| Google – **Ads** | No ads |
| Google – **Government / Financial / Health apps** | Không |
| Apple – **App Privacy** | **Data Not Collected** |
| Apple – **Age Rating** | Trả lời “None” cho tất cả → **4+** |
| Apple – **Export compliance** | Đã khai báo sẵn trong app (không dùng mã hoá đặc biệt), không phải trả lời |
| Apple – **Sign-in required** | Không |

**Ghi chú cho người duyệt – Apple (App Review Notes):**
```
This is the official app of Imanuel Hanoi Church (Vietnam). No login is required.
- Sermons are published on the church's own YouTube channel (@immanuelhanoi) and synced into the app daily.
- Native features: local daily Bible-verse notifications and Sunday worship reminders (tap the bell icon,
  top right), offline access to the sermon list, favorites, topic browsing and accent-insensitive Vietnamese search.
- The app collects no personal data.
```

---

## E. Những điều cần biết

- **Apple có thể từ chối** theo mục 4.2 (“app chỉ là trang web đóng gói”) hoặc 5.2 (quyền sở hữu nội dung).
  App đã có tính năng riêng (thông báo hẹn giờ, xem offline, lưu bài, tìm kiếm), nhưng không đảm bảo 100%.
  Nếu bị từ chối, đọc lý do trong *Resolution Center*: thường chỉ cần trả lời giải thích, hoặc bổ sung giấy uỷ quyền của Hội thánh.
- **Bài giảng mới không cần nộp lại**: app tự tải dữ liệu mới. Chỉ khi đổi giao diện/tính năng mới cần build và nộp bản mới.
  Mỗi lần nộp, đổi `"version"` trong `package.json` (ví dụ `1.0.1`); số build tự tăng.
- Thông báo trên Android dùng hẹn giờ “không chính xác tuyệt đối” (có thể lệch vài phút) để đúng chính sách của Google Play.
- Ảnh chụp màn hình nên tạo **sau khi** web đã có video thật (workflow “Cập nhật video & đăng web” đã chạy).
