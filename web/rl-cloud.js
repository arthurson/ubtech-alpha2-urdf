// rl-cloud.js - "GitHub 雲端訓練" panel for ubx-player.html (GPL-3.0-only, same as the package).
// Sets the training options in the page, starts .github/workflows/train.yml through the GitHub REST API
// (workflow_dispatch), follows the run, then loads the finished policy from the `policies` branch
// (raw.githubusercontent.com/<repo>/policies/<task>/{policy.onnx,ref.json,meta.json}) into the existing RL-policy loader (MJSIM.loadPolicy).
// The training itself runs on GitHub Actions (CPU); this page never runs it.
// Token: a fine-grained personal access token for THIS repo only, permission "Actions: Read and write". It is typed in
// the page, kept in memory (or localStorage if "remember" is ticked) and sent only to api.github.com. Never put it in the html.
// Reading status / results of a public repo needs no token (60 API requests per hour per IP without one).
(function () {
  'use strict';
  var API = 'https://api.github.com', LSK = 'rlcloud.v1';
  var PARAMS = [   // keys / ranges must equal _DEF / _LIM in rl/alpha2_env.py (values are clamped there as well)
    { k: 'push_force', def: 3, min: 0, max: 10, step: 0.5 },
    { k: 'push_prob', def: 0.7, min: 0, max: 1, step: 0.05 },
    { k: 'w_tilt', def: 2, min: 0, max: 10, step: 0.5 },
    { k: 'w_pose', def: 0.1, min: 0, max: 2, step: 0.05 },
    { k: 'w_track', def: 1, min: 0, max: 5, step: 0.1 },
    { k: 'w_smooth', def: 0.02, min: 0, max: 1, step: 0.01 },
    { k: 'w_torque', def: 0.002, min: 0, max: 0.05, step: 0.001 }
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
    rc_walk: ['步行（模仿官方前行）', 'Walk (imitate official forward walk)'],
    rc_minutes: ['時長（分鐘）', 'Minutes'],
    rc_minutes_t: ['1–340。第一次試跑建議 30–60；之後用「接續」累積。', '1-340. Try 30-60 first; then keep going with Resume.'],
    rc_resume: ['接續上次 checkpoint', 'Resume from the last checkpoint'],
    rc_adv: ['進階（唔識可以唔郁）', 'Advanced (leave as is if unsure)'],
    rc_reset: ['還原預設', 'Reset defaults'],
    rc_seed: ['seed', 'seed'],
    p_push_force: ['推力 N', 'Push force N'],
    p_push_force_t: ['隨機推機身嘅力（訓練抗推用）。0＝唔推。', 'Random push on the body during training. 0 = no pushes.'],
    p_push_prob: ['推嘅機率', 'Push probability'],
    p_push_prob_t: ['每 2 秒一次機會，有幾大機率推。', 'Chance of a push at each 2 s slot.'],
    p_w_tilt: ['傾斜懲罰', 'Tilt penalty'],
    p_w_tilt_t: ['越大越努力保持直立。', 'Bigger = tries harder to stay upright.'],
    p_w_pose: ['偏離企姿懲罰（站穩）', 'Pose-deviation penalty (stand)'],
    p_w_pose_t: ['只係「站穩」任務：越大越貼近預設企姿。', '"Stand" only: bigger = stays closer to the default stance.'],
    p_w_track: ['跟隨動作獎勵（步行）', 'Reference-tracking reward (walk)'],
    p_w_track_t: ['只係「步行」任務：越大越貼近官方動作。', '"Walk" only: bigger = follows the official motion more closely.'],
    p_w_smooth: ['動作平滑懲罰', 'Action-smoothness penalty'],
    p_w_smooth_t: ['越大動作越柔和（少抖動）。', 'Bigger = smoother, less jitter.'],
    p_w_torque: ['扭力懲罰', 'Torque penalty'],
    p_w_torque_t: ['越大越慳力（對舵機較溫和）。', 'Bigger = uses less torque (gentler on the servos).'],
    rc_start: ['▶ 開始訓練', '▶ Start training'],
    rc_stop: ['■ 取消', '■ Cancel run'],
    rc_refresh: ['↻ 狀態', '↻ Status'],
    rc_load: ['⬇ 載入最新 policy', '⬇ Load latest policy'],
    rc_load_t: ['由 policies branch 攞最新結果，載入上面嘅 RL policy', 'Fetch the latest result from the policies branch into the RL policy box above'],
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
    rc_no_result: ['policies branch 暫時冇呢個任務嘅結果：先跑一次訓練', 'No result for this task on the policies branch yet: run a training first'],
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
  var ST = { repo: '', token: '', remember: false, task: 'walk', minutes: 60, resume: true, seed: 0, params: {}, runId: 0, t0: 0, task0: 'walk' };
  var timer = 0, branchCache = {}, busy = false;
  function lsGet() { try { return JSON.parse(localStorage.getItem(LSK) || '{}'); } catch (e) { return {}; } }
  function lsSet() {
    try {
      var o = { repo: ST.repo, remember: ST.remember, task: ST.task, minutes: ST.minutes, resume: ST.resume, seed: ST.seed, params: ST.params, runId: ST.runId, t0: ST.t0, task0: ST.task0 };
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
      task: s.task === 'stand' ? 'stand' : 'walk',
      minutes: String(Math.round(clampNum(s.minutes, 1, 340, 60))),
      resume: s.resume ? 'true' : 'false',
      seed: String(Math.max(0, Math.round(clampNum(s.seed, 0, 1e9, 0)))),
      cfg: JSON.stringify(cfg)
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
    ST.task = $('rlcTask').value; ST.minutes = $('rlcMin').value; ST.resume = $('rlcResume').checked; ST.seed = $('rlcSeed').value;
    PARAMS.forEach(function (p) { ST.params[p.k] = $('rlcP_' + p.k).value; });
  }
  function writeForm() {
    $('rlcRepo').value = ST.repo; $('rlcToken').value = ST.token; $('rlcRem').checked = !!ST.remember;
    $('rlcTask').value = ST.task; $('rlcMin').value = ST.minutes; $('rlcResume').checked = !!ST.resume; $('rlcSeed').value = ST.seed;
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
      '<label ' + row + '><span ' + lab + ' data-i18n="rc_task"></span><select id="rlcTask" ' + inp + '><option value="stand" data-i18n="rc_stand"></option><option value="walk" data-i18n="rc_walk"></option></select></label>' +
      '<label ' + row + '><span ' + lab + ' data-i18n="rc_minutes" data-i18n-title="rc_minutes_t"></span><input id="rlcMin" type="number" min="1" max="340" step="1" ' + inp + '></label>' +
      '<label style="display:flex;align-items:center;gap:4px;margin:3px 0"><input id="rlcResume" type="checkbox" style="margin:0"><span data-i18n="rc_resume"></span></label>' +
      '<details style="margin:3px 0"><summary style="cursor:pointer;color:#666" data-i18n="rc_adv"></summary>' + adv +
      '<label ' + row + '><span ' + lab + ' data-i18n="rc_seed"></span><input id="rlcSeed" type="number" min="0" step="1" ' + inp + '></label>' +
      '<button id="rlcReset" style="padding:2px 6px;font-size:11px" data-i18n="rc_reset"></button></details>' +
      '<div style="display:flex;flex-wrap:wrap;gap:4px;margin:4px 0">' +
      '<button id="rlcStart" style="padding:2px 6px;font-size:11px;margin:0" data-i18n="rc_start"></button>' +
      '<button id="rlcStop" style="padding:2px 6px;font-size:11px;margin:0" data-i18n="rc_stop"></button>' +
      '<button id="rlcRefresh" style="padding:2px 6px;font-size:11px;margin:0" data-i18n="rc_refresh"></button>' +
      '<button id="rlcLoad" style="padding:2px 6px;font-size:11px;margin:0" data-i18n="rc_load" data-i18n-title="rc_load_t"></button></div>' +
      '<div style="display:flex;gap:6px;align-items:baseline"><span id="rlcStat" class="mono" style="flex:1;min-width:0;font-size:11px;white-space:normal;word-break:break-word"></span><a id="rlcRun" href="#" target="_blank" rel="noopener" style="display:none;flex:none" data-i18n="rc_run"></a></div>';
    mb.insertAdjacentElement('afterend', d);
    return true;
  }
  function wire() {
    $('rlcStart').onclick = start; $('rlcStop').onclick = cancel; $('rlcRefresh').onclick = function () { refresh(true); }; $('rlcLoad').onclick = function () { loadLatest(false); };
    $('rlcReset').onclick = function (e) { e.preventDefault(); ST.params = {}; ST.seed = 0; writeForm(); lsSet(); };
    forIds(['rlcRepo', 'rlcToken', 'rlcRem', 'rlcTask', 'rlcMin', 'rlcResume', 'rlcSeed'].concat(PARAMS.map(function (p) { return 'rlcP_' + p.k; })), function (el) {
      el.addEventListener('change', function () { readForm(); lsSet(); });
    });
  }
  function forIds(ids, f) { ids.forEach(function (id) { var el = $(id); if (el) f(el); }); }

  // ---- actions ----
  function needRepo() { readForm(); if (!/^[\w.-]+\/[\w.-]+$/.test(ST.repo)) { stat(tt('rc_no_repo'), true); return false; } return true; }
  async function start() {
    if (busy || !needRepo()) return;
    if (!ST.token) { stat(tt('rc_no_token'), true); return; }
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
        if (run.conclusion === 'success') { stat(tt('rc_done_ok') + ' · ' + el); ST.t0 = 0; lsSet(); if (tracking) await loadLatest(true); }
        else { stat(tt('rc_done_bad') + run.conclusion, true); ST.t0 = 0; lsSet(); }
      } else {
        stat((run.status === 'queued' || run.status === 'waiting' || run.status === 'pending' ? tt('rc_queued') : tt('rc_running')) + ' · ' + el);
        schedule(ST.token ? 20000 : 70000);   // 60 unauthenticated API calls / hour
      }
    } catch (e) { stat(String(e.message || e), true); }
  }
  async function loadLatest(fromRun) {
    if (!needRepo()) return;
    var task = fromRun === true ? ST.task0 : ST.task;   // after a finished run: the task that run was started with
    var base = 'https://raw.githubusercontent.com/' + ST.repo + '/policies/' + task + '/', bust = '?t=' + Date.now();
    try {
      stat(tt('rc_loading'));
      var mr = await fetch(base + 'meta.json' + bust); if (mr.status === 404) { stat(tt('rc_no_result'), true); return; } if (!mr.ok) throw new Error(tt('rc_ehttp') + ' ' + mr.status);
      var meta = await mr.json();
      var pr = await fetch(base + 'policy.onnx' + bust); if (!pr.ok) throw new Error(tt('rc_ehttp') + ' ' + pr.status);
      var files = [new File([await pr.arrayBuffer()], 'policy.onnx')];
      if (task === 'walk') { var rr = await fetch(base + 'ref.json' + bust); if (!rr.ok) throw new Error(tt('rc_ehttp') + ' ' + rr.status); files.push(new File([await rr.text()], 'ref.json')); }
      if (!window.MJSIM) throw new Error('MJSIM not available');
      if (!MJSIM.on) MJSIM.toggle();   // the policy runs in the physics mode
      await MJSIM.loadPolicy(files);
      var ok = MJSIM.pol && MJSIM.pol.sess;
      if (ok) stat(tt('rc_loaded') + ' ' + task + ' · ' + tt('rc_eval') + ' ' + Math.round(meta.eval_mean_len) + '/' + meta.eval_max_len + ' ' + tt('rc_steps') + (meta.finished_at ? ' · ' + meta.finished_at : ''));
      if (meta.run_url) setLink(meta.run_url);
    } catch (e) { stat(String(e.message || e), true); }
  }

  function init() {
    if (!build()) return;
    addI18n(); var s = lsGet();
    ST.repo = s.repo || guessRepo(); ST.remember = !!s.remember; ST.token = s.token || '';
    ST.task = s.task === 'stand' ? 'stand' : 'walk'; ST.minutes = s.minutes || 60; ST.resume = s.resume !== false; ST.seed = s.seed || 0; ST.params = s.params || {};
    ST.runId = s.runId || 0; ST.t0 = s.t0 || 0; ST.task0 = s.task0 || ST.task;
    if (typeof applyLang === 'function') applyLang();
    writeForm(); wire();
    if (ST.t0 && ST.runId) { $('rlcBox').open = true; refresh(false); }   // a run was in progress when the page was closed
  }
  window.RLCLOUD = { buildInputs: buildInputs, PARAMS: PARAMS, state: ST, start: start, refresh: refresh, loadLatest: loadLatest, cancel: cancel, init: init };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
