# alpha2_description

> 語言：[English](README.md)｜繁體中文（本檔）

UBTECH Alpha 2 嘅標準 URDF（20 粒轉向關節、21 條 link），由
`alpha2_21parts.zip`（OBJ 散件）同 PC 軟件嘅 `alpha2.FBX`／`alpha2.xml` 起出嚟。

- 座標：REP-103（x 前、y 左、z 上），米制，`base_link` = 身體（bady1）轉軸。
- 零位 = PC 軟件模型位（企直、手垂低）。q=0 嗰陣全部 link frame 同 `base_link` 同向，坐喺舵機轉軸上。
- 散件擺位：OBJ 散件本身唔係砌好位；每件對返 FBX 同名／同頂點序 mesh 精確映射（殘差 0.001 mm）。每隻腳得兩粒細散件要用 affine fit。
- 關節軸：嚟自 `alpha2.xml` 嘅 `<Axis>`；PC 軟件（UBXRobot3DView.dll）將佢編成 Euler channel（1x+2y+3z）再套落 FBX node，啱啱出返呢度用嘅軸（head_yaw 係繞住 parent 垂直軸）。
- 舵機角度 ↔ q（嚟自 UBXRobot3DView.dll）：rotation_deg = servo_angle_deg + Offset（alpha2.xml）。即係 q_rad = radians(servo + Offset)；servo = −Offset 嗰陣 q = 0。例外：頭上下（20 號舵機）用 q = servo − 120（servo_map.yaml 入面 urdf_offset −120），因為真機 19／20 號喺 120 先係望正前方／置中；PC 軟件個 Offset（−135）會令個頭喺 120 嗰陣昂起 15 度。關節限位 = 實測舵機行程（ubtech-open-alpha2 嘅 `SERVO_CALIBRATION`，同 ubtech-open-lynx 一模一樣）：下限 = min+Offset，上限 = max+Offset。PC 預設企姿（servo = InitAngle）即係 `config/servo_map.yaml` 嘅 q_init：手臂向兩邊打開（膊頭 roll ±90 度），髖／膝微曲，腳板貼地。
- 仲係 placeholder：慣量（總共 2.3 kg（maintainer 講）。實數：20 粒舵機當質點放喺各自轉軸（child link 入面；2、3、5、6、17、18、19、20 號：每粒 40.3 g，8 kg*cm 死點扭力；1、4、7–16 號：每粒 52.8 g，20 kg*cm 死點扭力）加 3 粒 50 g 18650 喺 base_link。淨低 1.194 kg（殼、主板、線）按凸包體積分。舵機本體放喺轉軸，唔係放真重心；主板無獨立建模），速度 5 rad/s（effort = 舵機死點扭力，maintainer 確認過：輕舵機 8 kg*cm = 0.785 N*m，重舵機 20 kg*cm = 1.961 N*m；無扭力－速度曲線，即係郁緊嗰陣實際扭力會細啲）。方向：PC 軟件淨係用 alpha2.xml `<Axis>` 嘅正負號表達（成份 PC 軟件檔都無獨立方向欄）；正 =（servo + Offset）繞住嗰條軸右手旋轉（LibFBX 用 Autodesk FBX SDK）。同預設企姿下「腳板貼地／膝頭向前」對過；硬件上未量過。
- 外觀 mesh：全解像 OBJ＋原 vertex 色焗入逐色 mtl（源幾何，只搬入 link frame，無減面）；碰撞 = 凸分解（CoACD，每條 link 最多 8 件凸包，合共 160 件，箍死喺外觀 mesh 包圍盒，腳底同外形尺寸跟足外觀）。
- 睇：`ros2 launch urdf_launch display.launch.py urdf_path_or_xacro:=<path>/urdf/alpha2.urdf`（package:// URI 要個 package 喺 path 上先得）。

## 加咗嘅 frame／檔
- `base_footprint`（root；PC 軟件預設企姿下 base_link 正下方地面點，高度 0.2206 m = 外觀 mesh 最低點；零位嗰陣腳離地 2 mm）、`r_sole_frame`／`l_sole_frame`（每隻腳板平面中心）、`r_hand_tip`／`l_hand_tip`（零位嗰陣手 link 最低點）。固定關節，無質量。
- `config/alpha2.srdf`：planning group（right_arm、left_arm、right_leg、left_leg、head、arms、legs、whole_body）、group state（`zero`、`default_stance` = PC 軟件預設企姿），以及由凸包件得出嘅碰撞豁免表：20 對相鄰、2 對預設重疊、83 對喺關節限位內隨機抽 10,000 次都唔撞（105 對保持啟用）。無定義 virtual joint。
- `launch/display.launch.py`＋`rviz/alpha2.rviz`：robot_state_publisher＋joint_state_publisher_gui＋RViz2。無喺真 ROS／RViz 跑過（build 環境無裝 ROS）；URDF 改用 offscreen renderer 驗（同樣解 package:// URI、mesh 色、TF frame：零位、預設企姿、六個官方動作、由下影腳底）。
- 用 202 個官方 `.ubx` 動作測過（限位、方向、自撞、掂地）：結果喺傾計度；script 無收錄。
- `camera_link`／`camera_optical_frame`：頭正面細圓圈鏡頭中心（head_pitch_link 入面 x=0.053、z=0.04937）；內參未知。部機無 IMU，得頭主板上一粒平放嘅加速度計：`accel_link`（釘死喺 head_pitch_link，軸同頭 frame 同向，位置當咗頭 link 質心）。
- 電池模型（base_link inertial）：3 粒直立 18650（18.3 x 65 mm，每粒 50 g）喺背脊排一橫，中心 x=−0.026、y=−0.0183／0／+0.0183、z=0.062（base_link 入面）。位置係估唔係量；知實數請改 base_link inertial 註解／數值。

## 授權
GPL-3.0-only（見 `LICENSE`；`package.xml` license 欄）。覆蓋呢度生出嚟嘅檔（URDF、SRDF、config、launch、本包 script）。mesh 幾何嚟自 maintainer 提供嘅 UBTECH Alpha 2 PC 軟件模型／散件，本包唔授予該第三方素材任何權利。

## 關節限位取捨（另見 config/servo_envelope.yaml 同穩定性一節）
限位死守實測舵機行程（SERVO_CALIBRATION）＋Offset，刻意唔放寬。202 個官方 `.ubx` 動作（95 個檔）約一成格會超標，最多 15 度，主要係膊頭 roll（2／5 號）；掐住呢個限位播嘅 controller 嗰啲格會播細少少。

## 碰撞模型已知限制
- 源模型隻腳 81.5 mm 闊、中心先隔 ~78 mm，兩條 ankle_roll link 喺模型入面本身就疊咗幾 mm（部份位姿會報腳撞腳，關節限位內最多入 ~7 mm）。
- CoACD 預處理將碰撞件某啲位脹大咗幾 mm（箍死喺外觀包圍盒，唔係貼住表面）。

## MuJoCo
- `urdf/alpha2_mujoco.urdf`：物理用複本（淨碰撞件，無外觀、無 frame link、無 base_footprint、MuJoCo `<compiler>` hint）。`mujoco/stand_test.py`：free base＋地下＋位置舵機（kp 20、kv 0.5、逐粒扭力上限 0.785／1.961 N*m）＋關節 armature 0.005 kg*m^2＋implicitfast integrator；要 `pip install mujoco`。
- Armature 同 implicitfast 缺一不可：最輕條 link 主慣量得 ~8e-7 kg*m^2，MuJoCo 預設 explicit 積分喺舵機剛度下數值唔穩（唔加會跌／爆開）。
- 結果（MuJoCo 3.15）：URDF 關節範圍／軸／原點同獨立 FK 對到 0.00000 mm；總質量 2.300 kg；預設企姿企得穩 5 秒（~0.5 度傾）；202 個官方動作開 position servo 重播：193 個企到，9 個跌（無平衡控制器下嘅地板／單腳動作）；mu = 1.0 嗰陣髖 roll 好似 ~30 個動作到 stall（15–37 N*m demand）：係摩擦假象（腳咬死地下、髖照指令側移）。mu = 0.5 嗰陣企得穩嗰 193 個入面得 1 個超髖 roll 死點扭力（BackStand 4.2 N*m）；其餘超 stall 係膊頭 roll（12–14 個）同頭上下（10 個），部份嚟自超校準限位嘅格，可能加自撞。

## Isaac Sim
無跑過（build 環境無 GPU）。`urdf/alpha2_isaac.urdf`（相對 mesh 路徑）、`isaac/import_and_stand.py` 同 `isaac/README.md` 備好；offline pre-flight check 過咗（見 isaac/README.md）。

## Gazebo
- 淨係用 libsdformat 14 試過（由 source 起嘅 Gazebo Harmonic parser），無真係模擬過（build 環境無 Gazebo runtime／GPU）。
- `urdf/alpha2.urdf` 零 error／warning load 到：23 links、22 joints（20 revolute）、總質量 2.30002 kg、慣量全部合法、160 個碰撞、關節限位／effort／damping 照跟。
- Gazebo 掉冇質量 link，所以 `camera_link` 同 `accel_link`（sensor 座）帶住 10 mg 象徵慣量、用 `<gazebo reference=... preserveFixedJoint>` 留低；其餘 frame（腳底、手尖、相機光學）變 SDF `<frame>`。腳摩擦 mu1／mu2 = 1.0（兩邊 ankle_roll）。
- `model.sdf`＋`model.config`（sdformat 生；mesh URI `model://alpha2_description/...`，181 個全解到）同 `gazebo/alpha2_world.sdf`（DART、地下、經 `<include>` 入模、20 個 JointPositionController plugin：kp 20、kv 0.5、扭力上限 = 舵機死點扭力）。用法：`export GZ_SIM_RESOURCE_PATH=<alpha2_description 上層>; gz sim -r gazebo/alpha2_world.sdf`。
- Controller gain 照 MuJoCo 試出嚟嗰套；Gazebo 無 joint armature，啲超輕 link 可能令舵機震——咁就調低 kp／kd 或 step。
- Gazebo Classic 直接食 URDF（生出嚟嘅 SDF 係 1.11 版）。

## 摩擦（模擬用）
腳／地下摩擦定咗 mu = 0.5（Gazebo ankle mu1／mu2 同地下、MuJoCo stand_test 嘅 FRICTION），係 202 動作實測後定嘅：mu = 1.0 嗰陣髖 roll 要 15–37 N*m，mu = 0.5 跌返 ~1–4 N*m。真實地板／腳摩擦未知；量過（例如斜面試）請改。

## 同公開規格對照
- 公開（零售 listing 引嘅 UBTECH 規格）：高 438 x 闊 218 x 深 122 mm；press／CNET 話 ~5 磅（約 2.27 kg）；Hello Alpha 說明書影到約 2.4 kg（OCR，部份亂碼）。模型：高 437 mm；闊 205 mm（零位、手垂低）；深 128 mm（= 腳長）；質量 2.3 kg（maintainer 講）。
- 舵機扭力：說明書寫 20 kg*cm 同 8 kg*cm；Alpha 1S UBT-12HC 舵機（42 g、44 x 22.5 x 29 mm）標 8 kg*cm @ 6.5 V、12 kg*cm @ 8.5 V。URDF 用 maintainer 嘅死點扭力：輕舵機 8 kg*cm（0.785 N*m，maintainer 更正過，本來寫 12 kg*cm）、重舵機 20 kg*cm（1.961 N*m）。

## 202 個官方動作穩定性（MuJoCo，mu 0.5，開環位置舵機，扭力上限 8／20 kg*cm）
真機 ground truth（maintainer）：FrontStand 同 stretch forward 以外，部部真機播都唔跌。
- 素 setup（URDF／校準關節限位、每格 = move s tick 再 hold e tick）播完有 5 個真機播到嘅動作模型瞓低：body being hollowed out、Sirius、london bridge is falling down（檔 1466392694013），加真係會跌嘅 FrontStand 同 stretch forward。
- 起因：
  * body being hollowed out：指令舵機值（ID9 = 25、ID14 = 215、ID5 = 25）出咗實測 SERVO_CALIBRATION（[35,230]、[10,205]、[30,190]）；掐住行唔到個深蹲，模型向前仆落腳趾。放寬 15 度搞掂。即係實測行程緊過真舵機喺官方動作郁到嘅範圍（config/servo_envelope.yaml 列咗 202 招實際用嘅範圍；URDF 限位刻意唔放寬）。
  * Sirius：move-then-hold 時序會跌，成個（s+e）slot smooth 插值就企到。
  * 唔關事（驗過）：扭力上限（無限／兩倍扭力一樣跌）、舵機速（全部指令速 ≤ 5.4 rad/s）、自撞幾何、摩擦（0.3–1.5）、電／板質量。
- 最貼真機設定：全 slot smooth 插值＋關節範圍放寬 15 度：淨 FrontStand、stretch forward 同一個 london bridge 檔瞓低（202 中 199 同真機一致）。
- 未解：london bridge is falling down（檔 1466392694013，27 秒）：~19.5 秒起模型單左腳企（右腳提起）、身向左拗 50–70 度、COM 喺腳左面 ~11–16 cm，23.8 秒跌；摩擦、時序、限位都改變唔到。真機嗰段做乜未知（係咪用左手／手肘掂地？）。
- 由接觸點計嘅 COM／ZMP-margin 統計唔可靠（槍槍都 flag），唔採信。跌唔跌睇終態（base 高 < 0.15 m 或傾 > 40 度），唔睇身傾（鞠躬、挨身 legit 會過 45 度）。

## 網頁工具（本 repo 新增，非原英文檔所有）
- `web/ubx-player.html` — 純靜態 UBX 播放器：即場 parse `.ubx`，21 件原裝 mesh（three.js）＋配樂同步播（voice 幀獨立 clock，起新歌打斷舊歌，`playbackRate` 跟速度）。FK 參數由 URDF＋servo_map.yaml 機器生成（`web/fk-params.js`），解析同 openalpha2 嘅 `ubx_to_traj.py` 逐 byte 對過；成套 FK 同 MuJoCo 對過（21 條 link 誤差 < 1e-13 mm）。開法：repo root 起 `python -m http.server`（唔好雙擊 `file://`），或經 GitHub Pages（`.github/workflows/static.yml`，Settings → Pages → Source 揀 GitHub Actions）。
- `actions/` — 隨包附送 202 招官方 `.ubx`（`manifest.json` 清單、`names.json` 中英文名、`actionInfo.txt` 原檔；mp3 配樂同目錄，播片嗰陣先落）。授權同 mesh 一樣：UBTECH 原廠素材，本包唔授予任何權利。
- `web/tools/` — `extract_fk_params.py`（抽 FK 參數）、`make_test_ubx.py`（最小合法 `.ubx` 回歸測試）、`make_manifest.py`（生 `actions/manifest.json`）。
