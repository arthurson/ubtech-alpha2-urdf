// Node check: the vendored MuJoCo WASM reproduces the Python stand test on mujoco/alpha2.xml.
//   node mujoco/test_wasm.mjs        (Node >= 18; no npm install needed, WASM + glue are in web/vendor/mujoco/)
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)), PKG = path.dirname(HERE);
const { default: loadMujoco } = await import(path.join(PKG, 'web/vendor/mujoco/mujoco.js'));
const mj = await loadMujoco();
const m = mj.MjModel.from_xml_string(fs.readFileSync(path.join(HERE, 'alpha2.xml'), 'utf8')), d = new mj.MjData(m);
const qinit = {};   // default stance from config/servo_map.yaml
for (const l of fs.readFileSync(path.join(PKG, 'config/servo_map.yaml'), 'utf8').split('\n')) {
  const k = /joint: (\w+).*?q_init_deg: (-?[\d.]+)/.exec(l); if (k) qinit[k[1]] = +k[2] * Math.PI / 180;
}
d.qpos.set([0, 0, 0.2206 + 0.0015, 1, 0, 0, 0]);
for (const [n, v] of Object.entries(qinit)) {
  d.qpos[m.jnt_qposadr[mj.mj_name2id(m, mj.mjtObj.mjOBJ_JOINT.value, n)]] = v;
  d.ctrl[mj.mj_name2id(m, mj.mjtObj.mjOBJ_ACTUATOR.value, 'act_' + n)] = v;
}
let mass = 0; for (let i = 0; i < m.nbody; i++) mass += m.body_mass[i];
const N = Math.round(5 / m.opt.timestep), t0 = performance.now();
for (let k = 0; k < N; k++) mj.mj_step(m, d);
const ms = performance.now() - t0, zz = 1 - 2 * (d.xquat[5] ** 2 + d.xquat[6] ** 2);   // xquat of body 1 = wxyz at [4..7]
console.log(`MuJoCo WASM | total mass ${mass.toFixed(3)} kg | after 5 s: base z ${d.qpos[2].toFixed(4)} m, tilt ${(Math.acos(zz) * 180 / Math.PI).toFixed(2)} deg | ${N} steps in ${ms.toFixed(0)} ms (${(N / ms * 1000 / 500).toFixed(1)}x realtime)`);
