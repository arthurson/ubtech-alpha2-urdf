# web/ — Alpha2 靜態網頁工具（GitHub Pages 直接 serve）

## ubx-player.html — UBX 播放器（URDF mesh 即時播）
- 開頁即用：揀一個 `.ubx`（部機 `/sdcard/actions/` 抄出嚟嗰啲），21 件原裝 mesh
  （`meshes/visual/*.obj`，vertex 色直用）即時播；拖轉視角、碌 zoom、前後左右頂底⌂ 預設。
- 一次過揀成個 `alpha2_description` 資料夾（folder picker）可完全離線：
  mesh／動作清單（manifest＋meta 時長／🎵）／配樂全部本地直讀，`file://` 雙擊開都用到。
  有網（http/https）時資料夾格會收埋，改由 `../meshes`、`../actions` 直接讀。
- 功能：20 粒舵機 slider（校準範圍／官方行程按鍵）＋回中／零位（PC 軟件企姿，手垂低；開頁 preset）／關節資料表；「offset」
  格以 q_init_deg 顯示 20 隻 servo 嘅零位校準（1° 步進）；有效 offset =
  q_init_deg − pc_init_angle（FK 同零位共用同一套），可直接改並即時更新 FK／畫面，
  唔會寫入模型；播放列（播／停／循環／靜音／0.5x–2x／拖軸 seek）；多 track
  播放序；配樂跟真機獨立 clock。
- 腳部錨定（預設開）：支撐腳＝較低 sole（2cm 遲滯）、pitch 跟支撐腳、roll 鏡像
  外傾抵銷／否則跟最平嗰隻、最低鞋底角貼地（唔插地）；播片平滑，seek／拖軸即到。
- 質心標記（預設開；橙點＋投影線＋地面錐，跟參考 viewer）；數據驅動世界位移（腳鎖：貼地腳
  身框飄移 → 機身郁，轉身 45° 校準按腳部活動量分佈）；FrontStand／BackStand 瞓低
  起身（活動量帶動）；IK（頂部掣，預設開，拖手／腳藍點，LM 阻尼最小二乘＋多起點；拖綠點＝
  拖身體：雙腳釘地，拖骨盆前後左右／Shift＋拖升降／Alt＋拖鞠躬側傾，雙腿自動解 IK，
  鞋底保持水平；鞠躬／側傾越大，平移範圍自動收窄，避免腳離開地面；
  右邊舵機面板、官方行程按鍵下面有「蹲下」「蹲式」「左右」「前後」四個 slider（前三個 0-100，前後 -100–100、預設 0）：
  蹲下＝重現官方「蹲下」pose（手垂低、深蹲，錨定釘腳＝機身下降）；蹲式＝官方「蹲式」
  （1509004868066）最深嗰格（深蹲、雙臂左右張開、腳掌貼地，同蹲下／前後互斥）；
  左右＝左右劈腿，hip/ankle roll 補償令鞋底保持水平，
  servo 2/5 自動張開避手；前後＝雙腳前後劈腿，-100＝左腳前、右腳後（右臂前擺、左臂後擺）；
  +100＝右腳前、左腳後（左臂前擺、右臂後擺，左前嘅鏡像）；0＝中立，
  hip/knee/ankle pitch 補償令鞋底保持水平，同蹲下互斥）；手機／平板自動版面（頂 bar＋動作／舵機 drawer）。
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

## GitHub 雲端訓練（rl-cloud.js）

播放器「物理」面板下面有「☁ GitHub 雲端訓練」：喺網頁設定參數，撳「開始訓練」就經 GitHub API 觸發 `.github/workflows/train.yml`
（`workflow_dispatch`），訓練喺 GitHub Actions 跑（CPU，最長約 6 小時）。

**結果保存**：每次訓練完成會推去 `policies` branch：`policies/<任務>/<名稱>/{policy.onnx,ref.json,meta.json,curve.json}`，
並更新 `policies/index.json`（所有 policy 嘅清單，最新排最前）。名稱留空＝自動（`<任務>-YYYYMMDD-HHMM`），同任務同名先會覆蓋。
舊格式（`policies/<任務>/policy.onnx`）會自動搬去 `<任務>/legacy/`。Checkpoint（接續訓練用）仍然每個任務一份。

**面板功能**
- 設定：任務（站穩／步行）、名稱、時長、接續上次 checkpoint；進階：推力、推嘅機率、傾斜／偏離企姿／跟隨動作／動作平滑／扭力權重、seed。
  預設值同原本寫死嘅一樣（見 `rl/alpha2_env.py` 嘅 `CFG`）；obs／action 格式同 `ACT_SCALE`／`DECIM` 唔開放（要同 `mj-sim.js` 一致）。
- 「已訓練嘅 policy」清單：揀一個再撳「⬇ 載入」就交俾 RL policy 載入器（會自動開物理）。完成一次訓練後會自動揀返同載入嗰個 run 嘅結果。
- 「比較／訓練曲線」：表格列出每個 policy 嘅時長、步數、評估存活、基準、同預設唔同嘅參數（撳一行就揀嗰個）；
  曲線圖畫訓練期間 `ep_len_mean`／`ep_rew_mean`，可以揀第二個 policy 疊埋一齊比較。
  曲線係訓練期間（有推力、隨機動作）嘅成績，通常低過最後評估。
- 淨係睇清單、曲線同載入結果（public repo）唔使 token。

**Token**：喺 GitHub → Settings → Developer settings → Fine-grained tokens 建立，**只揀呢個 repo**，權限 **Actions: Read and write**，貼入面板。
Token 只會傳去 `api.github.com`；除非剔「記住」，否則唔會存入瀏覽器。唔好將 token 寫入 html／commit。

**手動觸發**：Actions → train-rl → Run workflow，`cfg` 填 JSON，例如 `{"push_force": 5, "w_smooth": 0.05}`，`name` 填名稱。

## 自動循環（訓練 → 評估 → 調整 → 再訓練）

面板「♻ 自動循環」會觸發 `.github/workflows/autoloop.yml`。每個**世代**：

1. **訓練**：並行訓練 K 個候選（GitHub matrix），全部由現任 champion 續訓，各自用唔同嘅推力／reward 設定。
2. **評估**：`rl/evaluate.py` 量度平地行走（存活、距離、偏移、傾斜）同**持續多步嘅推力**存活率，合成 0–1 評分（`rl/scoring.py`）。
   純存活率會飽和（連冇訓練嘅 baseline 都滿分），所以評分以傾斜、距離、抗推為主，並相對於零動作 baseline。
3. **Review**：最好嘅候選要贏過現任 champion 超過 0.01 先取代（避免評估噪音）；取代嘅會發佈成 `<loop>-g<N>`，出現喺面板嘅 policy 清單。
4. **調整**：候選 0 係「對照」（同設定繼續練），候選 1 係課程式（champion 頂得住就加推力，否則加重傾斜懲罰），其餘係隨機變異；
   連續冇進步變異幅度會縮細。只會調 `rl/autoloop.py` 嘅 `TUNE` 入面嘅參數，**唔會改代碼**。
5. **重複**：用 `GITHUB_TOKEN` 自動 dispatch 下一個世代。

**停止條件**：評分達 0.95、連續 `耐性` 個世代冇進步、到最多世代、全部候選失敗、你撳「■ 停止循環」（取消 run）、
喺 `policies` branch 建立 `loop/<名稱>/STOP` 檔案，或者喺 Actions 頁停用 workflow。預設最多 10 個世代、每個候選 330 分鐘（5.5 小時，GitHub 單個 job 上限 6 小時連安裝同評估，所以 330 係安全上限）、3 個候選。想先試流程可以將分鐘改成 30、最多世代改成 2。

**狀態**：`policies/loop/<名稱>/state.json`（世代、champion、baseline、每個候選嘅參數同成績）；champion 嘅 checkpoint 喺 `loop/<名稱>/champion/`。
同一個名稱再撳「開始」會由狀態繼續（候選數、分鐘等設定唔會改）；新名稱係新 loop（由頭練起）。

**用量**：每世代 ＝ 候選數 × 分鐘數嘅 runner 時間（Public repo 標準 runner 免費，Free 計劃同時最多 20 個 job）。

## 起身 policy（getup_back／getup_front）

面板「任務」可以揀兩個起身任務，對應官方動作：
- **起身（仰躺・頭向上）`getup_back`**：背貼地、面向上，參考官方 `BackStand`（8 秒）。
- **起身（趴著・頭向下）`getup_front`**：胸貼地、面向下，參考官方 `FrontStand`（11.3 秒）。

做法同步行一樣：policy 輸出對參考關節目標嘅殘差（`rl/ref/backstand.json`、`frontstand.json`，由 `rl/make_ref.mjs` 從 `.ubx` 產生）。
一集 ＝ 參考動作 ＋ 3 秒保持站立；成功 ＝ 最後 0.5 秒企直（傾斜 < 20°、機身高 > 0.19 m）。獎勵 ＝ 貼近參考 ＋ 高度／直立進度 ＋ 企住嘅獎勵；推力只喺應該已經企起之後先會出現。
評估（`rl/evaluate.py`）量度起身成功率、起身時間、最後傾斜，同企起之後受持續推力嘅存活率，合成 0–1 評分（`rl/scoring.py`）。
自動循環同樣支援：起身未穩（成功率 < 0.9）就加重「企住」獎勵，穩咗先逐步加推力。

**喺播放器睇**：開「物理」，「RL policy」揀 `policy.onnx` 同 `ref.json`（要一齊揀），撳「由 policy 控制」——機器人會自動由躺低開始（仰躺或趴著按 `ref.json`），「重置」會再躺返低；「推」可以喺佢企起後推佢。

**留意**：官方起身動作喺模擬入面處於邊緣（仰躺可成功；趴著靠隨機摩擦／質量先有大約七成成功），所以訓練目標係令佢喺各種條件下都穩陣。呢啲只係模擬結果，未喺真機驗證；真機起身扭力同接觸同模擬有差異，請小心測試。
