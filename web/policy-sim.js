// policy-sim.js - standalone page runtime for policy.html (GPL-3.0-only, same as the package).
// Runs the ONNX policies trained by rl/train.py (GitHub Actions) on MuJoCo WASM physics and draws the robot straight from the MuJoCo model
// (no link tree / FK of ubx-player.html needed).  Only the UNIFIED policies are supported (obs 68 -> action + delta, 100 ms step; see rl/alpha2_env.py).
// It also provides what rl-cloud.js (the GitHub training panel) expects from its host page: I18N / T / applyLang / $ and window.MJSIM
// (on, toggle, loadPolicy, pol), and a #mjbox element to mount the panel after.
// Engine: vendor/mujoco/mujoco.{js,wasm} (official @mujoco/mujoco 3.17.0), model ../mujoco/alpha2.xml, vendor/ort (onnxruntime-web), vendor/three.min.js.
(function () {
  'use strict';
  var BASE = document.currentScript ? document.currentScript.src : location.href;
  // unified policies (must equal rl/alpha2_env.py: OBS_DIM, CTRL_DT, DECIM, GAIT_PERIOD, zero pose, Z0)
  var UNI = { nobs: 68, cdt: 0.1, decim: 50, gait: 1.0, z0: 0.2241, q0: new Array(20).fill(0), push: 6 };   // push = N, held for one control step (training default 6 N x 0.1 s)
  var POL = { sess: null, ref: null, task: '', file: '', k: 0, on: false, busy: false, acc: 0, prev: new Float64Array(20), pending: null, obs: null, act: null,
    cmd: [0, 0, 0], cmdMax: [0.03, 0.02, 0.3] };   // cmd = velocity command (vx m/s, vy m/s, wz rad/s)
  var S = window.MJSIM = { on: true, ready: false, loading: false, mj: null, m: null, d: null, bid: {}, act: [], qadr: [], ts: 0.002, simT: 0, pol: POL, UNI: UNI,
    toggle: function () {}, running: true };   // rl-cloud.js calls MJSIM.on / toggle / loadPolicy / pol
  var push = { left: 0, f: [0, 0] }, modP = null, ortP = null, statT = 0;

  // ---- i18n (rl-cloud.js adds its own keys to I18N) ----
  var uiLang = 'zh'; try { uiLang = localStorage.getItem('ubx_lang') || (/^zh/i.test(navigator.language || '') ? 'zh' : 'en'); } catch (e) { uiLang = 'zh'; }
  window.I18N = window.I18N || {};
  var TXT = {
    p_title: ['ONNX policy 訓練同試行', 'ONNX policy trainer & runner'],
    p_sub: ['喺 GitHub Actions 訓練 → 載入 policy → 用 MuJoCo 物理試行（只支援 obs 68、100 ms 嘅新格式）', 'Train on GitHub Actions -> load the policy -> run it on MuJoCo physics (new format only: obs 68, 100 ms step)'],
    p_play: ['▶ 開始', '▶ Run policy'], p_stop: ['■ 停止', '■ Stop'], p_reset: ['重置', 'Reset'], p_push: ['推', 'Push'],
    p_play_t: ['由 policy 控制機器人（會重置到起始姿勢）', 'Let the policy control the robot (resets to its start pose)'],
    p_stop_t: ['停止 policy，機器人用零位站姿靠舵機硬撐', 'Stop the policy; the robot holds the zero pose with its servos'],
    p_reset_t: ['機器人擺返企喺地面（零位，或者 policy 嘅起始姿勢）', 'Put the robot back on the floor (zero pose, or the policy start pose)'],
    p_push_t: ['隨機方向推機身一下（6 N、0.1 秒＝訓練預設）', 'Random push on the base (6 N for 0.1 s = the training default)'],
    p_file: ['載入檔案', 'Load files'],
    p_file_t: ['揀 policy.onnx（模仿步行／起身仲要同時揀 ref.json；meta.json 可選）', 'Pick policy.onnx (reference walk / get-up also needs ref.json; meta.json optional)'],
    p_none: ['未載入 policy', 'no policy loaded'],
    p_hint: ['鍵盤：W/S 前後、A/D 左右、Q/E 轉身、空白或 X 停。', 'Keys: W/S forward/back, A/D left/right, Q/E turn, Space or X stop.'],
    p_http: ['要用 http(s) 開（GitHub Pages 或本機 server），file:// 載入唔到 MuJoCo／ONNX WASM。', 'Open this page over http(s) (GitHub Pages or a local server); MuJoCo / ONNX WASM cannot load from file://.'],
    mj_loading: ['載入中…', 'Loading…'], mj_fail: ['失敗：', 'Failed: '], mj_fallen: ['跌', 'fell'], mj_pol_ok: ['policy 已載入', 'policy loaded'],
    mj_cmd: ['速度', 'Velocity'],
    mj_cmd_t: ['速度指令（機身座標）：vx 前後 m/s、vy 左右 m/s、wz 轉身 rad/s。範圍＝訓練嗰陣嘅上限。', 'Velocity command (body frame): vx forward/back m/s, vy left/right m/s, wz turn rad/s. Range = the limit used in training.'],
    mj_ref_need: ['呢個 policy（模仿步行／起身）要成個 ref.json（同 policy.onnx 一齊揀）', 'This policy (reference walk / get-up) needs its ref.json (select it together with policy.onnx)'],
    mj_bad_pol: ['唔支援嘅 policy：', 'Unsupported policy: '],
    mj_old: ['舊格式（obs 43／65，20 ms）policy 要用 ubx-player.html 載入', 'Legacy policies (obs 43 / 65, 20 ms) load in ubx-player.html'],
    mj_stat: ['物理', 'Physics']
  };
  Object.keys(TXT).forEach(function (k) { window.I18N[k] = { zh: TXT[k][0], en: TXT[k][1] }; });
  window.T = function (k) { var e = window.I18N[k]; if (!e) return k; return uiLang === 'zh' ? e.zh : e.en; };
  window.$ = function (id) { return document.getElementById(id); };
  window.log = function (s) { try { console.log(s); } catch (e) { /* ignore */ } };
  window.applyLang = function () {
    document.documentElement.lang = uiLang === 'zh' ? 'zh-Hant' : 'en';
    document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = T(el.getAttribute('data-i18n')); });
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) { el.title = T(el.getAttribute('data-i18n-title')); });
    var b = $('langBtn'); if (b) b.textContent = uiLang === 'zh' ? 'EN' : '中';
    polBtn();
  };
  window.toggleLang = function () { uiLang = uiLang === 'zh' ? 'en' : 'zh'; try { localStorage.setItem('ubx_lang', uiLang); } catch (e) { /* ignore */ } applyLang(); };
  var $ = window.$, T = window.T;

  // ---- loading ----
  function rd(f, kind) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = function () { rej(r.error || new Error('read fail')); };
    kind === 'buf' ? r.readAsArrayBuffer(f) : r.readAsText(f); }); }
  function dynImport(u) { return (new Function('u', 'return import(u)'))(u); }
  function inject(src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('cannot load ' + src)); }; document.head.appendChild(s); }); }
  function stat(t, warn) { var e = $('mjstat'); if (!e) return; e.textContent = t; e.style.color = warn ? 'var(--warn)' : ''; }
  S.load = function () {
    if (modP) return modP;
    S.loading = true;
    modP = (async function () {
      if (location.protocol === 'file:') throw new Error(T('p_http'));
      var mod = await dynImport(new URL('vendor/mujoco/mujoco.js', BASE).href);
      var r = await fetch(new URL('../mujoco/alpha2.xml', BASE).href); if (!r.ok) throw new Error('alpha2.xml HTTP ' + r.status);
      var mj = await mod.default({}); build(mj, await r.text()); S.loading = false;
    })();
    modP.catch(function () { modP = null; S.loading = false; });
    return modP;
  };
  function build(mj, xml) {
    var m = mj.MjModel.from_xml_string(xml), d = new mj.MjData(m), O = mj.mjtObj, js = {};
    S.mj = mj; S.m = m; S.d = d; S.act = []; S.qadr = []; S.jid = []; S.ts = m.opt.timestep;
    Object.keys(FK.chains).forEach(function (c) { FK.chains[c].forEach(function (j) { js[j.servo] = j.joint; }); });
    Object.keys(FK.handJoints).forEach(function (k) { js[+k] = FK.handJoints[k].joint; });
    for (var k = 1; k <= 20; k++) {   // servo order 1..20 = the order of the observation / action
      var j = mj.mj_name2id(m, O.mjOBJ_JOINT.value, js[k]), a = mj.mj_name2id(m, O.mjOBJ_ACTUATOR.value, 'act_' + js[k]);
      if (j < 0 || a < 0) throw new Error('servo ' + k + ' joint/actuator missing');
      S.jid.push(j); S.act.push(a); S.qadr.push(m.jnt_qposadr[j]);
    }
    FK.links.forEach(function (ln) { S.bid[ln] = mj.mj_name2id(m, O.mjOBJ_BODY.value, ln); });   // one MuJoCo body per link (same name as the visual mesh)
    if (!(S.bid.base_link >= 0)) throw new Error('body base_link missing');
    S.ready = true;
  }
  function loadOrt() {
    if (ortP) return ortP;
    ortP = (async function () {
      if (location.protocol === 'file:') throw new Error(T('p_http'));
      await inject(new URL('vendor/ort/ort.wasm.min.js', BASE).href);
      window.ort.env.wasm.wasmPaths = new URL('vendor/ort/', BASE).href; window.ort.env.wasm.numThreads = 1; window.ort.env.wasm.proxy = false;   // no COOP/COEP needed
    })();
    ortP.catch(function () { ortP = null; });
    return ortP;
  }

  // ---- policy ----
  S.loadPolicy = async function (files) {
    var list = files && files.length !== undefined && !files.name ? Array.prototype.slice.call(files) : (files ? [files] : []);
    var file = list.filter(function (f) { return /\.onnx$/i.test(f.name); })[0], jsons = list.filter(function (f) { return /\.json$/i.test(f.name); });
    if (!file) return;
    try {
      stat(T('mj_loading')); await loadOrt(); await S.load();
      var sess = await window.ort.InferenceSession.create(new Uint8Array(await rd(file, 'buf')), { executionProviders: ['wasm'] });
      var md = sess.inputMetadata, nobs = md && md[0] && md[0].shape && md[0].shape[1] > 0 ? md[0].shape[1] : 0, ref = null, meta = null;
      if (nobs === 43 || nobs === 65) throw new Error(T('mj_old'));
      if (nobs !== UNI.nobs) throw new Error(T('mj_bad_pol') + 'obs ' + nobs);
      if (!sess.outputNames || sess.outputNames.indexOf('delta') < 0 || sess.outputNames.indexOf('action') < 0) throw new Error(T('mj_bad_pol') + 'outputs ' + (sess.outputNames || []).join(','));
      for (var ji = 0; ji < jsons.length; ji++) {   // ref.json (has q) and / or meta.json (has task, cfg)
        var jo = null; try { jo = JSON.parse(await rd(jsons[ji])); } catch (e) { jo = null; }
        if (jo && jo.q) ref = ref || jo; else if (jo && jo.task) meta = meta || jo;
      }
      var wantRef = !!(meta && /^(walk_ref|getup)/.test(meta.task || ''));
      if (wantRef && !ref && meta.task === 'walk_ref') {   // reference walk without its reference file: the official forward walk
        var r = await fetch(new URL('../rl/ref/forward.json', BASE).href); if (r.ok) ref = await r.json();
      }
      if (wantRef && (!ref || (!ref.loop && !ref.getup))) throw new Error(T('mj_ref_need'));
      POL.sess = sess; POL.ref = ref; POL.task = meta && meta.task || (ref ? (ref.getup ? 'getup' : 'walk_ref') : ''); POL.file = file.name; POL.cmd = [0, 0, 0];
      var cf = meta && meta.cfg || {}; POL.cmdMax = [cf.cmd_vx > 0 ? cf.cmd_vx : 0.03, cf.cmd_vy > 0 ? cf.cmd_vy : 0.02, cf.cmd_wz > 0 ? cf.cmd_wz : 0.3];
      updateCmdUI(); stat(T('mj_pol_ok') + ': ' + file.name + (POL.task ? ' (' + POL.task + ')' : '')); S.play(true);
    } catch (e) { POL.sess = null; POL.on = false; updateCmdUI(); polBtn(); stat(T('mj_fail') + (e && e.message || e), true); }
  };

  // ---- velocity command (sliders + keyboard) ----
  function updateCmdUI() {
    var row = $('mjCmdRow'); if (row) row.style.display = POL.sess && !POL.ref ? 'flex' : 'none';
    [['mjCvx', 0], ['mjCvy', 1], ['mjCwz', 2]].forEach(function (p) {
      var e = $(p[0]), v = $(p[0] + 'V'), mx = POL.cmdMax[p[1]]; if (!e) return;
      e.min = -mx; e.max = mx; e.step = mx / 20; e.value = POL.cmd[p[1]]; if (v) v.textContent = POL.cmd[p[1]].toFixed(2);
    });
  }
  S.setCmd = function (vx, vy, wz) {
    var c = [vx, vy, wz]; for (var i = 0; i < 3; i++) { var x = +c[i]; c[i] = isFinite(x) ? Math.max(-POL.cmdMax[i], Math.min(POL.cmdMax[i], x)) : 0; }
    POL.cmd = c; updateCmdUI();
  };
  S.cmdUI = function () { S.setCmd($('mjCvx').value, $('mjCvy').value, $('mjCwz').value); };
  document.addEventListener('keydown', function (e) {
    if (!POL.on || POL.ref || e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target, tn = t && t.tagName; if (tn === 'TEXTAREA' || tn === 'SELECT' || (tn === 'INPUT' && !/^(range|checkbox|button|file)$/.test(t.type))) return;
    var k = String(e.key).toLowerCase(), c = POL.cmd.slice(), M = POL.cmdMax, hit = true;   // +x forward, +y left, +wz counter-clockwise (REP-103)
    if (k === 'w') c[0] = M[0]; else if (k === 's') c[0] = -M[0]; else if (k === 'a') c[1] = M[1]; else if (k === 'd') c[1] = -M[1];
    else if (k === 'q') c[2] = M[2]; else if (k === 'e') c[2] = -M[2]; else if (k === ' ' || k === 'x') c = [0, 0, 0]; else hit = false;
    if (hit) { e.preventDefault(); S.setCmd(c[0], c[1], c[2]); }
  });

  // ---- simulation ----
  function stepPhys(n) {   // n physics steps; a push (6 N) is applied for the first `push.left` of them
    var d = S.d, f = d.xfrc_applied, b = S.bid.base_link, mj = S.mj, m = S.m;
    for (var i = 0; i < n; i++) {
      if (push.left > 0) { f[6 * b] = push.f[0]; f[6 * b + 1] = push.f[1]; push.left--; if (push.left === 0) { f[6 * b] = 0; f[6 * b + 1] = 0; } }
      mj.mj_step(m, d);
    }
  }
  S.push = function () { var a = Math.random() * 2 * Math.PI; push.f = [UNI.push * Math.cos(a), UNI.push * Math.sin(a)]; push.left = UNI.decim; };
  S.reset = function () {   // same reset as rl/alpha2_env.py without randomisation
    if (!S.ready) return;
    var mj = S.mj, m = S.m, d = S.d, qp = d.qpos, k; mj.mj_resetData(m, d); push.left = 0;
    var useRef = POL.on && POL.sess && POL.ref, q00 = useRef ? POL.ref.q[0] : UNI.q0; POL.k = 0; POL.acc = 0;
    qp[0] = 0; qp[1] = 0; qp[2] = UNI.z0; qp[3] = 1; qp[4] = 0; qp[5] = 0; qp[6] = 0;
    for (k = 0; k < 20; k++) { qp[S.qadr[k]] = q00[k]; d.ctrl[S.act[k]] = q00[k]; POL.prev[k] = 0; }
    if (useRef) {
      qp[2] = POL.ref.getup ? 0.10 : 0.2221;   // reference walk starts from the q_init stance; get-up lies on the floor
      if (POL.ref.getup) {   // lie on the back ('back', face up) or the front ('front', face down), settle 1 s holding the first reference pose
        var h = Math.SQRT1_2, gq = POL.ref.getup === 'front' ? [h, 0, h, 0] : [h, 0, -h, 0]; for (k = 0; k < 4; k++) qp[3 + k] = gq[k];
        mj.mj_forward(m, d); for (var sn = 0; sn < 500; sn++) { for (k = 0; k < 20; k++) d.ctrl[S.act[k]] = q00[k]; mj.mj_step(m, d); }   // 500 x 2 ms = 1 s
      }
    }
    mj.mj_forward(m, d); S.simT = 0; draw();
  };
  S.play = function (on) {
    if (on && !POL.sess) { stat(T('p_none'), true); return; }
    POL.on = !!on; S.reset(); if (!on) { var d = S.d; if (d) for (var k = 0; k < 20; k++) d.ctrl[S.act[k]] = UNI.q0[k]; }
    polBtn();
  };
  function polBtn() { var b = $('polBtn'); if (!b) return; b.textContent = POL.on ? T('p_stop') : T('p_play'); b.title = POL.on ? T('p_stop_t') : T('p_play_t'); b.disabled = !POL.sess; }
  // reference joint target at control step kk: time kk*0.1 s, linearly interpolated from the 50 Hz reference, loop window [a,b) repeats (get-up: last pose held)
  function refAt(Rf, kk) {
    var dt = Rf.dt || 0.02, n = Rf.q.length, x = kk * UNI.cdt / dt, lp = Rf.getup ? null : Rf.loop;
    if (lp && x >= lp[1]) x = lp[0] + (x - lp[0]) % (lp[1] - lp[0]);
    x = Math.min(Math.max(x, 0), n - 1); var i = Math.floor(x), j = Math.min(i + 1, n - 1), f = x - i, A = Rf.q[i], B = Rf.q[j], r = new Array(20);
    for (var k = 0; k < 20; k++) r[k] = A[k] * (1 - f) + B[k] * f;
    return r;
  }
  async function polControlU() {   // one 0.1 s control step: obs(68) -> ONNX -> ctrl = target + delta -> 50 physics steps
    var m = S.m, d = S.d, b = S.bid.base_link, qp = d.qpos, xm = d.xmat, o = new Float32Array(UNI.nobs), Rf = POL.ref, kk = POL.k, tgt = UNI.q0, k, Q0 = UNI.q0;
    for (k = 0; k < 20; k++) { o[k] = qp[S.qadr[k]] - Q0[k]; o[20 + k] = POL.prev[k]; }
    o[40] = -xm[9 * b + 6]; o[41] = -xm[9 * b + 7]; o[42] = -xm[9 * b + 8];   // gravity direction in the base frame (R^T * [0,0,-1])
    o[43] = POL.cmd[0]; o[44] = POL.cmd[1]; o[45] = POL.cmd[2];
    if (Rf) {
      tgt = refAt(Rf, kk);
      if (Rf.getup) { var Tn = Math.ceil((Rf.q.length - 1) * (Rf.dt || 0.02) / UNI.cdt) + 1; o[46] = Math.min(kk / Tn, 1); o[47] = kk >= Tn ? 1 : 0; }
      else { var lp = Rf.loop, x = kk * UNI.cdt / (Rf.dt || 0.02); if (x >= lp[0]) { var ph = 2 * Math.PI * (x - lp[0]) / (lp[1] - lp[0]); o[46] = Math.sin(ph); o[47] = Math.cos(ph); } }
    } else { var p0 = 2 * Math.PI * (kk * UNI.cdt) / UNI.gait; o[46] = Math.sin(p0); o[47] = Math.cos(p0); }   // free-running clock (stand / velocity walk)
    for (k = 0; k < 20; k++) o[48 + k] = tgt[k] - Q0[k];
    var out = await POL.sess.run({ obs: new window.ort.Tensor('float32', o, [1, UNI.nobs]) }), a = out.action.data, dl = out.delta.data;
    POL.obs = o; POL.act = Array.prototype.slice.call(a);
    var cr = m.actuator_ctrlrange, ct = d.ctrl;
    for (k = 0; k < 20; k++) { var i = S.act[k]; POL.prev[k] = Math.max(-1, Math.min(1, a[k])); ct[i] = Math.min(cr[2 * i + 1], Math.max(cr[2 * i], tgt[k] + dl[k])); }
    stepPhys(UNI.decim); S.simT += UNI.cdt; POL.k++;
  }
  S.polControl = polControlU;
  async function advance(dt) {
    if (POL.on && POL.sess) {
      POL.acc = Math.min(POL.acc + dt, 3 * UNI.cdt); var n = 0;
      while (POL.acc >= UNI.cdt && n < 3) { POL.acc -= UNI.cdt; n++; await polControlU(); }
    } else {   // no policy: the servos hold the zero pose
      POL.acc = Math.min(POL.acc + dt, 0.1); var ns = Math.min(Math.floor(POL.acc / S.ts), 100); POL.acc -= ns * S.ts; if (ns) { stepPhys(ns); S.simT += ns * S.ts; }
    }
  }

  // ---- drawing: three.js, geoms straight from the MuJoCo model ----
  var R = { renderer: null, scene: null, camera: null, controls: null, root: null, meshes: [], links: {}, hull: {}, loadMsg: '', busy: false, last: 0 };
  function initView() {
    var cv = $('view'); if (!cv || !window.THREE) return false;
    var r = R.renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true }); r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    R.scene = new THREE.Scene(); R.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 50); R.camera.position.set(0.55, 0.35, 0.75);
    R.scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 0.9)); var dl = new THREE.DirectionalLight(0xffffff, 0.8); dl.position.set(1, 2, 1.5); R.scene.add(dl);
    var grid = new THREE.GridHelper(4, 40, 0x7a7a90, 0x9a9ab0); grid.material.opacity = 0.35; grid.material.transparent = true; R.scene.add(grid);
    R.root = new THREE.Group(); R.root.rotation.x = -Math.PI / 2; R.scene.add(R.root);   // MuJoCo z-up / x-forward -> three y-up
    if (THREE.OrbitControls) { R.controls = new THREE.OrbitControls(R.camera, cv); R.controls.target.set(0, 0.12, 0); R.controls.update(); }
    window.addEventListener('resize', resize); resize(); return true;
  }
  function resize() { var cv = $('view'); if (!cv || !R.renderer) return; var w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return; R.renderer.setSize(w, h, false); R.camera.aspect = w / h; R.camera.updateProjectionMatrix(); }
  // The robot is drawn with the real visual meshes (../meshes/visual/<link>.obj, ~45 MB, the head is 21 MB), exactly like ubx-player.html: one group per link, posed by its MuJoCo body.
  // Until a link's OBJ has arrived its MuJoCo collision hulls are shown as a placeholder.
  var skinMat = null;
  function loadVisuals() {
    if (!window.THREE || !THREE.OBJLoader) { R.loadMsg = 'OBJLoader missing'; return; }
    skinMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 });   // the OBJs carry vertex colours
    var kb = FK.meshKB || {}, todo = FK.links.slice().sort(function (a, b) { return (kb[a] || 0) - (kb[b] || 0); }), n = todo.length, done = 0, fails = 0;
    FK.links.forEach(function (ln) { var g = new THREE.Group(); g.matrixAutoUpdate = true; R.root.add(g); R.links[ln] = g; });
    (async function () {
      for (var i = 0; i < todo.length; i++) {
        var ln = todo[i]; R.loadMsg = 'mesh ' + done + '/' + n + ' (' + ln + ')';
        try {
          var r = await fetch(new URL('../meshes/visual/' + ln + '.obj', BASE).href); if (!r.ok) throw new Error('HTTP ' + r.status);
          var t = (await r.text()).replace(/^mtllib.*$/gm, '').replace(/^usemtl.*$/gm, ''), o = new THREE.OBJLoader().parse(t);
          o.traverse(function (c) { if (c.isMesh) c.material = skinMat; });
          R.links[ln].add(o); (R.hull[S.bid[ln]] || []).forEach(function (h) { h.visible = false; });   // the real mesh replaces the placeholder hulls
        } catch (e) { fails++; window.log('mesh ' + ln + ': ' + (e && e.message || e)); }
        done++;
        await new Promise(function (res) { setTimeout(res, 0); });   // let the sim / UI breathe between the big files
      }
      R.loadMsg = fails ? 'mesh: ' + fails + ' failed (placeholder hulls)' : '';
    })();
  }
  function buildMeshes() {
    var m = S.m, mat = new THREE.MeshStandardMaterial({ color: 0xc9c9d6, roughness: 0.6, metalness: 0.05, flatShading: true }), v = m.mesh_vert, f = m.mesh_face;
    for (var g = 0; g < m.ngeom; g++) {
      if (m.geom_type[g] !== 7) continue;   // mjGEOM_MESH (the ground plane is the grid)
      var id = m.geom_dataid[g], va = m.mesh_vertadr[id], vn = m.mesh_vertnum[id], fa = m.mesh_faceadr[id], fn = m.mesh_facenum[id];
      var pos = new Float32Array(3 * vn), idx = new Uint32Array(3 * fn), i;
      for (i = 0; i < 3 * vn; i++) pos[i] = v[3 * va + i];
      for (i = 0; i < 3 * fn; i++) idx[i] = f[3 * fa + i];
      var geo = new THREE.BufferGeometry(); (geo.setAttribute || geo.addAttribute).call(geo, 'position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeVertexNormals();
      var mesh = new THREE.Mesh(geo, mat); mesh.matrixAutoUpdate = false; R.root.add(mesh); R.meshes.push({ g: g, mesh: mesh }); (R.hull[m.geom_bodyid[g]] = R.hull[m.geom_bodyid[g]] || []).push(mesh);
    }
  }
  function draw() {
    if (!S.ready || !R.renderer) return;
    if (!R.meshes.length) { buildMeshes(); loadVisuals(); }
    var d = S.d, xp = d.geom_xpos, xm = d.geom_xmat, i;
    FK.links.forEach(function (ln) {   // visual meshes: link group = MuJoCo body pose (world, z-up; R.root turns it y-up)
      var g = R.links[ln], b = S.bid[ln], bp = d.xpos, bq = d.xquat; if (!g) return;
      g.position.set(bp[3 * b], bp[3 * b + 1], bp[3 * b + 2]); g.quaternion.set(bq[4 * b + 1], bq[4 * b + 2], bq[4 * b + 3], bq[4 * b]);
    });
    for (i = 0; i < R.meshes.length; i++) {
      if (!R.meshes[i].mesh.visible) continue;
      var g = R.meshes[i].g, a = 9 * g, p = 3 * g;
      R.meshes[i].mesh.matrix.set(xm[a], xm[a + 1], xm[a + 2], xp[p], xm[a + 3], xm[a + 4], xm[a + 5], xp[p + 1], xm[a + 6], xm[a + 7], xm[a + 8], xp[p + 2], 0, 0, 0, 1);
      R.meshes[i].mesh.matrixWorldNeedsUpdate = true;
    }
    var b = S.bid.base_link, bx = d.xpos[3 * b], by = d.xpos[3 * b + 1];   // the camera follows the robot on the floor plane
    if (R.controls) { var t = R.controls.target, nx = bx, nz = -by, dx = nx - t.x, dz = nz - t.z; t.x += dx * 0.15; t.z += dz * 0.15; R.camera.position.x += dx * 0.15; R.camera.position.z += dz * 0.15; R.controls.update(); }
    R.renderer.render(R.scene, R.camera);
    var now = performance.now(); if (now - statT > 100) { statT = now; status(); }
  }
  function status() {
    var e = $('mjstat'); if (!e || !POL.sess && !S.ready) return;
    var d = S.d, b = S.bid.base_link, q = d.xquat, z = d.xpos[3 * b + 2], zz = 1 - 2 * (q[4 * b + 1] * q[4 * b + 1] + q[4 * b + 2] * q[4 * b + 2]), tilt = Math.acos(Math.max(-1, Math.min(1, zz))) * 180 / Math.PI, fallen = z < 0.15 || tilt > 40;
    var fr = S.m.actuator_forcerange, af = d.actuator_force, sat = 0; for (var i = 0; i < 20; i++) if (Math.abs(af[i]) >= 0.98 * fr[2 * i + 1]) sat++;
    e.textContent = (R.loadMsg ? R.loadMsg + ' · ' : '') + (POL.sess ? POL.file + ' · ' : '') + 't ' + S.simT.toFixed(1) + 's · z ' + (z * 100).toFixed(1) + 'cm · ' + tilt.toFixed(0) + '° · sat ' + sat + (fallen ? ' · ⚠ ' + T('mj_fallen') : '');
    e.style.color = fallen ? 'var(--warn)' : '';
  }
  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min((now - R.last) / 1000, 0.1); R.last = now;
    if (!S.ready || R.busy) return;
    R.busy = true;
    advance(dt).then(draw, function (e) { POL.on = false; polBtn(); stat(T('mj_fail') + (e && e.message || e), true); }).then(function () { R.busy = false; });
  }
  async function boot() {
    applyLang(); updateCmdUI();
    if (location.protocol === 'file:') { stat(T('p_http'), true); return; }
    if (!initView()) { stat('three.js missing', true); return; }
    try { stat(T('mj_loading')); await S.load(); S.reset(); stat(T('p_none')); } catch (e) { stat(T('mj_fail') + (e && e.message || e), true); return; }
    R.last = performance.now(); requestAnimationFrame(frame);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else if (document.readyState) boot();
})();
