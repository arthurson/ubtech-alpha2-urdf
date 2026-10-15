# web/ — Alpha2 靜態網頁工具（GitHub Pages 直接 serve）

## ubx-player.html — UBX 播放器（URDF mesh 即時播）
- 揀一個 `.ubx` 檔（部機 `/sdcard/actions/` 抄出嚟嗰啲），21 件原裝 mesh
 （`meshes/visual/*.obj`，vertex 色直用）即時播；滑鼠拖轉視角、碌放大縮小。
- three.js 行 CDN（要上網），mesh 經 `../meshes` 讀：本地用
  `python -m http.server` 開（唔好雙擊 `file://`），Pages 版直頭得。
- FK 同 MuJoCo 對過：5 組位（home／全零／隨機／真 `.ubx` 兩格）21 條 link
  誤差全部 < 1e-13 mm，即係同 URDF 運動學一模一樣。
- 無後端、無 build step：`fk-params.js`（URDF FK 參數）＋`ubx-parse.js`（`.ubx` 解析）＋本檔三個掟埋同一目錄就得。
- `tools/test-action.ubx` 係內置 3 格 sample（同 `tools/make_test_ubx.py` 生出嚟嗰個一模一樣）。

## GitHub Pages 發佈
- Repo Settings → Pages → Source 揀 **GitHub Actions**，`.github/workflows/static.yml`
  會將成個 repo 出街（mesh 要跟埋，唔可以淨係 `web/`）。
- 之後開 `https://<user>.github.io/ubtech-alpha2-urdf/web/ubx-player.html` 即玩。

## 工具
- `tools/extract_fk_params.py` — 由 `urdf/alpha2.urdf`＋`config/servo_map.yaml`
  抽全身 FK 參數，生 `web/fk-params.js`（唔好手改，改完重跑）。
- `tools/make_test_ubx.py` — 生一個已知內容嘅最小合法 `.ubx`
  （`tools/test-action.ubx`），畀 `ubx-parse.js` 做 byte-exact 回歸測試。
- 驗 parser：`ubx_to_traj.py`（openalpha2 嗰邊，唔喺呢 repo）讀同一個檔，
  同 `node` 跑 `ubx-parse.js` 逐格對（見當初驗證，3 格 1800ms 全中）。

## 已知差異
- 真機播多 track 檔會跟鏈式次序（`UbxParser.computePlayOrder`），呢頁用 parse 序；
  動作內容一樣，極少數多 track 檔段次序或有出入。
