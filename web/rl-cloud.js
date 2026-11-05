// rl-cloud.js - "GitHub 雲端訓練" panel for ubx-player.html (GPL-3.0-only, same as the package).
// Sets the training options in the page, starts .github/workflows/train.yml through the GitHub REST API
// (workflow_dispatch), follows the run, then loads the finished policy from the `policies` branch
// (raw.githubusercontent.com/<repo>/policies/<task>/<name>/{policy.onnx,ref.json,meta.json,curve.json}, listed in policies/index.json)
// into the existing RL-policy loader (MJSIM.loadPolicy). Every named policy is kept; the panel lists, compares and plots them.
// The training itself runs on GitHub Actions (CPU); this page never runs it.
// Token: a fine-grained personal access token for THIS repo only, permission "Actions: Read and write". It is typed in
// the page, kept in memory (or localStorage if "remember" is ticked) and sent only to api.github.com. Never put it in the html.
// Reading status / results of a public repo needs no token (60 API requests per hour per IP without one).
(function () {
  'use strict';
  var API = 'https://api.github.com', LSK = 'rlcloud.v1';
  var PARAMS = [   // keys / ranges must equal _DEF / _LIM in rl/alpha2_env.py (values are clamped there as well)
    { k: 'push_force', def: 6, min: 0, max: 80, step: 0.5 },
    { k: 'push_steps', def: 5, min: 1, max: 25, step: 1 },
    { k: 'push_prob', def: 0.7, min: 0, max: 1, step: 0.05 },
    { k: 'w_tilt', def: 2, min: 0, max: 10, step: 0.5 },
    { k: 'w_pose', def: 0.1, min: 0, max: 2, step: 0.05 },
    { k: 'w_track', def: 1, min: 0, max: 5, step: 0.1 },
    { k: 'w_smooth', def: 0.02, min: 0, max: 1, step: 0.01 },
    { k: 'w_torque', def: 0.002, min: 0, max: 0.05, step: 0.001 },
    { k: 'w_air', def: 0.5, min: 0, max: 3, step: 0.1 },
    { k: 'w_step', def: 0.5, min: 0, max: 3, step: 0.1 },
    { k: 'cmd_vx', def: 0.03, min: 0, max: 0.3, step: 0.01 },
    { k: 'cmd_vy', def: 0.02, min: 0, max: 0.2, step: 0.01 },
    { k: 'cmd_wz', def: 0.3, min: 0, max: 2, step: 0.05 }
  ];
  var TXT = {
    rc_title: ['☁ GitHub 雲端訓練', '☁ GitHub cloud training'],
    rc_intro: ['喺度設定，撳「開始訓練」就叫 GitHub Actions 跑（CPU，最長約 6 小時）。完成後可直接載入到上面嘅 RL policy。',
      'Set the options here, press Start and GitHub Actions does the training (CPU, up to about 6 h). When it is done the policy loads straight into the RL policy box above.'],
    rc_repo: ['Repo', 'Repo'],
    rc_token: ['Token', 'Token'],
    rc_token_t: ['fine-grained token，只揀呢個 repo，權限 Actions: Read and write。只會傳去 api.github.com。',
      'fine-grained token, this repo only, permission Actions: Read and write. Sent to api.github.com only.'],
    rc_remember: ['記住', 'remember'],
    rc_remember_t: ['存入呢個瀏覽器嘅 localStorage（公用電腦唔好剔）', 'Store in this browser\'s localStorage (do not tick on a shared computer)'],
    rc_new_token: ['建立 token ↗', 'Create token ↗'],
    rc_task: ['任務', 'Task'],
    rc_stand: ['站穩抗推', 'Stand / balance'],
    rc_walk: ['步行（速度指令：前後左右＋轉身）', 'Walk (velocity command: forward / back / left / right / turn)'],
    rc_walk_ref: ['步行（模仿官方前行）', 'Walk (imitate official forward walk)'],
    rc_getup_back: ['起身（仰躺・頭向上，官方 BackStand）', 'Get up (on the back, face up; official BackStand)'],
    rc_getup_front: ['起身（趴著・頭向下，官方 FrontStand）', 'Get up (on the front, face down; official FrontStand)'],
    rc_minutes: ['時長（分鐘）', 'Minutes'],
    rc_minutes_t: ['1–340。GitHub 單個 job 最長 6 小時（連安裝同評估），所以 330（5.5 小時）係安全上限。想試流程可以先用 30。', '1-340. A GitHub job is limited to 6 h including setup and evaluation, so 330 (5.5 h) is the safe maximum. Use 30 to just try the flow.'],
    rc_resume: ['接續上次 checkpoint', 'Resume from the last checkpoint'],
    rc_adv: ['進階（唔識可以唔郁）', 'Advanced (leave as is if unsure)'],
    rc_reset: ['還原預設', 'Reset defaults'],
    rc_seed: ['seed', 'seed'],
    p_push_force: ['推力 N', 'Push force N'],
    p_push_force_t: ['隨機推機身嘅力（訓練抗推用）。0＝唔推。', 'Random push on the body during training. 0 = no pushes.'],
    p_push_steps: ['推持續（×0.02 秒）', 'Push length (x 0.02 s)'],
    p_push_steps_t: ['每次推持續幾耐，單位 0.02 秒。1＝20 毫秒；5＝0.1 秒（一個控制步）。', 'How long a push is held, in units of 0.02 s. 1 = 20 ms; 5 = 0.1 s (one control step).'],
    p_push_prob: ['推嘅機率', 'Push probability'],
    p_push_prob_t: ['每 2 秒一次機會，有幾大機率推。', 'Chance of a push at each 2 s slot.'],
    p_w_tilt: ['傾斜懲罰', 'Tilt penalty'],
    p_w_tilt_t: ['越大越努力保持直立。', 'Bigger = tries harder to stay upright.'],
    p_w_pose: ['偏離企姿懲罰（站穩）', 'Pose-deviation penalty (stand)'],
    p_w_pose_t: ['只係「站穩」任務：越大越貼近預設企姿。', '"Stand" only: bigger = stays closer to the default stance.'],
    p_w_track: ['跟隨獎勵（步行）', 'Tracking reward (walk)'],
    p_w_track_t: ['步行任務：越大越貼近速度指令（模仿官方前行：越貼近官方動作）。', 'Walk tasks: bigger = follows the velocity command (reference walk: the official motion) more closely.'],
    p_w_air: ['單腳支撐獎勵', 'Single-support reward'],
    p_w_air_t: ['只係「步行」（速度指令）：有指令時獎勵一隻腳離地，鼓勵真正踏步。', '"Walk" (velocity) only: rewards one foot in the air while a command is active, encouraging real steps.'],
    p_w_step: ['被推踏步獎勵', 'Push-recovery step reward'],
    p_w_step_t: ['站穩（同指令 0 嘅步行）：被推後 1.5 秒內獎勵踏步（一隻腳離地）去穩住；其餘時間罰原地踏步。0＝唔鼓勵踏步。', 'Stand (and walk with a zero command): rewards stepping (one foot in the air) in the 1.5 s after a push to catch the fall; stepping on the spot otherwise is penalised. 0 = no stepping incentive.'],
    p_cmd_vx: ['最大前後速度 m/s', 'Max forward/back speed m/s'],
    p_cmd_vx_t: ['只係「步行」（速度指令）：訓練時 vx 指令範圍 ±，player 嘅 slider 都用呢個範圍。', '"Walk" (velocity) only: training range ± of the vx command; the player sliders use it too.'],
    p_cmd_vy: ['最大左右速度 m/s', 'Max sideways speed m/s'],
    p_cmd_vy_t: ['只係「步行」（速度指令）：vy 指令範圍 ±。', '"Walk" (velocity) only: range ± of the vy command.'],
    p_cmd_wz: ['最大轉身速度 rad/s', 'Max turn rate rad/s'],
    p_cmd_wz_t: ['只係「步行」（速度指令）：wz 指令範圍 ±。', '"Walk" (velocity) only: range ± of the wz command.'],
    p_w_smooth: ['動作平滑懲罰', 'Action-smoothness penalty'],
    p_w_smooth_t: ['越大動作越柔和（少抖動）。', 'Bigger = smoother, less jitter.'],
    p_w_torque: ['扭力懲罰', 'Torque penalty'],
    p_w_torque_t: ['越大越慳力（對舵機較溫和）。', 'Bigger = uses less torque (gentler on the servos).'],
    rc_start: ['▶ 開始訓練', '▶ Start training'],
    rc_stop: ['■ 取消', '■ Cancel run'],
    rc_refresh: ['↻ 狀態', '↻ Status'],
    rc_load: ['⬇ 載入', '⬇ Load'],
    rc_load_t: ['載入揀咗嗰個 policy 到上面嘅 RL policy', 'Load the selected policy into the RL policy box above'],
    rc_name: ['名稱', 'Name'],
    rc_name_t: ['留空＝自動（任務＋時間）。英文、數字、- 同 _，最多 32 字；同任務同名會覆蓋。', 'Empty = automatic (task + time). Letters, digits, - and _, max 32; the same task + name is overwritten.'],
    rc_bad_name: ['名稱只可用英文、數字、- 同 _（最多 32 字），而且唔可以係 legacy', 'Name: letters, digits, - and _ only (max 32), and not "legacy"'],
    rc_list: ['已訓練嘅 policy', 'Trained policies'],
    rc_list_t: ['重新讀取清單', 'Reload the list'],
    rc_empty: ['（未有 policy，先跑一次訓練）', '(no policies yet, run a training first)'],
    rc_pick: ['請先揀一個 policy', 'Pick a policy first'],
    rc_cmp: ['比較／訓練曲線', 'Compare / learning curves'],
    rc_b: ['對比', 'vs'],
    rc_none: ['（無）', '(none)'],
    rc_m_len: ['平均存活步數', 'mean episode length'],
    rc_m_rew: ['平均獎勵', 'mean reward'],
    rc_nocurve: ['呢個 policy 冇訓練曲線（舊版訓練）', 'This policy has no learning curve (older training)'],
    rc_curve_note: ['曲線係訓練期間（加推力、隨機動作）嘅成績，通常低過最後評估。', 'Curve = performance during training (pushes, stochastic actions); usually lower than the final evaluation.'],
    rc_xaxis: ['訓練步數', 'training steps'],
    th_name: ['名稱', 'name'], th_task: ['任務', 'task'], th_min: ['分鐘', 'min'], th_steps: ['步數', 'steps'],
    th_eval: ['評估', 'eval'], th_base: ['基準', 'base'], th_cfg: ['參數（唔同預設）', 'params (non-default)'],
    rc_default: ['預設', 'default'],
    rc_success: ['起身成功率', 'get-up success'],
    rc_show_old: ['顯示舊格式（20 ms）policy', 'Show old-format (20 ms) policies'],
    rc_t_stand: ['站穩', 'Stand'], rc_t_walk: ['步行·速度指令', 'Walk·velocity'], rc_t_walk_ref: ['步行·模仿', 'Walk·reference'], rc_t_getup_back: ['起身·仰躺', 'Get-up·back'], rc_t_getup_front: ['起身·趴著', 'Get-up·front'],
    rc_loop_w: ['loop', 'loop'], rc_gen_w: ['第', 'gen'], rc_fmt_new: ['新格式 100ms', 'new 100ms'], rc_fmt_old: ['舊格式 20ms', 'old 20ms'],
    rc_score: ['評分', 'score'],
    th_score: ['評分', 'score'], th_gen: ['世代', 'gen'], th_push: ['抗推', 'push'], th_tilt: ['傾斜°', 'tilt°'], th_x: ['距離m', 'x m'], th_ok: ['採用', 'kept'],
    rc_loop: ['♻ 自動循環（訓練→評估→調整→再訓練）', '♻ Auto loop (train → evaluate → adjust → train again)'],
    rc_loop_intro: ['每個世代並行訓練幾個候選，用嚴格評估（傾斜、距離、抗推）評分；最好嗰個如果明顯贏過現任 champion 就取代佢，然後自動調整推力／reward 權重再開下一世代，直至達標、冇進步或到上限。任務同 seed 用上面嘅設定。已存在嘅 loop 會由佢嘅狀態繼續（其餘設定唔會改）。',
      'Each generation trains several candidates in parallel and scores them with the strict evaluation (tilt, distance, push survival). The best one replaces the champion only if it is clearly better; the push / reward settings are then adjusted and the next generation starts by itself until the target is reached, nothing improves or the limit is hit. Task and seed come from the settings above. An existing loop continues from its state (other settings are not changed).'],
    rc_loop_id: ['Loop 名稱', 'Loop name'], rc_loop_k: ['候選數／世代', 'Candidates / gen'], rc_loop_min: ['分鐘／候選', 'Minutes / candidate'],
    rc_loop_gens: ['最多世代', 'Max generations'], rc_loop_pat: ['耐性（世代）', 'Patience (gens)'],
    rc_loop_start: ['▶ 開始／繼續循環', '▶ Start / continue loop'], rc_loop_stop: ['■ 停止循環', '■ Stop loop'], rc_loop_refresh: ['↻ 循環狀態', '↻ Loop status'],
    rc_loop_stop_t: ['取消正在運行／排隊嘅 autoloop run（進行中嗰個世代會作廢）', 'Cancels the running / queued autoloop runs (the generation in progress is lost)'],
    rc_bad_loop: ['Loop 名稱只可用英文、數字、- 同 _（最多 20 字）', 'Loop name: letters, digits, - and _ only (max 20)'],
    rc_loop_started: ['已送出 autoloop，等 GitHub 排隊…（頭一個世代會做 baseline 評估，所以較耐）', 'autoloop dispatched, waiting for GitHub to queue it… (the first generation also evaluates the baseline, so it takes longer)'],
    rc_loop_restarting: ['Loop 已停止，用重啟模式繼續（再跑「最多世代」個世代）：', 'The loop was stopped; resuming it in restart mode ("Max generations" more generations): '],
    rc_loop_restart_hint: [' · 撳「開始／繼續循環」會重啟', ' · press Start / continue to restart it'],
    rc_loop_none: ['未有呢個 loop 嘅狀態（未開始，或者第一個世代未完）', 'No state for this loop yet (not started, or the first generation has not finished)'],
    rc_loop_stopped_n: ['已取消 run 數目：', 'Runs cancelled: '],
    rc_loop_running: ['進行中', 'running'], rc_loop_idle: ['未見運行中嘅 run（可能已被取消）', 'no run in progress (maybe cancelled)'],
    rc_loop_gen: ['世代', 'generation'], rc_loop_champ: ['champion', 'champion'], rc_loop_pat_s: ['耐性', 'patience'],
    rc_run: ['查看 run ↗', 'View run ↗'],
    rc_no_repo: ['請輸入 repo（owner/名）', 'Enter the repo as owner/name'],
    rc_no_token: ['要先貼 token 先可以開始訓練（只睇狀態同載入結果就唔使）', 'A token is needed to start training (not needed to just view status or load results)'],
    rc_started: ['已送出，等 GitHub 排隊…', 'Sent, waiting for GitHub to queue it…'],
    rc_queued: ['排隊中', 'queued'],
    rc_running: ['訓練中', 'running'],
    rc_done_ok: ['完成 ✔', 'finished ✔'],
    rc_done_bad: ['結束但失敗／取消：', 'ended without success: '],
    rc_elapsed: ['已用', 'elapsed'],
    rc_no_run: ['未見到新 run，稍後再撳「狀態」', 'No new run yet, press Status again shortly'],
    rc_cancelled: ['已要求取消', 'Cancel requested'],
    rc_loading: ['載入中…', 'Loading…'],
    rc_loaded: ['已載入', 'Loaded'],
    rc_eval: ['評估平均存活', 'eval mean survival'],
    rc_steps: ['步', 'steps'],
    rc_e401: ['Token 無效或已過期', 'Token invalid or expired'],
    rc_e403: ['Token 冇權限：要 Actions: Read and write，同埋揀咗呢個 repo', 'Token lacks permission: needs Actions: Read and write on this repo'],
    rc_e404: ['搵唔到 workflow／repo（repo 名錯，或者 token 冇揀呢個 repo，或者 train.yml 未 push）', 'Workflow/repo not found (wrong repo name, token not scoped to this repo, or train.yml not pushed yet)'],
    rc_e422: ['GitHub 拒絕參數：train.yml 可能仍係舊版（未有 seed／cfg），請先 push 新版', 'GitHub rejected the inputs: train.yml may still be the old version (no seed/cfg), push the new one first'],
    rc_ehttp: ['GitHub 回應錯誤', 'GitHub error']
  };
  function addI18n() { if (typeof I18N === 'undefined') return; Object.keys(TXT).forEach(function (k) { I18N[k] = { zh: TXT[k][0], en: TXT[k][1] }; }); }
  function tt(k) { return typeof T === 'function' ? T(k) : (TXT[k] ? TXT[k][0] : k); }
  function $(id) { return document.getElementById(id); }

  // ---- state (persisted in localStorage when available) ----
  var ST = { repo: '', token: '', remember: false, task: 'walk', name: '', minutes: 330, resume: true, seed: 0, params: {}, runId: 0, t0: 0, task0: 'walk' };
  var TASKS = ['stand', 'walk', 'walk_ref', 'getup_back', 'getup_front'];
  function taskOf(t) { return TASKS.indexOf(t) >= 0 ? t : 'walk'; }
  var LOOP = { id: '', k: 3, min: 330, gens: 10, pat: 3 }, loopTimer = 0, loopChamp = '', IDX = [], CURVES = {}, chartTok = 0, NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/, PATH_RE = /^(stand|walk|walk_ref|getup_back|getup_front)(\/[A-Za-z0-9_-]{1,32})?$/;
  var timer = 0, branchCache = {}, busy = false;
  function lsGet() { try { return JSON.parse(localStorage.getItem(LSK) || '{}'); } catch (e) { return {}; } }
  function lsSet() {
    try {
      var o = { repo: ST.repo, remember: ST.remember, task: ST.task, name: ST.name, loop: LOOP, minutes: ST.minutes, resume: ST.resume, seed: ST.seed, params: ST.params, runId: ST.runId, t0: ST.t0, task0: ST.task0 };
      if (ST.remember) o.token = ST.token;
      localStorage.setItem(LSK, JSON.stringify(o));
    } catch (e) { /* storage unavailable: keep working in memory */ }
  }
  function guessRepo() {
    var m = /^([^.]+)\.github\.io$/.exec(location.hostname);
    if (m) { var p = location.pathname.split('/').filter(Boolean)[0]; if (p) return m[1] + '/' + p; }
    return 'arthurson/ubtech-alpha2-urdf';
  }

  // ---- pure helpers (also used by the tests) ----
  function clampNum(v, lo, hi, d) { v = parseFloat(v); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; }
  function buildInputs(s) {   // -> workflow_dispatch `inputs` (all strings); cfg only carries values that differ from the defaults
    var cfg = {};
    PARAMS.forEach(function (p) {
      var v = s.params && s.params[p.k]; if (v === undefined || v === null || v === '') return;
      v = clampNum(v, p.min, p.max, p.def); if (Math.abs(v - p.def) > 1e-12) cfg[p.k] = v;
    });
    return {
      task: taskOf(s.task),
      minutes: String(Math.round(clampNum(s.minutes, 1, 340, 60))),
      resume: s.resume ? 'true' : 'false',
      seed: String(Math.max(0, Math.round(clampNum(s.seed, 0, 1e9, 0)))),
      cfg: JSON.stringify(cfg),
      name: String(s.name || '').trim()
    };
  }
  function fmtDur(ms) { var s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + 'h ' : '') + m + 'm'; }

  // ---- GitHub API ----
  async function gh(path, opt) {
    opt = opt || {};
    var h = { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (ST.token) h.Authorization = 'Bearer ' + ST.token;
    if (opt.body) h['Content-Type'] = 'application/json';
    var r = await fetch(API + path, { method: opt.method || 'GET', headers: h, body: opt.body ? JSON.stringify(opt.body) : undefined });
    if (r.ok) return r;
    var msg = '', k = r.status === 401 ? 'rc_e401' : r.status === 403 ? 'rc_e403' : r.status === 404 ? 'rc_e404' : r.status === 422 ? 'rc_e422' : null;
    try { var j = await r.json(); msg = j && j.message ? j.message : ''; } catch (e) { /* no body */ }
    var e = new Error((k ? tt(k) : tt('rc_ehttp') + ' ' + r.status) + (msg ? ' (' + msg + ')' : '')); e.status = r.status; throw e;
  }
  async function defaultBranch(repo) {
    if (branchCache[repo]) return branchCache[repo];
    var j = await (await gh('/repos/' + repo)).json(); return (branchCache[repo] = j.default_branch || 'main');
  }

  // ---- UI ----
  function stat(txt, bad) { var s = $('rlcStat'); if (!s) return; s.textContent = txt; s.style.color = bad ? '#c0392b' : ''; }
  function setLink(url) { var a = $('rlcRun'); if (!a) return; if (url) { a.href = url; a.style.display = ''; } else a.style.display = 'none'; }
  function readForm() {
    ST.repo = ($('rlcRepo').value || '').trim(); ST.token = ($('rlcToken').value || '').trim(); ST.remember = $('rlcRem').checked;
    ST.task = $('rlcTask').value; ST.name = ($('rlcName').value || '').trim(); ST.minutes = $('rlcMin').value; ST.resume = $('rlcResume').checked; ST.seed = $('rlcSeed').value;
    PARAMS.forEach(function (p) { ST.params[p.k] = $('rlcP_' + p.k).value; });
  }
  function writeForm() {
    $('rlcRepo').value = ST.repo; $('rlcToken').value = ST.token; $('rlcRem').checked = !!ST.remember;
    $('rlcTask').value = ST.task; $('rlcName').value = ST.name || ''; $('rlcMin').value = ST.minutes; $('rlcResume').checked = !!ST.resume; $('rlcSeed').value = ST.seed;
    PARAMS.forEach(function (p) { var v = ST.params[p.k]; $('rlcP_' + p.k).value = (v === undefined || v === '') ? p.def : v; });
  }
  function build() {
    var mb = $('mjbox'); if (!mb || $('rlcBox')) return false;
    var d = document.createElement('details'); d.id = 'rlcBox';
    d.style.cssText = 'font-size:12px;border:1px dashed #999;border-radius:8px;padding:4px 6px;margin:4px 0';
    var inp = 'style="flex:1;min-width:0;font-size:11px"', row = 'style="display:flex;align-items:center;gap:4px;margin:3px 0"', lab = 'style="flex:none;width:92px"';
    var adv = PARAMS.map(function (p) {
      return '<label ' + row + '><span ' + lab + ' data-i18n="p_' + p.k + '" data-i18n-title="p_' + p.k + '_t"></span><input id="rlcP_' + p.k + '" type="number" min="' + p.min + '" max="' + p.max + '" step="' + p.step + '" ' + inp + '></label>';
    }).join('');
    d.innerHTML =
      '<summary style="cursor:pointer"><b data-i18n="rc_title"></b></summary>' +
      '<div style="margin:3px 0;color:#666" data-i18n="rc_intro"></div>' +
      '<label ' + row + '><span ' + lab + ' data-i18n="rc_repo"></span><input id="rlcRepo" type="text" spellcheck="false" ' + inp + '></label>' +
      '<label ' + row + '><span ' + lab + ' data-i18n="rc_token" data-i18n-title="rc_token_t"></span><input id="rlcToken" type="password" autocomplete="off" spellcheck="false" ' + inp + '></label>' +
      '<div ' + row + '><span ' + lab + '></span><label style="display:flex;align-items:center;gap:3px"><input id="rlcRem" type="checkbox" style="margin:0"><span data-i18n="rc_remember" data-i18n-title="rc_remember_t"></span></label>' +
      '<a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener" style="margin-left:auto" data-i18n="rc_new_token"></a></div>' +
      '<label ' + row + '><span ' + lab + ' data-i18n="rc_task"></span><select id="rlcTask" ' + inp + '><option value="stand" data-i18n="rc_stand"></option><option value="walk" data-i18n="rc_walk"></option><option value="walk_ref" data-i18n="rc_walk_ref"></option><option value="getup_back" data-i18n="rc_getup_back"></option><option value="getup_front" data-i18n="rc_getup_front"></option></select></label>' +
      '<label ' + row + '><span ' + lab + ' data-i18n="rc_name" data-i18n-title="rc_name_t"></span><input id="rlcName" type="text" maxlength="32" spellcheck="false" placeholder="auto" ' + inp + '></label>' +
      '<label ' + row + '><span ' + lab + ' data-i18n="rc_minutes" data-i18n-title="rc_minutes_t"></span><input id="rlcMin" type="number" min="1" max="340" step="1" ' + inp + '></label>' +
      '<label style="display:flex;align-items:center;gap:4px;margin:3px 0"><input id="rlcResume" type="checkbox" style="margin:0"><span data-i18n="rc_resume"></span></label>' +
      '<details style="margin:3px 0"><summary style="cursor:pointer;color:#666" data-i18n="rc_adv"></summary>' + adv +
      '<label ' + row + '><span ' + lab + ' data-i18n="rc_seed"></span><input id="rlcSeed" type="number" min="0" step="1" ' + inp + '></label>' +
      '<button id="rlcReset" style="padding:2px 6px;font-size:11px" data-i18n="rc_reset"></button></details>' +
      '<div style="display:flex;flex-wrap:wrap;gap:4px;margin:4px 0">' +
      '<button id="rlcStart" style="padding:2px 6px;font-size:11px;margin:0" data-i18n="rc_start"></button>' +
      '<button id="rlcStop" style="padding:2px 6px;font-size:11px;margin:0" data-i18n="rc_stop"></button>' +
      '<button id="rlcRefresh" style="padding:2px 6px;font-size:11px;margin:0" data-i18n="rc_refresh"></button></div>' +
      '<div style="display:flex;gap:6px;align-items:baseline"><span id="rlcStat" class="mono" style="flex:1;min-width:0;font-size:11px;white-space:normal;word-break:break-word"></span><a id="rlcRun" href="#" target="_blank" rel="noopener" style="display:none;flex:none" data-i18n="rc_run"></a></div>' +
      '<div style="margin-top:6px"><b data-i18n="rc_list"></b></div>' +
      '<div ' + row + '><select id="rlcSel" style="flex:1;min-width:0;font-size:11px"></select>' +
      '<button id="rlcLoad" style="padding:2px 6px;font-size:11px;margin:0" data-i18n="rc_load" data-i18n-title="rc_load_t"></button>' +
      '<button id="rlcListRef" style="padding:2px 6px;font-size:11px;margin:0" data-i18n-title="rc_list_t">↻</button></div>' +
      '<label style="display:flex;gap:4px;align-items:center;font-size:11px;color:#666;margin:2px 0"><input type="checkbox" id="rlcShowOld"><span data-i18n="rc_show_old"></span></label>' +
      '<details id="rlcCmp" style="margin:3px 0"><summary style="cursor:pointer;color:#666" data-i18n="rc_cmp"></summary>' +
      '<div ' + row + '><span data-i18n="rc_b"></span><select id="rlcSelB" style="flex:1;min-width:0;font-size:11px"></select>' +
      '<select id="rlcMetric" style="font-size:11px"><option value="len" data-i18n="rc_m_len"></option><option value="rew" data-i18n="rc_m_rew"></option></select></div>' +
      '<svg id="rlcChart" viewBox="0 0 300 130" style="width:100%;height:auto;display:block"></svg>' +
      '<div id="rlcCurveMsg" style="font-size:10px;color:#666;margin:2px 0"></div>' +
      '<div style="overflow-x:auto"><table id="rlcTable" style="border-collapse:collapse;font-size:10px;width:100%"></table></div></details>' +
      '<details id="rlcLoop" style="margin:6px 0 2px"><summary style="cursor:pointer"><b data-i18n="rc_loop"></b></summary>' +
      '<div style="margin:3px 0;color:#666;font-size:11px" data-i18n="rc_loop_intro"></div>' +
      '<label ' + row + '><span ' + lab + ' data-i18n="rc_loop_id"></span><input id="rlcLoopId" type="text" maxlength="20" spellcheck="false" ' + inp + '></label>' +
      '<label ' + row + '><span ' + lab + ' data-i18n="rc_loop_k"></span><input id="rlcLoopK" type="number" min="1" max="6" step="1" ' + inp + '></label>' +
      '<label ' + row + '><span ' + lab + ' data-i18n="rc_loop_min"></span><input id="rlcLoopMin" type="number" min="1" max="330" step="1" ' + inp + '></label>' +
      '<label ' + row + '><span ' + lab + ' data-i18n="rc_loop_gens"></span><input id="rlcLoopGens" type="number" min="1" max="100" step="1" ' + inp + '></label>' +
      '<label ' + row + '><span ' + lab + ' data-i18n="rc_loop_pat"></span><input id="rlcLoopPat" type="number" min="1" max="20" step="1" ' + inp + '></label>' +
      '<div style="display:flex;flex-wrap:wrap;gap:4px;margin:4px 0">' +
      '<button id="rlcLoopStart" style="padding:2px 6px;font-size:11px;margin:0" data-i18n="rc_loop_start"></button>' +
      '<button id="rlcLoopStop" style="padding:2px 6px;font-size:11px;margin:0" data-i18n="rc_loop_stop" data-i18n-title="rc_loop_stop_t"></button>' +
      '<button id="rlcLoopRef" style="padding:2px 6px;font-size:11px;margin:0" data-i18n="rc_loop_refresh"></button></div>' +
      '<div id="rlcLoopStat" class="mono" style="font-size:11px;white-space:normal;word-break:break-word"></div>' +
      '<div style="overflow-x:auto"><table id="rlcLoopTable" style="border-collapse:collapse;font-size:10px;width:100%"></table></div></details>';
    mb.insertAdjacentElement('afterend', d);
    return true;
  }
  function wire() {
    $('rlcStart').onclick = start; $('rlcStop').onclick = cancel; $('rlcRefresh').onclick = function () { refresh(true); }; $('rlcLoad').onclick = function () { loadSelected(); }; $('rlcListRef').onclick = function () { refreshList(); };
    var so = $('rlcShowOld'); so.checked = SHOW_OLD; so.addEventListener('change', function () { SHOW_OLD = so.checked; try { localStorage.setItem('rlc_showold', SHOW_OLD ? '1' : '0'); } catch (e) { /* ignore */ } fillSelect($('rlcSel'), false, $('rlcSel').value); fillSelect($('rlcSelB'), true, $('rlcSelB').value); renderTable(); drawChart(); });
    $('rlcSel').addEventListener('change', function () { renderTable(); drawChart(); }); $('rlcSelB').addEventListener('change', drawChart); $('rlcMetric').addEventListener('change', drawChart);
    $('rlcReset').onclick = function (e) { e.preventDefault(); ST.params = {}; ST.seed = 0; writeForm(); lsSet(); };
    $('rlcTask').addEventListener('change', function () {
      var old = ST.task; readForm();
      // a name that starts with the previous task follows the new task (walk-foo -> stand-foo); a name that is only for the old task would be misleading
      if (old && ST.task !== old && ST.name && ST.name.indexOf(old) === 0 && !/^[A-Za-z0-9]/.test(ST.name.slice(old.length) || ' ')) { ST.name = ST.task + ST.name.slice(old.length); $('rlcName').value = ST.name; }
      loopHint(); lsSet();
    });
    $('rlcLoopStart').onclick = loopStart; $('rlcLoopStop').onclick = loopStop; $('rlcLoopRef').onclick = function () { loopRefresh(false); };
    forIds(['rlcLoopId', 'rlcLoopK', 'rlcLoopMin', 'rlcLoopGens', 'rlcLoopPat'], function (el) { el.addEventListener('change', function () { readLoop(); lsSet(); }); });
    forIds(['rlcRepo', 'rlcToken', 'rlcRem', 'rlcTask', 'rlcName', 'rlcMin', 'rlcResume', 'rlcSeed'].concat(PARAMS.map(function (p) { return 'rlcP_' + p.k; })), function (el) {
      el.addEventListener('change', function () { readForm(); lsSet(); });
    });
  }
  function forIds(ids, f) { ids.forEach(function (id) { var el = $(id); if (el) f(el); }); }

  // ---- actions ----
  function needRepo() { readForm(); if (!/^[\w.-]+\/[\w.-]+$/.test(ST.repo)) { stat(tt('rc_no_repo'), true); return false; } return true; }
  async function start() {
    if (busy || !needRepo()) return;
    if (!ST.token) { stat(tt('rc_no_token'), true); return; }
    if (ST.name && (!NAME_RE.test(ST.name) || ST.name === 'legacy')) { stat(tt('rc_bad_name'), true); return; }
    busy = true; setLink('');
    try {
      var ref = await defaultBranch(ST.repo), inputs = buildInputs(ST), t0 = Date.now();
      await gh('/repos/' + ST.repo + '/actions/workflows/train.yml/dispatches', { method: 'POST', body: { ref: ref, inputs: inputs } });
      ST.runId = 0; ST.t0 = t0; ST.task0 = inputs.task; lsSet(); stat(tt('rc_started')); schedule(4000);
    } catch (e) { stat(String(e.message || e), true); } finally { busy = false; }
  }
  async function cancel() {
    if (!needRepo()) return; if (!ST.runId) { stat(tt('rc_no_run'), true); return; }
    try { await gh('/repos/' + ST.repo + '/actions/runs/' + ST.runId + '/cancel', { method: 'POST' }); stat(tt('rc_cancelled')); schedule(5000); }
    catch (e) { stat(String(e.message || e), true); }
  }
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(function () { refresh(false); }, ms); }
  async function refresh(manual) {
    if (!needRepo()) return;
    try {
      var run = null, tracking = !!ST.t0;   // auto-load the policy only when the run finished while we were following it
      if (ST.runId) run = await (await gh('/repos/' + ST.repo + '/actions/runs/' + ST.runId)).json();
      else {
        var l = await (await gh('/repos/' + ST.repo + '/actions/workflows/train.yml/runs?event=workflow_dispatch&per_page=10')).json();
        var runs = (l.workflow_runs || []).filter(function (r) { return !ST.t0 || Date.parse(r.created_at) >= ST.t0 - 120000; });
        run = runs[0] || null;
        if (!run) { if (manual || !ST.t0) stat(tt('rc_no_run')); if (ST.t0 && !manual) schedule(8000); return; }
        ST.runId = run.id; ST.task0 = ST.t0 ? ST.task0 : ST.task; lsSet();
      }
      setLink(run.html_url);
      var el = tt('rc_elapsed') + ' ' + fmtDur(Date.now() - Date.parse(run.run_started_at || run.created_at));
      if (run.status === 'completed') {
        clearTimeout(timer);
        if (run.conclusion === 'success') { stat(tt('rc_done_ok') + ' · ' + el); ST.t0 = 0; lsSet(); if (tracking) { var en = await refreshList(String(run.id), ST.task0); if (en) await loadEntry(en); } }
        else { stat(tt('rc_done_bad') + run.conclusion, true); ST.t0 = 0; lsSet(); }
      } else {
        stat((run.status === 'queued' || run.status === 'waiting' || run.status === 'pending' ? tt('rc_queued') : tt('rc_running')) + ' · ' + el);
        schedule(ST.token ? 20000 : 70000);   // 60 unauthenticated API calls / hour
      }
    } catch (e) { stat(String(e.message || e), true); }
  }
  // ---- policy list (policies/index.json), comparison table, learning curve ----
  var RAW = 'https://raw.githubusercontent.com/';
  function rawBase(path) { return RAW + ST.repo + '/policies/' + path + '/'; }
  async function fetchJson(url) {
    var r = await fetch(url + '?t=' + Date.now());   // the query string bypasses the 5 min cache of raw.githubusercontent.com
    if (r.status === 404) return null; if (!r.ok) throw new Error(tt('rc_ehttp') + ' ' + r.status);
    return r.json();
  }
  function validEntry(e) { return e && typeof e === 'object' && typeof e.path === 'string' && PATH_RE.test(e.path) && TASKS.indexOf(e.task) >= 0; }
  function entryById(id) { for (var i = 0; i < IDX.length; i++) if (IDX[i].path === id) return IDX[i]; return null; }
  function evalTxt(e) { if (typeof e.score === 'number') return tt('rc_score') + ' ' + e.score.toFixed(2); if (typeof e.success === 'number') return tt('rc_success') + ' ' + Math.round(100 * e.success) + '%'; return typeof e.eval_mean_len === 'number' ? Math.round(e.eval_mean_len) + '/' + (e.eval_max_len || '?') : '-'; }
  function cfgTxt(e) { var k = Object.keys(e.cfg || {}); return k.length ? k.map(function (x) { return x + '=' + e.cfg[x]; }).join(', ') : tt('rc_default'); }
  function whenTxt(e) {   // local date + time, e.g. 11-03 18:30
    var d = e.finished_at ? new Date(e.finished_at) : null; if (!d || isNaN(d)) return e.finished_at ? String(e.finished_at).slice(0, 10) : '';
    var p = function (n) { return (n < 10 ? '0' : '') + n; }; return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  // The list shows what the GitHub Actions runs really published (policies/index.json): newest first, grouped by task, one short line each.
  // Old-format policies (obs 43 / 65, 20 ms, from before the unified layout) are hidden unless the checkbox is ticked.
  var SHOW_OLD = false; try { SHOW_OLD = localStorage.getItem('rlc_showold') === '1'; } catch (e) { SHOW_OLD = false; }
  var TASK_ORDER = ['walk', 'stand', 'walk_ref', 'getup_back', 'getup_front'];
  function isNewFmt(e) { return e.obs_dim === 68; }
  function visIdx() { return IDX.filter(function (e) { return SHOW_OLD || isNewFmt(e); }); }
  function label(e) {   // name · result · date time (+ [old] for old-format ones)
    return (e.name || e.path) + ' · ' + evalTxt(e) + ' · ' + whenTxt(e) + (isNewFmt(e) ? '' : ' · ' + tt('rc_fmt_old'));
  }
  function fillSelect(sel, withNone, keep) {
    sel.textContent = '';
    if (withNone) { var o0 = document.createElement('option'); o0.value = ''; o0.textContent = tt('rc_none'); sel.appendChild(o0); }
    var V = visIdx();
    TASK_ORDER.concat(Object.keys(V.reduce(function (m, e) { m[e.task] = 1; return m; }, {})).filter(function (t) { return TASK_ORDER.indexOf(t) < 0; })).forEach(function (t) {
      var L = V.filter(function (e) { return e.task === t; }); if (!L.length) return;
      var g = document.createElement('optgroup'); g.label = tt('rc_t_' + t) + ' (' + L.length + ')';
      L.forEach(function (e) { var o = document.createElement('option'); o.value = e.path; o.textContent = label(e); g.appendChild(o); });
      sel.appendChild(g);
    });
    if (!V.length && !withNone) { var oe = document.createElement('option'); oe.value = ''; oe.textContent = tt('rc_empty'); sel.appendChild(oe); }
    if (keep && entryById(keep) && (SHOW_OLD || isNewFmt(entryById(keep)))) sel.value = keep;
  }
  async function refreshList(runId, task, quiet) {   // -> the entry of that run (or the newest of `task`), selected in the list
    if (!needRepo()) return null;
    try {
      var j = await fetchJson(RAW + ST.repo + '/policies/index.json');
      IDX = j && Array.isArray(j.policies) ? j.policies.filter(validEntry) : [];
      IDX.sort(function (x, y) { return String(y.finished_at || '').localeCompare(String(x.finished_at || '')); });   // newest first
      if (!j) {   // branch from before named policies existed: policies/<task>/{policy.onnx,meta.json}
        for (var t of ['walk', 'stand']) { var m = await fetchJson(RAW + ST.repo + '/policies/' + t + '/meta.json'); if (m) IDX.push({ id: t, path: t, task: t, name: 'latest', eval_mean_len: m.eval_mean_len, eval_max_len: m.eval_max_len, finished_at: m.finished_at, cfg: m.cfg, timesteps: m.timesteps, minutes: m.minutes, run_url: m.run_url }); }
      }
    } catch (e) { if (!quiet) stat(String(e.message || e), true); return null; }
    var keepA = $('rlcSel').value, keepB = $('rlcSelB').value, pick = null;
    if (runId) IDX.forEach(function (e) { if (!pick && String(e.run_id) === String(runId)) pick = e; });
    if (!pick && runId && task) IDX.forEach(function (e) { if (!pick && e.task === task) pick = e; });   // list is newest first
    fillSelect($('rlcSel'), false, pick ? pick.path : keepA); fillSelect($('rlcSelB'), true, keepB);
    renderTable(); drawChart();
    return pick || entryById($('rlcSel').value);
  }
  function renderTable() {
    var t = $('rlcTable'); t.textContent = ''; if (!visIdx().length) return;
    var sel = $('rlcSel').value, heads = ['th_name', 'th_task', 'th_min', 'th_steps', 'th_eval', 'th_score', 'th_base', 'th_cfg'];
    var hr = document.createElement('tr');
    heads.forEach(function (k) { var th = document.createElement('th'); th.textContent = tt(k); th.style.cssText = 'text-align:left;padding:1px 3px;border-bottom:1px solid #999;white-space:nowrap'; hr.appendChild(th); });
    t.appendChild(hr);
    visIdx().forEach(function (e) {
      var tr = document.createElement('tr'); tr.style.cursor = 'pointer'; if (e.path === sel) tr.style.fontWeight = 'bold';
      [e.name || e.path, e.task, e.minutes != null ? e.minutes : '-', e.timesteps != null ? (e.timesteps / 1e6).toFixed(2) + 'M' : '-', typeof e.success === 'number' ? tt('rc_success') + ' ' + Math.round(100 * e.success) + '%' : typeof e.eval_mean_len === 'number' ? Math.round(e.eval_mean_len) + '/' + (e.eval_max_len || '?') : '-', typeof e.score === 'number' ? e.score.toFixed(3) : '-', typeof e.baseline_mean_len === 'number' ? Math.round(e.baseline_mean_len) : '-', cfgTxt(e)].forEach(function (v) {
        var td = document.createElement('td'); td.textContent = String(v); td.style.cssText = 'padding:1px 3px;border-bottom:1px solid rgba(128,128,128,.3)'; tr.appendChild(td);
      });
      tr.onclick = function () { $('rlcSel').value = e.path; renderTable(); drawChart(); };
      t.appendChild(tr);
    });
  }
  async function getCurve(e) {
    if (!e) return null; if (e.path in CURVES) return CURVES[e.path];
    var c = null; try { c = await fetchJson(rawBase(e.path) + 'curve.json'); } catch (x) { c = null; }
    if (!Array.isArray(c) || !c.length) c = null; CURVES[e.path] = c; return c;
  }
  var SVGNS = 'http://www.w3.org/2000/svg';
  function svgEl(name, attrs, text) { var n = document.createElementNS(SVGNS, name); for (var k in attrs) n.setAttribute(k, attrs[k]); if (text !== undefined) n.textContent = text; return n; }
  function drawChart() {
    var svg = $('rlcChart'), msg = $('rlcCurveMsg'), tok = ++chartTok; if (!svg) return;
    var A = entryById($('rlcSel').value), B = entryById($('rlcSelB').value), metric = $('rlcMetric').value === 'rew' ? 'rew' : 'len';
    svg.textContent = ''; msg.textContent = '';
    if (!A) return;
    Promise.all([getCurve(A), getCurve(B)]).then(function (cs) {
      if (tok !== chartTok) return;   // a newer selection was made meanwhile
      var series = [[A, cs[0], '#2e86de'], [B, cs[1], '#e67e22']].filter(function (x) { return x[0] && x[1]; });
      if (!series.length) { msg.textContent = tt('rc_nocurve'); return; }
      var L = 36, R = 6, Tp = 14, Bt = 18, W = 300, H = 130, xmax = 1, ymin = 0, ymax = metric === 'len' ? 0 : -Infinity;
      series.forEach(function (x) { x[1].forEach(function (p) { xmax = Math.max(xmax, p.t); ymax = Math.max(ymax, p[metric]); ymin = Math.min(ymin, p[metric]); }); });
      if (metric === 'len') series.forEach(function (x) { ymax = Math.max(ymax, x[0].eval_max_len || 0); });
      if (!(ymax > ymin)) ymax = ymin + 1;
      var X = function (t) { return L + (W - L - R) * t / xmax; }, Y = function (v) { return H - Bt - (H - Bt - Tp) * (v - ymin) / (ymax - ymin); };
      svg.appendChild(svgEl('line', { x1: L, y1: Y(ymin), x2: W - R, y2: Y(ymin), stroke: '#888', 'stroke-width': 0.6 }));
      svg.appendChild(svgEl('line', { x1: L, y1: Tp, x2: L, y2: Y(ymin), stroke: '#888', 'stroke-width': 0.6 }));
      var fmt = function (v) { return Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10); };
      svg.appendChild(svgEl('text', { x: L - 3, y: Tp + 3, 'text-anchor': 'end', 'font-size': 8, fill: 'currentColor' }, fmt(ymax)));
      svg.appendChild(svgEl('text', { x: L - 3, y: Y(ymin), 'text-anchor': 'end', 'font-size': 8, fill: 'currentColor' }, fmt(ymin)));
      svg.appendChild(svgEl('text', { x: W - R, y: H - 6, 'text-anchor': 'end', 'font-size': 8, fill: 'currentColor' }, (xmax / 1e6).toFixed(2) + 'M ' + tt('rc_xaxis')));
      series.forEach(function (x, i) {
        svg.appendChild(svgEl('polyline', { points: x[1].map(function (p) { return X(p.t).toFixed(1) + ',' + Y(p[metric]).toFixed(1); }).join(' '), fill: 'none', stroke: x[2], 'stroke-width': 1.2 }));
        svg.appendChild(svgEl('text', { x: L + 4 + i * 110, y: 9, 'font-size': 8, fill: x[2] }, (x[0].name || x[0].path) + ' (' + x[0].task + ')'));
      });
      msg.textContent = tt('rc_curve_note');
    });
  }
  async function loadEntry(e) {
    if (!e) { stat(tt('rc_pick'), true); return; }
    var base = rawBase(e.path), bust = '?t=' + Date.now();
    try {
      stat(tt('rc_loading'));
      var pr = await fetch(base + 'policy.onnx' + bust); if (!pr.ok) throw new Error(tt('rc_ehttp') + ' ' + pr.status);
      var files = [new File([await pr.arrayBuffer()], 'policy.onnx')];
      // reference walk / get-up policies need the reference they were trained against; velocity-walk policies (and older 'walk' ones, which were reference walks) try it optionally
      var needRef = e.task === 'walk_ref' || e.task.indexOf('getup') === 0, rr = (needRef || e.task === 'walk') ? await fetch(base + 'ref.json' + bust) : null;
      if (rr && rr.ok) files.push(new File([await rr.text()], 'ref.json')); else if (needRef) throw new Error(tt('rc_ehttp') + ' ' + (rr ? rr.status : '?'));
      files.push(new File([JSON.stringify({ task: e.task, cfg: e.cfg || {} })], 'meta.json'));   // task + cfg (command ranges) for the player
      if (!window.MJSIM) throw new Error('MJSIM not available');
      if (!MJSIM.on) MJSIM.toggle();   // the policy runs in the physics mode
      await MJSIM.loadPolicy(files);
      if (MJSIM.pol && MJSIM.pol.sess) stat(tt('rc_loaded') + ' ' + (e.name || e.path) + ' (' + e.task + ') · ' + (typeof e.score === 'number' || typeof e.success === 'number' ? evalTxt(e) : tt('rc_eval') + ' ' + evalTxt(e) + ' ' + tt('rc_steps')) + (e.finished_at ? ' · ' + e.finished_at : ''));
      if (e.run_url) setLink(e.run_url);
    } catch (x) { stat(String(x.message || x), true); }
  }
  async function loadSelected() { if (!needRepo()) return; var e = entryById($('rlcSel').value); if (!e && !IDX.length) await refreshList(); e = e || entryById($('rlcSel').value); await loadEntry(e); }

  // ---- auto loop (autoloop.yml): start / stop / follow policies/loop/<task>/<id>/state.json ----
  var LOOP_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$/;
  function loopId() { return LOOP.id || taskOf(ST.task) + '-1'; }   // empty = <task>-1, so different tasks never share a loop (same-name runs are serialized by GitHub)
  function loopHint() { var e = $('rlcLoopId'); if (e) e.placeholder = taskOf($('rlcTask') ? $('rlcTask').value : ST.task) + '-1'; }
  function readLoop() { LOOP.id = ($('rlcLoopId').value || '').trim(); LOOP.k = $('rlcLoopK').value; LOOP.min = $('rlcLoopMin').value; LOOP.gens = $('rlcLoopGens').value; LOOP.pat = $('rlcLoopPat').value; }
  function writeLoop() { $('rlcLoopId').value = LOOP.id; $('rlcLoopK').value = LOOP.k; $('rlcLoopMin').value = LOOP.min; $('rlcLoopGens').value = LOOP.gens; $('rlcLoopPat').value = LOOP.pat; }
  function loopStat(txt, bad) { var e = $('rlcLoopStat'); if (!e) return; e.textContent = txt; e.style.color = bad ? '#c0392b' : ''; }
  function loopInputs() {
    return { loop_id: loopId(), task: taskOf(ST.task), candidates: String(Math.round(clampNum(LOOP.k, 1, 6, 3))), minutes: String(Math.round(clampNum(LOOP.min, 1, 330, 330))),
      max_generations: String(Math.round(clampNum(LOOP.gens, 1, 100, 10))), patience: String(Math.round(clampNum(LOOP.pat, 1, 20, 3))), seed: String(Math.max(0, Math.round(clampNum(ST.seed, 0, 1e9, 0)))) };
  }
  async function activeLoopRuns() {   // autoloop runs that are not finished (needs the API; works without a token for a public repo, within the 60 / h limit)
    var l = await (await gh('/repos/' + ST.repo + '/actions/workflows/autoloop.yml/runs?per_page=20')).json();
    return (l.workflow_runs || []).filter(function (r) { return r.status !== 'completed'; });
  }
  async function loopStart() {
    if (busy || !needRepo()) return; readLoop();
    if (!ST.token) { stat(tt('rc_no_token'), true); loopStat(tt('rc_no_token'), true); return; }
    if (!LOOP_RE.test(loopId())) { loopStat(tt('rc_bad_loop'), true); return; }
    busy = true; lsSet();
    try {
      var ref = await defaultBranch(ST.repo);
      var inputs = loopInputs(), st0 = null;
      try { st0 = await fetchJson(RAW + ST.repo + '/policies/loop/' + taskOf(ST.task) + '/' + loopId() + '/state.json'); } catch (e) { st0 = null; }
      if (st0 && st0.stopped) inputs.restart = 'true';   // a stopped loop would otherwise make the whole run fail: resume it instead
      await gh('/repos/' + ST.repo + '/actions/workflows/autoloop.yml/dispatches', { method: 'POST', body: { ref: ref, inputs: inputs } });
      loopStat((inputs.restart ? tt('rc_loop_restarting') + String(st0.reason || '') + ' · ' : '') + tt('rc_loop_started')); clearTimeout(loopTimer); loopTimer = setTimeout(function () { loopRefresh(true); }, 20000);
    } catch (e) { loopStat(String(e.message || e), true); } finally { busy = false; }
  }
  async function loopStop() {
    if (!needRepo()) return; if (!ST.token) { loopStat(tt('rc_no_token'), true); return; }
    try {
      var runs = await activeLoopRuns(), n = 0;
      for (var i = 0; i < runs.length; i++) { try { await gh('/repos/' + ST.repo + '/actions/runs/' + runs[i].id + '/cancel', { method: 'POST' }); n++; } catch (e) { /* already finished */ } }
      clearTimeout(loopTimer); loopStat(tt('rc_loop_stopped_n') + n);
    } catch (e) { loopStat(String(e.message || e), true); }
  }
  function loopRender(st) {
    var c = st.champion, hist = (Array.isArray(st.history) ? st.history : []).slice(-12).reverse();
    var head = tt('rc_loop_gen') + ' ' + st.gen + '/' + st.max_gens + ' · ' + tt('rc_loop_champ') + ' ' + (c ? c.id + ' ' + tt('rc_score') + ' ' + Number(c.score).toFixed(3) : '-') + ' · ' + tt('rc_loop_pat_s') + ' ' + st.patience + '/' + st.patience_max;
    var t = $('rlcLoopTable'); t.textContent = ''; var hr = document.createElement('tr');
    ['th_gen', 'th_name', 'th_score', 'th_push', 'th_tilt', 'th_x', 'th_ok', 'th_cfg'].forEach(function (k) { var th = document.createElement('th'); th.textContent = tt(k); th.style.cssText = 'text-align:left;padding:1px 3px;border-bottom:1px solid #999;white-space:nowrap'; hr.appendChild(th); });
    t.appendChild(hr);
    hist.forEach(function (h) {
      var tr = document.createElement('tr'); if (h.accepted) tr.style.fontWeight = 'bold';
      var f = function (v, d) { return typeof v === 'number' ? v.toFixed(d) : '-'; };
      [h.gen, h.id, h.failed ? 'x' : f(h.score, 3), f(h.push_mean, 2), f(h.tilt_mean, 1), f(h.x_mean, 3), h.accepted ? '✔' : '', Object.keys(h.cfg || {}).map(function (k) { return k + '=' + h.cfg[k]; }).join(' ')].forEach(function (v) {
        var td = document.createElement('td'); td.textContent = String(v); td.style.cssText = 'padding:1px 3px;border-bottom:1px solid rgba(128,128,128,.3)'; tr.appendChild(td);
      });
      t.appendChild(tr);
    });
    return head;
  }
  async function loopRefresh(auto) {
    if (!needRepo()) return; readLoop(); if (!LOOP_RE.test(loopId())) { loopStat(tt('rc_bad_loop'), true); return; }
    try {
      var st = await fetchJson(RAW + ST.repo + '/policies/loop/' + taskOf(ST.task) + '/' + loopId() + '/state.json');
      if (!st || typeof st !== 'object') { loopStat(tt('rc_loop_none')); if (auto) { clearTimeout(loopTimer); loopTimer = setTimeout(function () { loopRefresh(true); }, 90000); } return; }
      var head = loopRender(st), tail = '';
      if (st.stopped) tail = ' · ⏹ ' + String(st.reason || '') + tt('rc_loop_restart_hint');
      else if (ST.token) { var act = await activeLoopRuns(); tail = act.length ? ' · ▶ ' + tt('rc_loop_running') : ' · ⏸ ' + tt('rc_loop_idle'); }
      loopStat(head + tail);
      var cn = st.champion ? st.champion.name : ''; if (cn && cn !== loopChamp) { loopChamp = cn; refreshList(null, null, true); }   // a new champion is also in the policy list above
      clearTimeout(loopTimer); if (!st.stopped) loopTimer = setTimeout(function () { loopRefresh(true); }, 90000);
    } catch (e) { loopStat(String(e.message || e), true); }
  }

  function init() {
    if (!build()) return;
    addI18n(); var s = lsGet();
    ST.repo = s.repo || guessRepo(); ST.remember = !!s.remember; ST.token = s.token || '';
    ST.task = taskOf(s.task); ST.name = s.name || ''; ST.minutes = s.minutes || 330; ST.resume = s.resume !== false; ST.seed = s.seed || 0; ST.params = s.params || {};
    ST.runId = s.runId || 0; ST.t0 = s.t0 || 0; ST.task0 = s.task0 || ST.task;
    if (typeof applyLang === 'function') applyLang();
    // (a saved loop name 'auto1' is the old shared default and is treated as empty = <task>-1)
    if (s.loop && typeof s.loop === 'object') { LOOP.id = s.loop.id === 'auto1' ? '' : String(s.loop.id || ''); LOOP.k = s.loop.k || LOOP.k; LOOP.min = s.loop.min || LOOP.min; LOOP.gens = s.loop.gens || LOOP.gens; LOOP.pat = s.loop.pat || LOOP.pat; }
    writeForm(); writeLoop(); loopHint(); wire(); refreshList(null, null, true);   // the list of already trained policies (public repo: no token needed)
    if (ST.t0 && ST.runId) { $('rlcBox').open = true; refresh(false); }   // a run was in progress when the page was closed
  }
  window.RLCLOUD = { buildInputs: buildInputs, PARAMS: PARAMS, state: ST, start: start, refresh: refresh, refreshList: refreshList, loadEntry: loadEntry, loadSelected: loadSelected, drawChart: drawChart, cancel: cancel, init: init, loopStart: loopStart, loopStop: loopStop, loopRefresh: loopRefresh, loopInputs: loopInputs };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
