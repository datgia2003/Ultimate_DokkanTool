# Changelog

Các thay đổi được ghi lại từ phiên bản `1.0.1` trở đi.

## [1.0.1] - 2026-09-28

### Sửa lỗi

- Ghép các clip Lua theo thứ tự và IN/OUT thành một script duy nhất để preview và lưu thành anim custom.
- Buộc player nạp lại bản nháp khi nội dung thay đổi dù đường dẫn preview được giữ nguyên.
- Dời các lệnh hình ảnh và âm thanh theo timeline; nhận diện `playSeVer2` và giữ đúng các lệnh metadata âm thanh dùng work ID.
- Chỉ giữ `endPhase` ở clip cuối để clip trước không dừng toàn bộ script ghép.
- Tách tên biến toàn cục của từng clip để tránh xung đột khi ghép.
