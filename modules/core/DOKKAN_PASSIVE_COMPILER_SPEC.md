# TÀI LIỆU ĐẶC TẢ KỸ THUẬT & HƯỚNG DẪN TÍCH HỢP HỆ THỐNG BIÊN DỊCH NỘI TẠI DOKKAN BATTLE
## (DOKKAN PASSIVE COMPILER SPECIFICATION & INTEGRATION GUIDE)

> **Mục đích tài liệu:** Ghi lại quy tắc đã triển khai để sinh các dòng `passive_skills` có thể sửa tay từ `itemized_description`. Mô tả game có nhiều điều kiện ghép và ngoại lệ; kết quả parser theo quy tắc cần được người dùng rà soát trước khi xuất patch.

---

## 1. Danh Sách Tài Nguyên Bắt Buộc Phải Có (Checklist Khi Chuyển Sang Tool Mới)

Khi mang tính năng này sang một phiên bản tool mới (hoặc project khác), **bắt buộc phải có đủ 3 thành phần sau**:

1. **`dokkan_passive_compiler.py`** *(File logic cốt lõi)*:
   - Chứa toàn bộ thuật toán Regex, nhận diện ngữ cảnh (Header/Bullet), phân tích Stacking (Eff 98), Ngọc Ki Spheres (Eff 68 & 96), HP scaling, Turn limit, Tra cứu Category & Causality.
   - Hoạt động offline; dùng thư viện chuẩn Python và `modules.core.config.DB_PATH` của tool.
2. **`database_decrypted.db`** *(Cơ sở dữ liệu SQLite nền của game)*:
   - Trong project này nằm ở thư mục gốc `F:\tool make patch\database_decrypted.db`; module lấy đường dẫn từ `modules.core.config`.
   - Cần các bảng: `passive_skills`, `passive_skill_sets`, `passive_skill_set_relations`, `skill_causalities`, `card_categories`.
3. **`web-ui/src/components/tabs/TabPassive.jsx`** *(Giao diện React hiện tại)*:
   - Chứa thao tác sinh dòng, xem bản nháp, thay/thêm skill và rà soát kết quả (xem Mục 4).

---

## 2. Kiến Trúc Dữ Liệu Dokkan Passive Trong SQLite

Trong cơ sở dữ liệu Dokkan Battle (`database_decrypted.db`), một bộ Passive Skill của nhân vật gồm 3 bảng liên kết chặt chẽ:
1. **`passive_skill_sets`**: Chứa ID của bộ passive (`id`), tên (`name`), và toàn bộ văn bản hiển thị trong game (`itemized_description`).
2. **`passive_skill_set_relations`**: Bảng trung gian liên kết giữa `passive_skill_set_id` và từng dòng hiệu ứng `passive_skill_id`.
3. **`passive_skills`**: Bảng thực thi logic gameplay. Một câu mô tả có thể cần nhiều dòng; số dòng không cố định.

Mỗi dòng trong bảng `passive_skills` có các cột quyết định:
* `id` và `name`: Bắt buộc khi ghi database. UI cấp ID sau khi biên dịch và kiểm tra trùng với DB; tên lấy từ passive set.
* `exec_timing_type` (INTEGER): Thời điểm kích hoạt logic trong trận đấu.
* `target_type` (INTEGER): Đối tượng áp dụng (`1`: Bản thân thẻ, `2`: Toàn bộ đồng minh, `12`: Đồng minh Super Class, `13`: Đồng minh Extreme Class, `3`: Kẻ địch bị tấn công).
* `causality_conditions` (TEXT): Chuỗi JSON chứa ID của điều kiện (`skill_causalities`). Format: `{"source":"ID","compiled":ID}` hoặc `""` (nếu không có điều kiện).
* `efficacy_type` (INTEGER): Mã loại hiệu ứng (ATK/DEF, Né, Giảm ST, Bổ sung đòn đánh, Bật Guard, Stacking, v.v.).
* `calc_option` (INTEGER): Cách tính toán (`0`: Số cố định, `1`: Trừ cố định, `2`: Cộng phần trăm %, `3`: Tính toán đặc thù).
* `turn` (INTEGER): Passive cơ bản trong DB này thường dùng `1`; stacking vĩnh viễn thường dùng `99`; thời hạn riêng dùng giá trị tương ứng từ mô tả.
* `is_once` (INTEGER): `1` nếu chỉ kích hoạt 1 lần trong trận (hoặc 1 lần trong lượt), `0` nếu kích hoạt lặp lại.
* `probability` (INTEGER): Tỷ lệ kích hoạt hiệu ứng (`100` = 100% kích hoạt).
* `eff_value1`, `eff_value2`, `eff_value3` (INTEGER): 3 tham số giá trị của hiệu ứng.
* `efficacy_values` (TEXT): Thường để chuỗi rỗng `'{}'`.

---

## 3. Bảng Ánh Xạ Chuẩn Ngữ Pháp & Quy Tắc Dokkan (Canonical Mapping Rules)

### 3.1. Bảng tra Efficacy Type & Cách điền Value 1/2/3

| Tên hiệu ứng Ingame | Efficacy ID | Calc Option | eff_value1 | eff_value2 | eff_value3 | probability | Ghi chú & Quy tắc chuẩn |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **Ki Boost cơ bản** | **5** | 0 | Số Ki (vd: 3) | 0 | 0 | 100 | Target = 1 (bản thân) hoặc 2 (đồng minh) |
| **Ki cho Super/Extreme Class allies** | **83** | 0 | 32/64 | Số Ki | 0 | 100 | Target = 12/13 tương ứng |
| **ATK & DEF +X%** | **3** | 2 | X | X | 0 | 100 | Cả ATK và DEF tăng X% |
| **ATK +X%** | **1** | 2 | X | 0 | 0 | 100 | Chỉ tăng ATK |
| **DEF +X%** | **2** | 2 | X | 0 | 0 | 100 | Chỉ tăng DEF |
| **Giảm ATK/DEF của địch** | **1/2/3** | 3 | X | X nếu cả hai | 0 | Tùy câu | Icon `{passiveImg:down_y}`; target 4=mọi địch, 3=địch bị đánh, 14=Super, 15=Extreme |
| **Damage Reduction (Giảm ST)** | **13** | 2 | **100 - X** | 0 | 0 | 100 | ⚠️ **QUAN TRỌNG:** Giảm 30% ST thì `eff_value1 = 70`. Giảm 59% thì `eff_value1 = 41`. |
| **Guards all attacks** | **78** | 0 | 0 | 0 | 0 | 100 | Đỡ đòn mọi hệ (Guard) |
| **Super Effective** | **76** | 0 | 0 | 0 | 0 | 100 | Tấn công hiệu quả với mọi hệ |
| **Dodge / Evade (Né đòn)** | **91** | 2 | % Né | 0 | 0 | 100 | `Rare`: 20, `Medium`: 30, `High`: 50, `Great`: 70 |
| **Critical Hit (Chí mạng)** | **90** | 2 | % Crit | 0 | 0 | 100 | Tỉ lệ chí mạng (100 nếu chắc chắn crit) |
| **Additional Attack (Liên kích)**| **81** | 0 | 0 | 0 | **% ra SA** | 100 | Thêm đòn SA: `eff_value3 = 100` |
| **Ki Sphere: Stat Boost (một hệ)** | **68** | 2 | **Bitmask** | **Stat ID** | **% Tăng** | 100 | Ngọc chỉ định; xem mục 3.3 |
| **Ki Sphere: ATK/DEF (mọi ngọc)** | **59/60/61** | 2 | **% Tăng** | **% DEF nếu 61** | 0 | 100 | 59=ATK, 60=DEF, 61=ATK & DEF |
| **Ki Sphere: Ki Boost** | **96** | 0 | **Bitmask** | **Số Ki** | 0 | 100 | Nhận thêm Ki theo mỗi viên ngọc |
| **Incremental Stacking** | **98** | 2 | **Step %** | **Max Cap %**| **Stat ID** | 100 | Tích lũy mỗi đòn/lượt (xem mục 3.2) |
| **HP Scaling (Tỉ lệ theo HP)** | **71/72/73** | 2 | **Min %** | **Max %** | **1100** | 100 | 71=ATK, 72=DEF, 73=ATK&DEF (xem mục 3.4) |
| **Change Ki Spheres (Đổi ngọc)** | **67** | 0 | Mask nguồn | Mask đích | 0 | 100 | Đổi sang Rainbow: `v1=31, v2=32` |
| **Foresee Super Attack (Scouter)**| **101** | 0 | 0 | 0 | 0 | 100 | Nhìn trước Super Attack của địch |
| **Disable Enemy Action** | **111** | 0 | 0 | 0 | 0 | 100 | Khóa 1 hành động của địch (`is_once = 1`) |
| **Stun Enemy (Làm choáng)** | **9** | 0 | 0 | 0 | 0 | % Stun | Thường đi kèm `turn = 2` |
| **Seal Super Attack (Khóa SA)** | **10** | 0 | 0 | 0 | 0 | % Seal | Thường đi kèm `turn = 2` |
| **Recover HP (Hồi máu)** | **4** | 2 | % Hồi | 0 | 0 | 100 | Hồi X% HP |
| **Survives K.O. attack** | **52** | 0 | 0 | 0 | 0 | 100 | Thường kích hoạt ở `exec_timing_type = 6` |

---

### 3.2. Chuẩn Tích Lũy / Stacking (Efficacy 98)

Chỉ sinh efficacy `98` khi header diễn tả **tăng lặp lại** (mỗi lượt, mỗi đòn đánh/nhận/né) hoặc có `up to` đi cùng ngữ cảnh lặp. `{passiveImg:forever}` **không đủ** để suy ra stacking: nó cũng đánh dấu buff vĩnh viễn sau một mốc điều kiện, khi đó giữ efficacy thông thường và `turn = 99`.

Với stacking, Dokkan engine sử dụng cấu trúc:
- `efficacy_type = 98`
- `calc_option = 2` (hoặc `0` nếu là tích lũy Ki)
- `turn = 99` (vĩnh viễn trong trận) hoặc `1` (nếu chỉ tích lũy trong lượt)
- `eff_value1`: Bước nhảy mỗi lần tăng (`step_val`, ví dụ: 15).
- `eff_value2`: Mức trần tối đa (`max_val` lấy từ `up to X%`, ví dụ: 77).
- `eff_value3`: **Mã chỉ số được tăng**:
  - `0`: **ATK**
  - `1`: **DEF**
  - `2`: **Critical hit chance**
  - `3`: **Dodge / Evade chance**
  - `4`: **Damage reduction rate**
  - `5`: **Ki** (`calc_option = 0`)
- **Quy tắc Timing & Causality chuẩn cho Efficacy 98:**
  - Khi tấn công (`When attacking`, `attack performed`, `đòn đánh`): `timing = 5`, `causality = ""` (trống, Dokkan dùng Timing 5 ON_ATTACK_PERFORMED).
  - Khi nhận đòn (`When receiving an attack`, `attack received`, `nhận đòn`, `bị đánh`): `timing = 7`, `causality = {"source":"24","compiled":24}` (Causality 24 = `isAttacked`).
  - Đầu mỗi lượt (`At the start of each turn`, `turn passed`, `mỗi lượt trôi qua`): `timing = 1`, `causality = ""`.
  - Khi né đòn (`When evading an attack`, `né đòn`): `timing = 7`, `causality = {"source":"365","compiled":365}`.
- **Nếu dòng ghi `ATK & DEF +15% (up to 77%)`**: Bắt buộc sinh **2 skill**:
  - Skill 1 (ATK): `eff_value1 = 15, eff_value2 = 77, eff_value3 = 0`
  - Skill 2 (DEF): `eff_value1 = 15, eff_value2 = 77, eff_value3 = 1`

---

### 3.3. Chuẩn Ngọc Ki Spheres (Efficacy 59/60/61, 68 & 96)

Khi gặp ngữ cảnh ngọc Ki (Header hoặc dòng có `per ... Ki Sphere obtained`, `For each Rainbow Ki Sphere obtained`, `Mỗi ngọc 7 màu thu được`...):

1. **Xác định Bitmask hệ ngọc (`eff_value1`):**
   - **Rainbow (7 màu / Bảy màu)**: `bitmask = 32`
   - **All Ki Spheres (Mọi loại ngọc)**: `bitmask = 63`
   - **AGL**: `1`, **TEQ**: `2`, **INT**: `4`, **STR**: `8`, **PHY**: `16`
2. **ATK/DEF theo mọi loại ngọc:** efficacy `59` (ATK), `60` (DEF), `61` (ATK & DEF), số % ở `eff_value1` (và `eff_value2` cho DEF của efficacy 61).
3. **Chỉ số theo ngọc chỉ định (Efficacy 68):**
   - `exec_timing_type = 1`, `causality_conditions = ""`
   - `eff_value1` = `bitmask`
   - `eff_value2` = **Mã loại buff**:
     - `1`: **ATK**
     - `2`: **HP Recovery**
     - `3`: **DEF**
     - `4`: **Critical hit chance**
     - `5`: **Dodge chance**
     - `6`: **Damage reduction rate**
   - `eff_value3` = Số phần trăm tăng thêm (ví dụ: 59).
   - Nếu là `ATK & DEF 59%`: Tự động sinh **2 skill** tách biệt (`eff_value2 = 1` cho ATK và `eff_value2 = 3` cho DEF).
4. **Ki theo ngọc (Efficacy 96):**
   - Dòng: `Receives an additional Ki +1 per Ki Sphere obtained` hoặc `- Ki +1` dưới header ngọc:
   - `efficacy_type = 96, calc_option = 0, eff_value1 = bitmask, eff_value2 = ki_val, eff_value3 = 0`.

---

### 3.4. Chuẩn Tỉ Lệ Theo Máu (HP Scaling - Efficacy 71, 72, 73)

- Header: `*The more HP remaining*` hoặc `*Càng nhiều HP*`:
  - `causality_conditions = ''` trong các mẫu DB đã đối chiếu.
  - `eff_value1` = 1 (mức tối thiểu mặc định của parser), `eff_value2` = Max %, `eff_value3` = 1100.
- Header: `*The less HP remaining*` hoặc `*Càng ít HP*`:
  - `causality_conditions = ''`; `eff_value1` = Max %, `eff_value2` = 1, `eff_value3` = 1100.
  - Mức tối thiểu trong DB không đồng nhất (`1`, `10`, ...); người dùng nên kiểm tra hiệu ứng này sau khi sinh.
- Mã Efficacy:
  - `71`: Chỉ ATK
  - `72`: Chỉ DEF
  - `73`: Cả ATK & DEF

---

### 3.5. Chuẩn Giới Hạn Lượt & Xuất Trận (Entry Turn Duration)

- Header: `*For 5 turns from the character's entry turn*` hoặc `*Trong 5 lượt từ lượt ra trận*`:
  - `turn = 5`, `is_once = 1`, `timing = 1`, `causality_conditions = ""` (trống).
  - ⚠️ **LƯU Ý:** Không được gán Causality 47 hay 51 vì Causality 47 là điều kiện đếm Ki, sẽ làm hỏng hiệu ứng. Dokkan Battle quản lý lượt ra trận thông qua 2 cột: `turn = 5` và `is_once = 1`.

---

### 3.6. Chuẩn Đối Đầu Kẻ Địch Extreme / Super Class

- Header: `*When there is an Extreme class Category enemy*` hoặc `*When facing an Extreme Class enemy*` / `*Khi có kẻ địch Extreme Class*`:
  - Kích hoạt đầu lượt (Passive thường, Add SA, Buff): `timing = 1`, `causality_conditions = '{"source":"805","compiled":805}'` (Causality 805 = có ít nhất 1 địch Extreme).
  - Kích hoạt khi tấn công (`When attacking an Extreme Class enemy`): `timing = 4`, `causality_conditions = '{"source":"205","compiled":205}'`.
- Kẻ địch Super Class:
  - Đầu lượt: `timing = 1`, `causality_conditions = '{"source":"804","compiled":804}'`.
  - Khi tấn công: `timing = 4`, `causality_conditions = '{"source":"611","compiled":611}'`.

---

## 4. Tích hợp trong giao diện hiện tại

Mã UI nằm ở `web-ui/src/components/tabs/TabPassive.jsx`. Sau khi nhập `itemized_description`, người dùng bấm **Sinh efficacy từ mô tả**.

- Thẻ chưa có dòng skill: nếu mọi dòng được nhận diện, UI tạo ngay các dòng để sửa tay.
- Thẻ chưa có passive set: nút khởi tạo tạo set ID không trùng và gán `cards.passive_skill_set_id` trước khi sinh dòng.
- Thẻ đã có dòng hoặc mô tả có phần chưa nhận diện: UI hiển thị bản nháp, số dòng và cảnh báo; người dùng chọn **Thay các dòng hiện tại** hoặc **Thêm vào cuối**.
- Khi thay, UI giữ ID/relation của dòng cùng vị trí, cấp ID không trùng cho dòng mới, ghi nhận những dòng cũ bị xóa và giữ animation link khi efficacy cùng loại. Sau đó tăng `ps_desc_version` để các input đọc giá trị mới.
- Sau khi sửa tay, dùng luồng xuất SQL/patch hiện có. Compiler không tự ghi database.

API chính là `compile_passive_description(text) -> {'skills': list, 'warnings': list, 'source': 'database'|'rules'}`. Các skill API trả về là **bản nháp chưa có ID**; giao diện phải hoàn thiện trước khi lưu.

## 5. Tra cứu database và giới hạn nhận diện

Nếu **toàn bộ mô tả trùng chính xác** với một `passive_skill_set` trong database (không tính khác biệt xuống dòng/khoảng trắng), compiler sao chép cấu trúc efficacy gốc nhưng bỏ ID, tên và animation effect ID nguồn. Đây là đường có độ tin cậy cao nhất. Với mô tả viết lại, parser dùng mapping đã đối chiếu DB (ví dụ: K.O. `52`, 18 Ki = causality type `3` value `600`, mốc 3/7 Super Attack = type `44`, đầu mỗi lượt = timing `1`). Không sao chép một dòng gần giống theo fuzzy match vì có thể sai điều kiện hoặc mức trần.

Với mô tả tự viết hoặc thay số, compiler dùng parser từng header/bullet. Những dòng không nhận diện được hiện cảnh báo; không tự mượn skill của một câu khác có vẻ giống. Hàm fuzzy cũ `find_best_matching_skills_from_db` còn trong module để nghiên cứu mẫu nhưng **không nằm trong đường áp dụng của UI**: chỉ số bullet không tương ứng 1:1 với chỉ số skill, và thay số tuần tự có thể làm lệch Ki, %, turn và ngưỡng điều kiện.

Các điều kiện ghép, hiệu ứng biến hình/đổi nhân vật, giá trị HP scaling đặc biệt và passive quá mới cần kiểm tra thủ công sau khi sinh. Không nên tuyên bố parser phủ 100% nội dung game.
