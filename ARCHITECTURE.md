# Tổng quan kiến trúc — Dokkan React Tool

> Tài liệu định hướng cho người hoặc AI mới tiếp cận mã nguồn. Mô tả trạng thái được kiểm tra từ mã nguồn hiện tại, không coi `README.md` là nguồn duy nhất: bản sao làm việc này có thể chứa database và tài nguyên tải về dù README mô tả gói phát hành chỉ có code.

## 1. Tool này làm gì?

Đây là công cụ chạy **cục bộ trên Windows** để xem, chỉnh sửa và đóng gói dữ liệu thẻ nhân vật **Dokkan Battle**. Dữ liệu chính nằm trong SQLite `database_decrypted.db`; các quy tắc/nhãn để hiểu giá trị số nằm trong `game rules/*.xlsx`; hình ảnh, Lua animation, âm thanh và các asset tải về nằm trong `game res/`.

Người dùng tìm thẻ, xem chỉ số và các loại skill, chỉnh sửa trong React, xem SQL trước khi lưu, phát thử animation, chuyển animation giữa các thẻ, rồi xuất ZIP hoặc `.eclp` patch. **React/Vite là giao diện duy nhất** (`run_react_tool.bat`). Mã giao diện Streamlit đã được gỡ bỏ. Một số module lõi vẫn dùng API cache/session của thư viện Streamlit, nên dependency này còn trong `requirements-react.txt`.

### Mô hình trong 30 giây

```text
Trình duyệt :5174 (React)
  ├─ /api/v2, /player, /lwf-player ── Vite proxy ──> react_api.py :8765
  │      ├─ modules/core/db.py + character.py ──> database_decrypted.db
  │      ├─ game rules/*.xlsx ──> metadata cho dropdown/giải nghĩa ID
  │      ├─ sql_builder.py + generate_deep_sql_patch() ──> SQL/SQLite
  │      ├─ anim_transmuter.py ──> Lua + SQLite + lịch sử patch
  │      └─ eclp_builder.py ──> ZIP ──> Dokkan Eclipse ──> .eclp
  └─ iframe animation / asset requests ──> assets.py :8585 ──> game res/ hoặc CDN

```

## 2. Khởi chạy và công nghệ

| Thành phần | Vai trò | Vị trí |
|---|---|---|
| `run_react_tool.bat` | Tạo `.runtime/`, kiểm tra Python/npm và cổng, cài gói React bằng `npm ci` nếu cần, chạy API và Vite | gốc repo |
| React 19 + Vite 6 | UI một trang, tab biên tập, sidebar và player | `web-ui/` |
| `react_api.py` | HTTP API JSON và static player, dùng `ThreadingHTTPServer` của Python | gốc repo |
| `modules/core/` | Truy vấn SQLite, tổng hợp thẻ, rule, asset, SQL, compiler | `modules/core/` |
| `components/lua_player/` | Player trong iframe cho animation Lua/LWF, video, âm thanh | `components/lua_player/` |
| `modules/core/assets.py` | Asset server, tải/cache asset, đổi BGM sang WAV | cổng 8585 |

Chạy theo `README.md`: cài Python 3.12 và Node.js/npm, `python -m pip install -r requirements-react.txt`, rồi `run_react_tool.bat`. UI mở ở `http://127.0.0.1:5174/`. API lắng nghe `127.0.0.1:8765`; cổng 8585 được API tự khởi động cho asset/player. Vite chuyển tiếp `/api/v2`, `/player`, `/lwf-player` sang 8765 và `/bgm` sang 8585 (`web-ui/vite.config.js`). `asset_server.py` là server proxy độc lập tùy chọn, mặc định cổng 8502; launcher React không chạy file đó.

Python dùng các gói trong `requirements-react.txt`: `requests`, `Pillow`, `streamlit` (cache/session tương thích trong core), `pandas`, `openpyxl`, `cricodecs`. `web-ui/package.json` khai báo React, Vite, Lucide. `tools/vgmstream/` và `tools/adx2wav.exe` là binary hỗ trợ audio; `tools/usm-player/` có mã xử lý video USM.

## 3. Cây mã nguồn cần biết

| Đường dẫn | Trách nhiệm chính |
|---|---|
| `web-ui/src/App.jsx` | Điều phối UI: thẻ đang chọn, tab, `cardData`, `meta`, `draft`, lưu DB, ba cột card art/editor/animation |
| `web-ui/src/api.js` | Một nơi định nghĩa lời gọi `/api/v2/*` từ React |
| `web-ui/src/types.js` | Danh sách tab và nhãn màu rarity/element; đây là hằng số giao diện, không phải schema DB |
| `web-ui/src/components/tabs/` | Mỗi tab React xử lý một phần dữ liệu thẻ |
| `web-ui/src/components/player/` | Animation, BGM, OST ở giao diện React |
| `web-ui/src/components/common/` | Widget dùng lại: editor mô tả Dokkan, biểu thức causality, card art, v.v. |
| `react_api.py` | Routing GET/POST, chuyển JSON thành lời gọi core, xây SQL cho draft React |
| `modules/core/db.py` | Đọc Excel rules, hàm kết nối SQLite **chỉ đọc** và truy vấn chung |
| `modules/core/character.py` | Tìm thẻ, nạp `load_character_context()`, chuỗi biến hình/form |
| `modules/core/sql_builder.py` | SQL snapshot/import/apply helpers used by patch export |
| `modules/core/causality.py` | Parse/biên dịch biểu thức causality và đồng bộ mô tả với giá trị skill |
| `modules/core/dokkan_passive_compiler.py` | Chuyển mô tả passive thành các dòng hiệu ứng có cấu trúc; so khớp dòng mô tả với skill |
| `modules/core/assets.py` | Tra cứu/tải/cache tài nguyên, phân giải animation, BGM và HTTP asset server |
| `modules/core/database_updater.py` | Kiểm tra/tải SQLite upstream lúc React API khởi động |
| `anim_transmuter.py` | Lấy animation nguồn, chuyển slot, tạo/copy Lua, cập nhật DB và SQL |
| `eclp_builder.py` | Tìm asset của thẻ, tạo manifest/ZIP, gọi dịch vụ chuyển `.eclp` |
| `components/lua_player/` | HTML/JS player được API phục vụ qua `/player/` |
| `components/lwf_player/` | Player LWF khác, được phục vụ qua `/lwf-player/` |

## 4. Dữ liệu nền và vòng đời khởi động

1. `react_api.py` gọi `update_database_on_startup(ROOT)` **trước khi** import `modules.core.db`, vì module DB nạp metadata lúc import. Updater hỏi file browser của Dokkan Eclipse về bản SQLite tiếng Anh, tải vào `.runtime/db-updates/`, kiểm tra kích thước/`PRAGMA quick_check`/bảng thiết yếu, backup DB cũ rồi mới thay file. Nếu mạng hoặc bản tải lỗi, nó giữ DB cục bộ. Dấu phiên bản upstream ở `.runtime/database-upstream.json`.
2. `modules/core/db.py` đọc các bảng quy tắc từ `game rules/*.xlsx` qua pandas/openpyxl, tạo dictionary cho element, category, efficacy, causality, timing, target và calc option. API cung cấp các dictionary tại `GET /api/v2/meta`.
3. API tự chạy asset server của `modules/core/assets.py` ở cổng 8585. Server này trả tài nguyên cache/local, có thể tải asset thiếu từ CDN, hỗ trợ byte range cho video và âm thanh. Asset tải/cache nằm dưới `game res/`, gồm các thư mục như `thumb`, `card`, `cards`, `ab_script`, `effects`, `movies`, `bgm` và `cache`.
4. React tải `/health` và `/meta` lúc mở; chưa tự chọn thẻ. Sidebar gọi `/cards` để tìm kiếm/phân trang. Khi chọn một ID, `App.jsx` gọi `/cards/{id}`.

`database_decrypted.db` là **nguồn dữ liệu thao tác trực tiếp**, không phải file chỉ để export. `game rules/*.xlsx` là nguồn metadata và nhãn, không thay thế cấu trúc bảng SQLite. Khi thêm hoặc đổi schema, cần đối chiếu schema DB thực tế, `load_character_context()`, SQL generator và các tab liên quan.

## 5. Mô hình thẻ và luồng chỉnh sửa

`load_character_context(card_id=...)` trong `modules/core/character.py` đọc từ `cards` rồi lần theo khóa/set/relation để trả một context phẳng hơn cho backend. `GET /api/v2/cards/{id}` trong `react_api.py` biến context đó thành JSON thuận tiện cho React:

```text
card, leader {set, skills}, passive {set, skills, effects},
active {set, link, skills}, standby {set, link, skills},
finish[], specials[], special_views[], fields[],
field_active_relations[], field_passive_relations[],
categories[], links[], chain[]
```

Các ID trong payload là ID của bảng game, không phải ID chỉ dành cho React. Các `set` thường là bản ghi mô tả/tập skill; `skills` là các dòng hiệu ứng; bảng relation nối chúng với card hoặc set. `chain` là các form/biến hình liên quan. Bản đồ chain được API cache theo dấu thời gian/kích thước DB và WAL; sau khi lưu qua API, cache bị vô hiệu hóa.

`App.jsx` giữ `cardData` là dữ liệu đã lưu và `draft` là object thay đổi **chưa lưu**, theo khóa như `passive_set`, `passive_skills`, `active_set`, `card_specials`, `finish_skill_sets`, `deleted_rows`. Các tab đọc `draft.<key>` nếu có, nếu không dùng `cardData`; `onChange(key, value)` chỉ sửa draft trong bộ nhớ trình duyệt. Đổi thẻ hoặc reset sẽ xóa draft. Một số tab thêm dòng mới không có `id` và ghi xóa vào `deleted_rows`.

Luồng lưu React:

```text
Tab -> App.draft
  -> POST /api/v2/cards/{id}/sql       (Tab SQL: xem trước, chưa ghi DB)
  -> POST /api/v2/cards/{id}/apply     (nút Save hoặc Apply ở tab SQL)
  -> generate_deep_sql_patch() + raw_sql tùy chọn
  -> backup SQLite vào backups/
  -> chạy SQL trong SQLite
  -> thêm SQL vào patches/history/card_{id}.sql
  -> tải lại GET /cards/{id}, xóa draft
```

`generate_deep_sql_patch()` ở **`react_api.py`** là bộ sinh SQL riêng cho draft React. Nó xử lý các trường thẻ, leader, passive, active, super, standby, finish và `deleted_rows`. `modules/core/sql_builder.py` có bộ `compile_character_sql()` và các hàm import/apply dùng cho snapshot/export. Hai chỗ cùng xử lý SQL nhưng **không phải một implementation duy nhất**. Với tính năng React mới, cần kiểm tra đồng thời khóa draft, JSON API và nhánh trong `generate_deep_sql_patch()`; chỉnh UI một mình chưa bảo đảm dữ liệu được lưu.

`raw_sql` từ tab SQL được nối trực tiếp vào SQL áp dụng. Route `/apply` chạy trên DB cục bộ và ghi lịch sử sau khi thực thi. Vì vậy hãy xem chức năng SQL Live Patch như thao tác ghi dữ liệu thực, không phải chỉ là một trình xem trước.

## 6. Các phần giao diện React

Danh sách tab được định nghĩa tại `web-ui/src/types.js`, điều phối ở `App.jsx`:

| Tab | Component | Dữ liệu/chức năng |
|---|---|---|
| Card Profile | `TabStats.jsx` | Chỉ số và thông tin cơ bản của `card` |
| Leader Skill | `TabLeader.jsx` | `leader.set`, `leader.skills` |
| Passive Skill | `TabPassive.jsx` | Mô tả, dòng passive, compiler và matching |
| Active Skill | `TabActive.jsx` | Set/skill Active, điều kiện và ID animation/BGM |
| Chuyển animation | `TabAnimationConvert.jsx` | Chọn thẻ/animation nguồn, slot đích và chuyển trực tiếp |
| Transformations | `TabTransform.jsx` | Xem chuỗi form/biến hình, điều hướng sang thẻ khác |
| Super Attacks | `TabSpecials.jsx` | `card_specials`, special set, hiệu ứng, bonus, extra option |
| Standby Skill | `TabStandby.jsx` | Standby set/link/skills |
| Finish Attack | `TabFinish.jsx` | Danh sách finish set, skill và special |
| Causality Logic | `TabCausality.jsx` | Xem logic điều kiện từ các phần skill |
| Domain & Fields | `TabFields.jsx` | Field, category, link và các trường liên quan |
| SQL Live Patch | `TabSql.jsx` | Xem SQL tạo từ draft, nhập SQL bổ sung, áp dụng |
| Export Patch | `TabExport.jsx` | Tạo ZIP và chuyển `.eclp` |

`Sidebar.jsx` chịu trách nhiệm tìm/lọc/chọn thẻ. `Header.jsx` có thao tác Save/Reset và đi giữa các form. `CardArtViewer.jsx` lấy hình thẻ. Cột player vẫn tồn tại khi đổi tab; `AnimPlayer.jsx` lấy danh sách animation của card, lọc theo loại rồi nạp player trong iframe.

### Passive compiler và causality

Tab Passive gọi `POST /api/v2/passive/compile` để phân tích mô tả thành các skill có cấu trúc, sau đó người dùng thêm/thay các dòng trong draft. `POST /api/v2/passive/match` so khớp dòng mô tả với skill hiện có để hiển thị. Quy tắc compiler ở `modules/core/dokkan_passive_compiler.py`; tài liệu chuyên sâu ở `modules/core/DOKKAN_PASSIVE_COMPILER_SPEC.md`. Causality dùng JSON/biểu thức điều kiện và bảng `skill_causalities`; parser/helper nằm trong `modules/core/causality.py`, UI editor dùng `CausalityExpressionEditor.jsx`.

## 7. Animation, player và tài nguyên

`GET /api/v2/cards/{id}/animations` dùng `anim_transmuter.get_card_animations()` để tìm các mục Entrance, Active, Super, Finish và loại khác từ DB/chuỗi thẻ. `AnimPlayer.jsx` chọn một script rồi tạo iframe `/player/index.html`. React gửi lệnh qua `postMessage` (`streamlit:render`, `dokkan:control`) để tải animation, play/pause, đổi tốc độ, âm thanh, đối thủ, KO và ngôn ngữ voice. Phần chạy thực tế nằm trong `components/lua_player/index.html` và các module JS cùng thư mục (Lua host, layer, LWF, effect pack, USM/video, audio bus). Tài nguyên phát được lấy qua server 8585, có cache local/CDN; static HTML/JS của player do API 8765 phục vụ. `components/lwf_player/` là player riêng khác.

Luồng **chuyển animation** là thao tác ghi DB riêng, không đi qua `App.draft`: React gọi `/animation-sources`, `/cards/{source}/animations`, rồi `POST /api/v2/animations/transmute`. Backend xác minh nguồn/slot, backup DB vào `backups/`, gọi `anim_transmuter.transmute_animation()` để tạo/copy Lua, gán slot đích và tùy chọn BGM/bỏ lệnh gây damage cho Entrance, rồi thêm SQL vào `patches/history/card_{target}.sql`. UI chặn chuyển khi còn draft chưa lưu. Slot đích đang hỗ trợ: `entrance`, `active`, `super`, `finish` (`SLOT_CONFIG`).

## 8. Xuất patch

Tab Export cho phép xuất patch trực tiếp từ dữ liệu đang chỉnh sửa (draft) mà không bắt buộc phải lưu vào database cục bộ trước. `POST /api/v2/export/build-zip` lấy ID các form trong chain, chọn asset qua `eclp_builder.find_card_assets()`. Đối với SQL (`patch.sql`), hệ thống sẽ tự động gộp lịch sử lưu trước đó (`patches/history/card_{id}.sql`) với các câu lệnh SQL sinh ra từ draft đang chỉnh sửa (`generate_deep_sql_patch`), hoặc fallback sang snapshot `compile_character_sql(load_character_context(...))` nếu không có chỉnh sửa nào. Có thể xem trước SQL của patch qua `POST /api/v2/export/preview-sql`. `eclp_builder.build_patch_zip()` tạo ZIP/metadata trong `patches/`. Có tùy chọn bỏ SQL hoặc asset.

Nếu chọn `.eclp`, React tạo ZIP trước rồi gọi `POST /api/v2/export/build-eclp`. Backend gửi ZIP và **session cookie do người dùng nhập** tới dịch vụ Dokkan Eclipse qua `eclp_builder.convert_zip_to_eclp()`, sau đó tải `.eclp` về `patches/`. Bước chuyển `.eclp` cần kết nối mạng và phiên đăng nhập hợp lệ. React Export giữ cookie trong state của tab và gửi cùng request. Không ghi cookie thật vào tài liệu, log hoặc commit.

## 9. API React: bản đồ endpoint

Base path là `/api/v2`, khai báo ở `web-ui/src/api.js` và triển khai trong `react_api.py`.

| Method + route | Ý nghĩa |
|---|---|
| `GET /health`, `/meta` | Trạng thái DB/updater; các dictionary rule |
| `GET /cards?q=&rarities=&element=&page=&limit=` | Tìm/lọc thẻ, phân trang |
| `GET /cards/{id}`, `/cards/{id}/chain` | Context đầy đủ và chuỗi form |
| `GET /cards/{id}/animations`, `/cards/{id}/ost`, `/animation-sources?q=` | Animation/OST, tìm nguồn chuyển animation |
| `GET /thumb/{id}`, `/card-art/{id}`, `/audio/{bgm\|voice}/{id}`, `/bgm/tracks` | Hình và âm thanh |
| `GET /causalities`, `/causalities/{id}`; `POST /causalities` | Đọc/tạo/sửa causality trực tiếp trong DB |
| `POST /passive/compile`, `/passive/match` | Biên dịch và so khớp mô tả passive |
| `POST /cards/{id}/sql`, `/cards/{id}/apply` | Xem trước SQL; backup và áp dụng thay đổi |
| `POST /animations/transmute` | Chuyển animation giữa các thẻ/slot |
| `POST /export/build-zip`, `/export/build-eclp` | Đóng gói và chuyển patch |

Static routes khác base API: `/player/*` và `/lwf-player/*` trên 8765. Asset server 8585 có các route riêng như `/assets/*`, `/bgm/*`, `/api/usm`; xem `BGMHttpHandler` trong `modules/core/assets.py` khi xử lý media.

## 10. File sinh ra, phụ thuộc ngoài và điểm cần chú ý

| Nơi lưu | Nội dung |
|---|---|
| `database_decrypted.db` | SQLite đang đọc/ghi; file này có thể được cập nhật upstream lúc API khởi động |
| `backups/` | Bản sao DB trước cập nhật upstream, Save hoặc chuyển animation |
| `patches/history/card_{id}.sql` | Lịch sử SQL từ Save/chuyển animation, được dùng khi xuất |
| `patches/*.zip`, `patches/*.eclp` | Patch đầu ra |
| `game res/` | Asset có sẵn hoặc được tải/cache khi duyệt và phát |
| `.runtime/` | Temp/cache, marker phiên bản DB, trạng thái chạy |
| `config.json` | Cấu hình cục bộ tùy chọn; có thể chứa cookie, không nên chia sẻ |

Tích hợp mạng hiện có: Dokkan Eclipse file browser/CDN để cập nhật DB và tải asset, Dokkan Eclipse conversion API để tạo `.eclp`. Phần đọc DB trong `modules/core/db.py` dùng kết nối `mode=ro`; các route ghi mở kết nối SQLite riêng. API chỉ bind loopback `127.0.0.1`, nhưng các route ghi dựa vào ngữ cảnh công cụ cục bộ và **không có lớp xác thực tài khoản riêng**. Khi đổi logic lưu/export, giữ đường backup và kiểm tra rõ dữ liệu đã lưu so với draft.

## 11. Bắt đầu sửa một tính năng ở đâu?

| Việc cần làm | Bắt đầu từ |
|---|---|
| Thêm/sửa trường trong một tab React | `web-ui/src/components/tabs/Tab*.jsx` → khóa `draft` → `generate_deep_sql_patch()` trong `react_api.py` → `load_character_context()` nếu cần dữ liệu mới |
| Đổi danh sách/tên tab hoặc bố cục | `web-ui/src/types.js`, `web-ui/src/App.jsx`, `web-ui/src/styles.css` |
| Đổi tìm kiếm và dữ liệu thẻ | `Sidebar.jsx`, `api.js`, routes `/cards` trong `react_api.py`, `modules/core/character.py` |
| Đổi dropdown rule/metadata | `game rules/*.xlsx`, `modules/core/db.py`, `/meta`, component sử dụng |
| Đổi compiler Passive | `modules/core/dokkan_passive_compiler.py` và spec cùng thư mục, rồi `TabPassive.jsx` |
| Đổi phát animation/asset | `AnimPlayer.jsx`, `components/lua_player/`, `modules/core/assets.py` |
| Đổi chuyển animation | `TabAnimationConvert.jsx`, route `/animations/transmute`, `anim_transmuter.py` |
| Đổi ZIP/.eclp | `TabExport.jsx`, routes `/export/*`, `eclp_builder.py` |

### Quy tắc đọc mã nhanh cho AI

1. Với giao diện, lần theo `App.jsx` → tab → `api.js` → route trong `react_api.py` → core/DB.
2. Phân biệt **dữ liệu đã lưu** (`cardData`/SQLite), **draft React**, **SQL preview**, **SQL đã apply**, và **patch đã xuất**. Chúng là các trạng thái khác nhau.
3. Với thay đổi schema hoặc loại skill, đối chiếu bảng/relation thật trong SQLite và cả luồng đọc (`load_character_context`) lẫn luồng ghi (`generate_deep_sql_patch` hoặc `sql_builder`).
4. Với media, phân biệt **static player** ở 8765 với **asset/media** ở 8585; file thiếu có thể được tải và cache khi truy cập.
5. Xem `README.md` để chạy tool; xem tài liệu này để định vị kiến trúc; xem mã nguồn hiện tại để xác nhận hành vi chi tiết trước khi sửa.
