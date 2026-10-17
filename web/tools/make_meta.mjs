// make_meta.mjs — 掃 actions/*.ubx：出每招時長＋voice 數 → actions/meta.json
// 用 web/ubx-parse.js（同播放器同一個 parser，唔會兩份邏輯走樣）
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { parse } = require('../ubx-parse.js');

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ADIR = path.join(path.dirname(path.dirname(HERE)), 'actions');
const files = fs.readdirSync(ADIR).filter(f => f.toLowerCase().endsWith('.ubx')).sort();
const meta = {};
for (const f of files) {
  const t = parse(new Uint8Array(fs.readFileSync(path.join(ADIR, f))));
  meta[f] = { ms: t.durationMs, v: t.voice.length };
}
fs.writeFileSync(path.join(ADIR, 'meta.json'), JSON.stringify(meta), 'utf8');
console.log('wrote', path.join(ADIR, 'meta.json'), files.length, 'actions');

// env 行程（官方動作實際用到嘅每舵機 min/max，255 放鬆唔計）
const env = {};
for (let k = 1; k <= 20; k++) env[k] = [255, 0];
for (const f of files) {
  const t = parse(new Uint8Array(fs.readFileSync(path.join(ADIR, f))));
  for (const fr of t.frames) {
    for (let j = 0; j < 20; j++) {
      const v = fr.a[j];
      if (v === 255) continue;
      if (v < env[j + 1][0]) env[j + 1][0] = v;
      if (v > env[j + 1][1]) env[j + 1][1] = v;
    }
  }
}
console.log('env=' + JSON.stringify(env));
