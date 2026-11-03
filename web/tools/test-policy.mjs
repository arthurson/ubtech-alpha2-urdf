// Parity test: the unified-policy runtime of web/mj-sim.js (polControlU) must build the same 68-dim observation and the same ctrl as rl/alpha2_env.py.
//   python rl/dump_parity.py /tmp/parity.json && node web/tools/test-policy.mjs /tmp/parity.json
// mj-sim.js is loaded in a vm sandbox with a DOM stub and a mocked physics state / ONNX session (no wasm needed).
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const PKG = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const P = JSON.parse(fs.readFileSync(process.argv[2] || '/tmp/parity.json', 'utf8'));
const el = () => ({ style: {}, setAttribute() {}, addEventListener() {}, classList: { toggle() {} } });
const win = { ort: { Tensor: function (type, data, dims) { this.type = type; this.data = data; this.dims = dims; } } };
const sb = { window: win, document: { currentScript: null, getElementById: () => null, addEventListener() {}, createElement: el, head: { appendChild() {} } }, location: { href: 'http://x/web/ubx-player.html', protocol: 'http:' },
  console, Math, Float32Array, Float64Array, Array, Promise, JSON, URL, Blob: class {}, Uint8Array, isFinite, parseFloat, String, Object, Date,
  I18N: {}, T: (k) => k, applyLang() {}, $: () => null, log() {}, requestAnimationFrame() {}, FK: { links: [] } };
sb.window.MJSIM = undefined; sb.self = sb.window; vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(PKG, 'web', 'mj-sim.js'), 'utf8'), sb, { filename: 'mj-sim.js' });
const S = win.MJSIM, POL = S.pol, UNI = S.UNI; if (!S || !POL) throw new Error('MJSIM not exported');
let n = 0, worstObs = 0, worstCtrl = 0;
for (const [task, T] of Object.entries(P.tasks)) {
  for (const r of T.rows) {
    const qp = new Float64Array(7 + 20); for (let k = 0; k < 20; k++) qp[7 + k] = r.qpos[k];      // free joint (7) + 20 joints
    const xmat = new Float64Array(18); for (let i = 0; i < 9; i++) xmat[9 + i] = r.xmat[i];        // body 1 = base_link
    const ctrl = new Float64Array(20), cr = new Float64Array(40); for (let k = 0; k < 20; k++) { cr[2 * k] = r.lo[k]; cr[2 * k + 1] = r.hi[k]; }
    S.mj = { mj_step() {} }; S.m = { actuator_ctrlrange: cr }; S.d = { qpos: qp, xmat, ctrl, xfrc_applied: new Float64Array(12) };
    S.bid = { base_link: 1 }; S.act = Array.from({ length: 20 }, (_, k) => k); S.qadr = Array.from({ length: 20 }, (_, k) => 7 + k); S.q0 = P.q0;
    POL.sess = { run: async () => ({ action: { data: Float32Array.from(r.action) }, delta: { data: Float32Array.from(r.delta) } }) };
    POL.uni = true; POL.nobs = UNI.nobs; POL.cdt = UNI.cdt; POL.ref = T.ref; POL.k = r.k; POL.cmd = r.cmd; for (let k = 0; k < 20; k++) POL.prev[k] = r.prev[k]; POL.pending = null;
    await S.polControl();
    const o = POL.obs; if (o.length !== 68) throw new Error('obs length ' + o.length);
    let e = 0; for (let i = 0; i < 68; i++) e = Math.max(e, Math.abs(o[i] - r.obs[i]));
    let c = 0; for (let k = 0; k < 20; k++) c = Math.max(c, Math.abs(ctrl[k] - r.ctrl[k]));
    if (e > 2e-6 || c > 2e-6) { console.error(`MISMATCH ${task} k=${r.k}: obs ${e.toExponential(2)} ctrl ${c.toExponential(2)}`); for (let i = 0; i < 68; i++) if (Math.abs(o[i] - r.obs[i]) > 2e-6) console.error('  obs[' + i + '] js', o[i], 'py', r.obs[i]); process.exit(1); }
    worstObs = Math.max(worstObs, e); worstCtrl = Math.max(worstCtrl, c); n++;
  }
  console.log(`${task}: ${T.rows.length} states ok`);
}
console.log(`JS == Python for ${n} states: max |obs| diff ${worstObs.toExponential(2)}, max |ctrl| diff ${worstCtrl.toExponential(2)}`);
