// End-to-end check of web/policy-sim.js with the REAL MuJoCo WASM + onnxruntime-web (in node): runs a trained policy.onnx for N control steps and
// compares the joint trajectory with rl/alpha2_env.py (same ONNX via onnxruntime, same model, no randomisation).
//   python rl/e2e_ref.py /path/policy.onnx /tmp/e2e.json && node web/tools/test-policy-e2e.mjs /path/policy.onnx /tmp/e2e.json
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import { createRequire } from 'node:module'; import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const PKG = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const [onnxPath, refPath] = process.argv.slice(2); const E = JSON.parse(fs.readFileSync(refPath, 'utf8'));
const el = () => ({ style: {}, setAttribute() {}, addEventListener() {}, classList: { toggle() {} } });
globalThis.window = globalThis; globalThis.document = { currentScript: null, getElementById: () => null, addEventListener() {}, querySelectorAll: () => [], createElement: el, head: { appendChild() {} } };
globalThis.location = { href: pathToFileURL(path.join(PKG, 'web', 'policy.html')).href, protocol: 'http:' };
const realFetch = globalThis.fetch; globalThis.fetch = async (u) => { u = String(u); if (u.startsWith('file:')) { const b = fs.readFileSync(fileURLToPath(u)); return { ok: true, status: 200, text: async () => b.toString('utf8') }; } return realFetch(u); };
vm.runInThisContext(fs.readFileSync(path.join(PKG, 'web', 'fk-params.js'), 'utf8'));
globalThis.__dynImport = (u) => import(u);   // node: a vm script has no dynamic-import callback, so the page's dynImport is redirected to the harness
vm.runInThisContext(fs.readFileSync(path.join(PKG, 'web', 'policy-sim.js'), 'utf8').replace("(new Function('u', 'return import(u)'))(u)", '__dynImport(u)'));
const ort = require(path.join(PKG, 'web', 'vendor', 'ort', 'ort.wasm.min.js')); ort.env.wasm.wasmPaths = pathToFileURL(path.join(PKG, 'web', 'vendor', 'ort')) + '/'; ort.env.wasm.numThreads = 1; globalThis.ort = ort;
const S = globalThis.MJSIM, POL = S.pol;
await S.load(); S.reset();
POL.sess = await ort.InferenceSession.create(new Uint8Array(fs.readFileSync(onnxPath))); POL.on = true; POL.ref = null; POL.cmd = E.cmd; S.reset();
const m = S.m, d = S.d; let worst = 0;
for (let t = 0; t < E.steps; t++) {
  await S.polControl();
  const q = S.qadr.map((a) => d.qpos[a]); let e = 0; for (let k = 0; k < 20; k++) e = Math.max(e, Math.abs(q[k] - E.q[t][k]));
  worst = Math.max(worst, e); if (t % 10 === 9 || t === 0) console.log(`step ${t + 1}: max |q_js - q_py| = ${e.toExponential(2)}   base z js ${d.qpos[2].toFixed(4)} py ${E.z[t].toFixed(4)}`);
}
console.log('geoms', m.ngeom, 'mesh geoms', Array.from({ length: m.ngeom }, (_, g) => m.geom_type[g]).filter((x) => x === 7).length, 'mesh_vert', m.mesh_vert.length, 'mesh_face', m.mesh_face.length, 'geom_xpos', d.geom_xpos.length, 'geom_xmat', d.geom_xmat.length);
console.log(worst < 0.05 ? `E2E OK (worst joint difference ${worst.toExponential(2)} rad over ${E.steps} control steps)` : `E2E DIFFERENT (worst ${worst})`); process.exit(worst < 0.05 ? 0 : 1);
