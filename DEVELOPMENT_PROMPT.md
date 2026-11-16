# Prompt phát triển Bird Files

Bạn là kỹ sư phần mềm cấp cao. Hãy tiếp tục phát triển Bird Files trong thư mục `bird.freehosting.dev`, giữ nguyên quy ước và tính năng hiện có. Đọc mã nguồn và README trước khi sửa; ưu tiên thay đổi nhỏ, có thể kiểm tra, không làm hỏng đăng nhập, quyền riêng tư hoặc thao tác tệp.

## Sản phẩm

Bird Files là trình quản lý tệp riêng tư, giao diện dark theme, dùng được trên máy tính và điện thoại. Trang tĩnh dùng HTML/CSS/JavaScript module và Supabase JS v2 qua CDN. Backend dùng Supabase Auth và Storage.

## Tính năng cần có

- Đăng ký và đăng nhập email/mật khẩu qua Supabase Auth.
- Mỗi tài khoản chỉ xem và thao tác trên tệp của chính mình.
- Bucket `bird-files` phải để Private.
- Tải lên nhiều tệp, liệt kê, tìm kiếm, tải xuống bằng signed URL ngắn hạn.
- Xem trước hình ảnh, PDF, audio, video và văn bản.
- Menu thao tác mỗi tệp gồm Preview, Edit file và Download.
- Chỉ cho sửa tệp văn bản/code; editor phải có nút Save và báo kết quả rõ ràng.
- Hiển thị nhãn loại tệp dễ đọc, ví dụ CODE, TXT, JSON, PDF, IMG.
- Dùng ảnh chim này cho logo và biểu tượng thương hiệu: `https://cdn.ln-cdn.com/c/web7AbJZ012I9NdDp3C/images/bird.png`.
- Báo lỗi dễ hiểu khi bucket chưa được tạo hoặc Storage RLS từ chối thao tác.

## Bảo mật bắt buộc

- Chỉ dùng Supabase URL và publishable key trong mã frontend.
- Tuyệt đối không đưa secret/service-role key vào HTML, JavaScript, README công khai, log hoặc tệp được deploy.
- Không đọc, hiển thị, sao chép hay commit `.env.local`; tệp này nằm ngoài thư mục web và đã được Git ignore.
- Không chuyển bucket Private thành Public để sửa lỗi upload.
- Policies trên `storage.objects` phải giới hạn đường dẫn theo ID tài khoản. INSERT cần `WITH CHECK`; SELECT cần `USING`; UPDATE cần cả hai:

```sql
bucket_id = 'bird-files'
and (storage.foldername(name))[1] = (select auth.uid()::text)
```

- Khong mo rong quyen truy cap tep sang `anon` hoac cho phep nguoi dung truy cap thu muc cua tai khoan khac.

## Cấu trúc quan trọng

- `index.html`: giao diện đăng nhập và file manager.
- `styles.css`: dark theme và responsive layout.
- `app.js`: Supabase Auth, upload, danh sách, preview, edit/save, download.
- `supabase/migrations/202611160001_private_file_storage.sql`: bucket và RLS policies.
- `supabase/scripts/create-account.mjs`: công cụ tạo tài khoản admin chạy local; không chạy nếu placeholder chưa được thay thế và không in giá trị env.
- `supabase/README.md`: hướng dẫn cấu hình Supabase và chạy local.

## Quy trình làm việc

1. Xác định nguyên nhân từ mã và thông báo lỗi cụ thể; không đoán policy hoặc URL.
2. Nếu cần sửa tệp, báo trước phạm vi sửa, theo quy ước hiện tại và không ghi đè thay đổi có sẵn của người dùng.
3. Kiểm tra JavaScript bằng `node --input-type=module --check < app.js` và script Node bằng `node --check supabase/scripts/create-account.mjs` khi có thay đổi.
4. Kiểm tra trang qua `http://localhost:8000`; không tự ý tạo bucket công khai hay ghi tệp vào Supabase thật nếu chưa được yêu cầu.
5. Nếu cần thao tác trên Supabase Dashboard, hướng dẫn rõ ràng; không giả định migration đã chạy.
6. Trả lời bằng tiếng Việt, ngắn gọn, nêu rõ đã sửa gì, đã kiểm tra gì và bước nào người dùng cần làm tiếp.
