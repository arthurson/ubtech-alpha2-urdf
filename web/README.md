# web/ — Alpha2 靜態網頁工具（GitHub Pages 直接 serve）

## ubx-player.html — UBX 播放器（URDF mesh 即時播）
- 開頁即用：揀一個 `.ubx`（部機 `/sdcard/actions/` 抄出嚟嗰啲），21 件原裝 mesh
  （`meshes/visual/*.obj`，vertex 色直用）即時播；拖轉視角、碌 zoom、前後左右頂底⌂ 預設。
- 一次過揀成個 `alpha2_description` 資料夾（folder picker）可完全離線：
  mesh／動作清單（manifest＋meta 時長／🎵）／配樂全部本地直讀，`file://` 雙擊開都用到。
  有網（http/https）時資料夾格會收埋，改由 `../meshes`、`../actions` 直接讀。
- 功能：20 粒舵機 slider（校準範圍／官方行程按鍵）＋回中／零位／關節資料表；「offset」
  格以 q_init_deg 顯示 20 隻 servo 嘅零位校準（1° 步進）；有效 offset =
  q_init_deg − pc_init_angle（FK 同零位共用同一套），可直接改並即時更新 FK／畫面，
  唔會寫入模型；播放列（播／停／循環／靜音／0.5x–2x／拖軸 seek）；多 track
  播放序；配樂跟真機獨立 clock。
- 腳部錨定（預設關）：支撐腳＝較低 sole（2cm 遲滯）、pitch 跟支撐腳、roll 鏡像
  外傾抵銷／否則跟最平嗰隻、最低鞋底角貼地（唔插地）；播片平滑，seek／拖軸即到。
- 質心標記（橙點＋投影線＋地面錐，跟參考 viewer）；數據驅動世界位移（腳鎖：貼地腳
  身框飄移 → 機身郁，轉身 45° 校準按腳部活動量分佈）；FrontStand／BackStand 瞓低
  起身（活動量帶動）；IK（頂部掣，拖手／腳藍點，LM 阻尼最小二乘＋多起點；拖綠點＝
  拖身體：雙腳釘地，拖骨盆前後左右／Shift＋拖升降／Alt＋拖鞠躬側傾，雙腿自動解 IK，
  鞋底保持水平；鞠躬／側傾越大，平移範圍自動收窄，避免腳離開地面；
  右邊舵機面板、官方行程按鍵下面有「蹲下」「左右」「前後」三個 slider（0-100）：蹲下＝
  重現官方「蹲下」pose（手垂低、深蹲，錨定釘腳＝機身下降）；左右＝左右劈腿，hip/ankle roll 補償令鞋底保持水平，
  servo 2/5 自動張開避手；前後＝左腳前、右腳後，hip/knee/ankle pitch 補償令鞋底
  保持水平，同蹲下互斥）；手機／平板自動版面（頂 bar＋動作／舵機 drawer）。
- three.js 已收歸 `vendor/`（r147 UMD，唔經 CDN），mesh 經 `../meshes` 讀。
- FK 同 MuJoCo 對過：5 組位（home／全零／隨機／真 `.ubx` 兩格）21 條 link
  誤差全部 < 1e-13 mm，即係同 URDF 運動學一模一樣。
- 配樂同步：`.ubx` 入面嘅 voice 幀（歌名＋起止）照真機獨立 clock 排播，
  起新歌打斷舊歌，`playbackRate` 跟速度選擇；歌檔嚟自 `actions/<id>/`，
  清單見 `actions/manifest.json`（`make_manifest.py` 生）。慢鏡模式音樂會
  照比例慢（browser 有上下限，極端值未必跟足，1x 對同步最準）。
- 無後端、無 build step：`fk-params.js`（URDF FK 參數）＋`ubx-parse.js`（`.ubx` 解析）＋`vendor/three.min.js`＋`vendor/OBJLoader.js`＋`vendor/OrbitControls.js`＋本檔掟埋同一目錄就得。
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
- 已跟齊官方播放流程（Alpha2Services 1.1.7.3；203 招逐格角度／時間／歌對過全中）：
  入口 leaf 鏈、block 內置 f 表 gate（0/3 播、1 中斷、2 跳過）、Loop block
  （(track,block) 快取 i/g/h）、f==1 跳 track、c==-2 跨 track 續接、
  逐 block timebase（static 後蓋前）。
- 舵機值 255（真機＝該舵機放鬆斷力）：呢頁冇力學，非手指舵機沿用上一幀、
  手指當 120 近似顯示（corpus 255 只見於雙手同 1509001441250 嘅左肘）。
