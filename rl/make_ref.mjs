// Reference joint trajectory (50 Hz, servo order 1..20, radians) from an official .ubx action, using the web player's own
// parser + playback interpolation (poseAt incl. integer rounding), so training and the web player see the same reference.
//   node rl/make_ref.mjs actions/1508999860568.ubx rl/ref/forward.json 300 490   (optional: loop window [a,b) in 50 Hz steps;
//   frames a..b repeat exactly in the official forward walk, so the walk can continue for as long as wanted)
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const PKG = path.dirname(path.dirname(fileURLToPath(import.meta.url))), [src, dst, la, lb] = process.argv.slice(2);
const ctx = { self: {}, console }; vm.createContext(ctx);
for (const f of ['fk-params.js', 'ubx-parse.js']) vm.runInContext(fs.readFileSync(path.join(PKG, 'web', f), 'utf8'), ctx);
const FK = vm.runInContext('FK', ctx), UbxParse = ctx.self.UbxParse || vm.runInContext('typeof UbxParse!=="undefined"?UbxParse:self.UbxParse', ctx);
const off = {}; Object.values(FK.chains).forEach(c => c.forEach(j => off[j.servo] = j.offset)); Object.entries(FK.handJoints).forEach(([k, h]) => off[+k] = h.offset);
const T = UbxParse.parse(new Uint8Array(fs.readFileSync(path.join(PKG, src))));
const last = new Array(20).fill(120);   // sanitize255 from ubx-player.html
for (const f of T.frames) for (let j = 0; j < 20; j++) { if (f.a[j] === 255) { if (j !== 16 && j !== 17) f.a[j] = last[j]; } else last[j] = f.a[j]; }
function poseAt(ms, st) {   // ubx-player.html poseAt
  const F = T.frames; if (ms < F[st.i].t) st.i = 0; while (st.i + 1 < F.length && F[st.i + 1].t <= ms) st.i++;
  const cur = F[st.i], prev = st.i > 0 ? F[st.i - 1] : cur, k = cur.move > 0 ? Math.min(1, Math.max(0, (ms - cur.t) / cur.move)) : 1;
  const v = (f, j) => { const x = f.a[j]; return (j >= 16 && x === 255) ? 120 : x; };
  return Array.from({ length: 20 }, (_, j) => Math.round(v(prev, j) + (v(cur, j) - v(prev, j)) * k));
}
const st = { i: 0 }, q = [], servo = [], n = Math.floor(T.durationMs / 20) + 1;
for (let i = 0; i < n; i++) { const a = poseAt(i * 20, st); servo.push(a); q.push(a.map((v, j) => +((v + off[j + 1]) * Math.PI / 180).toFixed(6))); }
fs.writeFileSync(path.join(PKG, dst), JSON.stringify({ dt: 0.02, source: src, loop: la ? [+la, +lb] : null, q, servo }));
console.log(`${dst}: ${n} steps (${(n * 0.02).toFixed(1)} s)`);
