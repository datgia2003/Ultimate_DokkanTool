# Changelog

Các thay đổi được ghi lại từ phiên bản `1.0.1` trở đi.

## [1.0.5.2] - 2026-10-05

### Anim Transfer và Lua Timeline

- Giữ lại danh sách animation đã chuyển theo từng thẻ khi chuyển tab trong phiên mở tool.
- Hiển thị ID, nút sao chép và BGM ID của các animation đã chuyển trong cả tab Anim Transfer và Lua Animation Editor.

## [1.0.5.1] - 2026-10-05

### Tìm animation

- Sửa tìm animation cùng loại ở Passive, Entrance, Active, Super Attack, Standby và Finish để kết quả luôn lấy từ database gốc.
- Sửa tìm animation theo thẻ trong Lua Timeline và Anim Transfer; thao tác chuyển cũng đọc animation nguồn từ database gốc.
- Tắt cache HTTP cho các truy vấn tìm animation để không hiện kết quả cũ.

## [1.0.5] - 2026-10-05

### Lua Animation Editor

- Thêm danh sách Lua custom đã lưu và chuyển sang Entrance, Active Skill, Super Attack hoặc Finish Skill cho thẻ đang sửa; lưu SQL và tài nguyên vào bản nháp. Entrance tự bỏ lệnh damage.
- Thêm nút Play preview để nạp trực tiếp Lua custom đã chọn vào player.
- Giảm xử lý lặp khi có nhiều clip: cache phân tích Lua, tái sử dụng track và danh sách cue, tìm cue theo frame và giới hạn tần suất cập nhật giao diện playhead.

### Card Profile, category và link skill

- Đồng bộ Max HP, Max ATK và Max DEF cho toàn bộ form chain, chọn một thẻ làm mốc và dùng thông số bản nháp của thẻ đó.
- Tự cập nhật Hidden Potential Board theo element, giữ loại board hiện có khi phù hợp; khung ảnh và thumbnail cập nhật theo element đang chỉnh.
- Thêm sao chép category và link skill từ thẻ khác; kết hợp category loại bỏ mục trùng. Đưa bộ tìm nguồn ngay cạnh phần chỉnh tương ứng.
- Thêm đồng bộ Leader Skill từ một form trong chain theo bản nháp đang chỉnh.

### Passive, transformation và SQL

- Hỗ trợ efficacy 131 Reversible Exchange trong chain và SQL ở Passive, Active và Standby.
- Thêm tạo Passive Skill mới và clone sau khi xóa; xem itemized_description của thẻ nguồn trước khi clone.
- Sửa tìm kiếm thẻ nguồn passive; clone ưu tiên ID passive gốc và tái sử dụng ID efficacy, các dòng mới được cấp ID tăng dần.
- Sửa cấp ID tạm âm gây lỗi invalid literal for int khi xuất SQL sau khi clone passive.
- Giữ causality đã chỉnh trong bản nháp qua các tab và form, đưa giá trị vào SQL patch.
- Giữ chain đang chỉnh khi mở form mượn từ thẻ khác; không thay thẻ gốc bằng thẻ gốc của form nguồn.
- Khi nhập mod ZIP, duyệt chain theo chiều biến hình và loại thẻ tổ tiên nguồn không chỉnh khỏi Cards in Mod nếu chỉ bị kéo theo form mượn.
- Các công cụ tìm anim, BGM và nguồn sao chép dùng database; riêng thao tác đồng bộ dùng bản nháp.

### Character OST và tìm BGM

- Cập nhật danh sách Character OST theo thêm/xóa animation trong bản nháp, gồm Entrance và Revival; tự phát lại khi hết bài.
- Gộp OST trùng BGM ID và chuẩn hóa tên để tránh lặp Entrance Theme.
- Thêm tìm BGM theo thẻ bên dưới các ô BGM của Active, Standby, Finish và EX Super Attack; hiển thị ảnh thẻ nguồn.

## [1.0.4.1] - 2026-09-30

### Sửa lỗi phrase trong animation

- Ngăn ảnh phrase chung của thẻ ghi đè lời thoại riêng trong các effect pack.
- Giới hạn tra cứu texture phrase trong cache của LWF hiện tại để các animation không dùng nhầm text của nhau.
- Truyền `special_name_no` theo từng animation khi phát preview.

### Transformation và Battle Params

- Tự cấp `param_no` Battle Params không trùng cho efficacy 103 mới ở Passive, Active và Standby.
- Xuất các dòng Battle Params đi kèm patch và cập nhật danh sách form transformation ngay khi sửa đích biến hình.

## [1.0.4] - 2026-09-30

### Player animation

- Thêm nút tải lại Lua cho animation đang chọn; tài nguyên của mod ZIP và Lua custom được bảo vệ khỏi ghi đè.
- Thêm danh sách chọn enemy theo tên, gộp nhân vật trùng tên và chọn ID nhân vật mới nhất bắt đầu bằng `1` hoặc `4`.
- Sửa lỗi ảnh thẻ bị thay vào texture lời thoại trong animation; chỉ ánh xạ texture có tên bắt đầu đúng định dạng `card_<ID>`.
- Tự làm mới ngân hàng voice Nhật từ CDN và tải lại AWB tương ứng khi ACB thay đổi.
- Đưa tag Conditional sang cạnh tên chiêu để tránh tràn dòng.

### Giao diện và phát hành

- Hiển thị version hiện tại cạnh logo; version được lấy từ metadata của ứng dụng.

## [1.0.3] - 2026-09-29

### Passive Skill và clone efficacy

- Thêm công cụ sao chép Passive Skill Efficacy từ nhiều thẻ và nhiều dòng nguồn trong một lần thao tác.
- Bộ tìm nguồn dùng giao diện Lua Timeline: tìm theo tên thẻ, ID hoặc tên chiêu; lọc rarity; phân trang và hiển thị ảnh thẻ.
- Khi chọn thẻ nguồn, hiển thị `itemized_description` cùng các efficacy và value để đối chiếu.
- Sao chép vào dòng đang chỉnh sẽ giữ ID và quan hệ của dòng đích; các efficacy chọn thêm được tạo thành dòng mới với ID được cấp khi lưu.
- Dòng efficacy mới bắt đầu với các ô value để trống và mở sẵn công cụ tìm nguồn.

### Player animation và OST

- Nhận diện efficacy Revival (`109`) trong Passive draft; nạp animation từ `revival_views` và thay danh sách Entrance/Revival theo draft ngay khi chỉnh.
- Cập nhật danh sách Character OST theo các BGM Entrance và Revival trong draft; loại track cũ của thẻ hiện tại khi efficacy bị thay hoặc gỡ.
- Đưa thông báo bài đang phát xuống góc dưới bên trái và neo trực tiếp vào viewport để tránh bị bố cục trang đẩy lệch.

### Giao diện

- Chỉnh thanh tìm thẻ nguồn trong Clone Active Skill để ô nhập và bộ lọc nằm gọn trong panel, đồng bộ giao diện tối.

## [1.0.2.2] - 2026-09-28

### OST và visualizer

- Thêm bộ lọc phát nhạc `All`, `Original` và `Custom`; phát ngẫu nhiên chỉ chọn các bài theo bộ lọc hiện tại.
- Khôi phục danh sách OST khi mở tool lần đầu và thêm nhạc custom vào danh sách phát chung.
- Giữ nhạc tiếp tục phát khi mở Lua Animation Editor hoặc quay lại màn hình nghe nhạc.
- Đồng bộ dải sóng với tín hiệu âm thanh để các dải tần biến đổi độc lập theo từng đoạn nhạc; dừng hiệu ứng hình ảnh khi tab trình duyệt bị ẩn nhưng không dừng nhạc.
- Cải thiện giao diện phòng nghe nhạc và bố cục thanh OST khi mở Lua Timeline.
- Thêm cài đặt `cricode` tự động trong launcher.

## [1.0.2.3] - 2026-09-28

### Cải thiện giao diện và sửa lỗi

- Đặt thanh OST chung cùng hàng với thanh tiêu đề và nút Revert khi đang chỉnh sửa thẻ; tự chuyển bố cục trên màn hình hẹp.
- Sửa lỗi Lua Timeline bị màn hình đen khi đổi rarity hoặc kiểu tìm kiếm sau khi chọn thẻ để nhập animation.

## [1.0.2.1] - 2026-09-28

### Sửa lỗi cắt và nối Lua Timeline

- Đổi IN/OUT tự dời toàn bộ clip phía sau theo thời lượng mới; xóa clip sẽ khép khoảng trống.
- Ô frame cho phép nhập trọn giá trị rồi áp dụng khi nhấn Enter hoặc rời ô, tránh nạp lại preview giữa lúc đang nhập.
- Chỉ cho cắt tại playhead khi playhead nằm trong clip được chọn.
- Player kích hoạt hiệu ứng tại đầu clip và chạy tới đúng trạng thái IN, gồm cả movie con trong LWF.
- Chuẩn bị sẵn trạng thái LWF tại IN trong lúc nạp để tránh chạy bù nhiều frame ngay ở điểm nối.
- Giới hạn hiển thị từng hiệu ứng theo IN/OUT; kéo thanh frame chỉ hiện clip chứa frame đó, tính đúng tốc độ khung hình của LWF.
- Giới hạn lệnh xóa hiệu ứng trong clip hiện tại, cắt thời lượng fade và xóa lớp fade cuối clip để tránh ảnh hưởng đoạn sau.
- Sửa lỗi tham chiếu lớp LWF khi hiệu ứng chạy hết, khiến việc giữ frame cuối bị lỗi.
- Dời `setupMovie` tới đúng frame nguồn khi cắt IN, đồng bộ hình USM với chữ LWF và âm thanh.
- Chuẩn bị và giải mã sẵn frame IN của từng movie trước khi phát; giữ hình đoạn trước tới khi hình đoạn sau sẵn sàng để tránh nháy đen ở điểm nối.
- Giữ bộ đếm movie chờ tại IN, dừng bộ đếm khi qua OUT, tránh clip sau bị tính là hết video rồi đứng hình.
- Mỗi lần dùng lại cùng movie có trạng thái riêng, hỗ trợ nhiều đoạn cắt từ cùng nguồn và phát lại timeline.
- Thêm hồi quy bằng hai Lua Goku Nullify/Active được báo lỗi, kiểm tra offset movie/voice và đổi hình tại ranh giới clip.
- Thêm hồi quy ghép bốn đoạn Fusion, đổi IN/OUT trong chuỗi bốn clip, movie con và ranh giới hiển thị.

## [1.0.2] - 2026-09-28

### Sửa lỗi Lua Timeline

- Phân tích cú pháp Lua để nhận cả lệnh trong phép gán, lệnh nhiều dòng và lệnh một tham số như `endPhase`.
- Dời đúng frame bắt đầu của hiệu ứng và âm thanh; cắt lệnh ngoài OUT và giới hạn frame kết thúc của `playSeVer2`.
- Chỉ kết thúc script ghép một lần tại cuối timeline; `return` trong Lua nguồn chỉ thoát clip hiện tại.
- Giữ hiệu ứng trước IN, ẩn trước đầu clip và bắt đầu tại đúng vị trí đã cắt; ẩn hiệu ứng và dừng âm thanh khi clip hết OUT.
- Giữ đúng work ID cho metadata âm thanh và thay texture; bỏ metadata của hiệu ứng/âm thanh đã bị cắt.
- Giữ time stretch riêng của từng âm thanh để clip sau không ghi đè cấu hình clip trước.
- Đổi tên biến theo scope Lua, giữ nguyên biến local, khóa table, chuỗi và comment.
- Báo lỗi khi chưa xác định được frame, thay vì âm thầm giữ lệnh ở timeline gốc.
- Thêm kiểm tra hồi quy bằng Fusion và Golden Power qua bộ thực thi Lua và hàng lệnh của player.
- Thêm định dạng lưu Entrance, Counter, Nullify/Absorb và đòn Active Skill `ut*.lua`, với thư mục patch tương ứng.
- Entrance tự comment mọi `dealDamage` và `setDamage`, kể cả lệnh nhiều dòng hoặc nằm trong nhánh điều kiện.
- Thêm checkbox đặt một frame damage, ô nhập frame và nút lấy frame khi player đang pause; chỉ áp dụng cho Super Attack, Active Skill `ut*.lua` và Finish Skill.
- Chuyển điều khiển frame damage lên cạnh thanh công cụ timeline để chọn frame và bật/tắt nhanh.
- Thêm checkbox bỏ `dealDamage`; bật mục này sẽ comment mọi lệnh `dealDamage` nguồn ở bất kỳ định dạng nào, đồng thời tắt chế độ chèn damage mới. `setDamage` vẫn được giữ nguyên ngoài Entrance.
- Preview và lưu dùng chung Lua đã áp dụng định dạng và frame damage; có phần xem trước nội dung sẽ lưu.

## [1.0.1] - 2026-09-28

### Sửa lỗi

- Ghép các clip Lua theo thứ tự và IN/OUT thành một script duy nhất để preview và lưu thành anim custom.
- Buộc player nạp lại bản nháp khi nội dung thay đổi dù đường dẫn preview được giữ nguyên.
- Dời các lệnh hình ảnh và âm thanh theo timeline; nhận diện `playSeVer2` và giữ đúng các lệnh metadata âm thanh dùng work ID.
- Chỉ giữ `endPhase` ở clip cuối để clip trước không dừng toàn bộ script ghép.
- Tách tên biến toàn cục của từng clip để tránh xung đột khi ghép.
