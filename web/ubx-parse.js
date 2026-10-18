// ubx-parse.js — .ubx → 官方 Alpha2Services 1.1.7.3 播放序（同真機播放器一致）
// 由反編譯原文移植（com.ubtechinc.util.f.*／d.*／e.a／a.d/m/h/p）：
//   ① track（d.b）＝ id＋位姿參考表（d.f）＋流程葉（d.d）＋複幀（d.a）
//   ② 流程：由 id==0 track 嘅入口葉 (a=-1,b=0) 開始跟鏈；每個節點用「block 內置 f 表」
//      row[a==leaf.d] 嘅 d 值做 gate（0/3 播、1 特別、2 跳過、其餘死路）
//   ③ f==0＝servo block（a.h 視窗幀）；f==1＝跳去 track id==block.g 嘅入口；
//      f==2 subtype2＝Loop block（f/g/h 計數，(track,block) 快取）；f==4＝TTS/辨識
//   ④ 節點完成後跟 (a==block.e, b==outIdx) 搵同 track 下一批葉（servo outIdx=2）
//   ⑤ 葉 c==-2：track id==0 → 全劇完；否則跳去「有 block.g==當前 track id」嘅 track，
//      由 marker（該 block 內置表 row[d==2] 嘅 a 值）續播
//   ⑥ timebase＝static（每個 servo block parse 時覆寫；即 per-block 首個 type-0）
// Output: {frames:[{t, move, a:[20]}], voice:[{t, bound, music}], durationMs, tracks, tracksData}
(function (root) {
  function le32(dv, p) { return dv.getInt32(p, true); }
  function fail(m) { throw new Error("ubx: " + m); }
  function voiceMusic(u8) {
    if (u8.length <= 8) return null;
    var s;
    try { s = new TextDecoder("gbk").decode(u8.subarray(8)).trim(); }
    catch (e) {
      var t = "";
      for (var i = 8; i < u8.length; i++) { var c = u8[i]; if (c >= 32 && c < 127) t += String.fromCharCode(c); }
      s = t.trim();
    }
    if (!s) return null;
    var k = Math.max(s.lastIndexOf("\\"), s.lastIndexOf("/"));
    var base = (k >= 0 ? s.substring(k + 1) : s).trim();
    return base || null;
  }
  // 位姿參考／block 內置表一行：pp 指住 echo。class com.ubtechinc.util.d.e
  function parseRow(dv, pp) {
    var a = le32(dv, pp + 4), b = dv.getUint8(pp + 8), c = le32(dv, pp + 9), d = le32(dv, pp + 13);
    var f = le32(dv, pp + 17);
    var gOff = pp + 21 + f;
    var name = "";
    for (var i = 0; i < 20; i++) { var v = dv.getUint16(gOff + 1 + i * 2, true); if (v) name += String.fromCharCode(v); }
    return { a: a, b: b, c: c, d: d, f: f, g: dv.getUint8(gOff), name: name.trim() };
  }
  // Loop block（f==2 subtype2）資料：照 com.ubtechinc.util.e.a.setRawData 原文（含 iB 重用怪癖）
  function parseLoopBlob(dv) {
    if (dv.byteLength < 12 || le32(dv, 0) !== dv.byteLength) return null;
    if (le32(dv, 4) !== 2) return null;
    var iB = le32(dv, 8);
    var i2 = 12, f = 0, g = 0, h = 0;
    if (iB > 0 && i2 + iB <= dv.byteLength) {
      var s1 = "";
      for (var i = 0; i < iB; i++) s1 += String.fromCharCode(dv.getUint8(i2 + i));
      f = parseInt(s1, 10) || 0;
      i2 += iB;
    }
    if (i2 + 4 <= dv.byteLength && le32(dv, i2) > 0) {
      var s2 = "";
      for (var j = 0; j < iB && i2 + 4 + j < dv.byteLength; j++) s2 += String.fromCharCode(dv.getUint8(i2 + 4 + j));
      g = parseInt(s2, 10) || 0;
    }
    var i3 = i2 + 4 + iB;
    if (i3 + 4 <= dv.byteLength) {
      var iB2 = le32(dv, i3);
      if (iB2 > 0) {
        var s3 = "";
        for (var k = 0; k < iB2 && i3 + 4 + k < dv.byteLength; k++) s3 += String.fromCharCode(dv.getUint8(i3 + 4 + k));
        h = parseInt(s3, 10) || 0;
      }
    }
    return { f: f, g: g, h: h };
  }
  // a.h/a.j 容器 → 視窗列（servo：{s,e,a}；voice：{s,e,music}）
  function parseWindows(u8, voice) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.length);
    if (le32(dv, 0) !== u8.length) fail("ablock len");
    var nblk = le32(dv, 4), hp = 8, out = [];
    for (var b = 0; b < nblk; b++) {
      var bl1 = le32(dv, hp); hp += 4;
      var bo = hp;
      if (le32(dv, bo) !== bl1) fail("bblock echo");
      var nfrm = le32(dv, bo + 76), fp = bo + 80;
      for (var i = 0; i < nfrm; i++) {
        var fl1 = le32(dv, fp); fp += 4;
        var fo = fp;
        if (le32(dv, fo) !== fl1) fail("sframe echo");
        var s = le32(dv, fo + 8), e = le32(dv, fo + 12);
        var ffb = le32(dv, fo + 76), epos = fo + 80;
        if (voice) {
          out.push({ s: s, e: e, music: voiceMusic(new Uint8Array(dv.buffer, dv.byteOffset + epos, ffb)) });
        } else {
          var angs = [];
          for (var gi = 0; gi < 20; gi++) {
            var o = epos + gi * 8 + 8;
            angs.push(o < epos + ffb ? dv.getUint8(o) : 0);
          }
          out.push({ s: s, e: e, a: angs });
        }
        fp += fl1;
      }
      hp += bl1;
    }
    return out;
  }
  function parseTracks(bytes) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    var n = bytes.length;
    if (le32(dv, 0) !== n) fail("total mismatch");
    var magic = "";
    for (var i = 4; i < 13; i++) magic += String.fromCharCode(dv.getUint8(i));
    if (magic !== "ubx-alpha") fail("bad magic");
    if (le32(dv, 13) > 2) fail("version>2");
    var eLen = le32(dv, 17), ms = 21;
    if (le32(dv, ms) !== eLen) fail("motion len");
    var count = le32(dv, ms + 4), p = ms + 8, tracks = [];
    for (var ti = 0; ti < count; ti++) {
      var itemLen = le32(dv, p);
      if (le32(dv, p + 4) !== itemLen) fail("track echo");
      var tend = p + 4 + itemLen, q = p + 8;
      var tr = { id: le32(dv, q), leaves: [], blocks: [] }; q += 4;
      var fLen = le32(dv, q); q += 4 + fLen; // 位姿參考表（只喺條件 block 先用，corpus 未用）
      var aLen = le32(dv, q); q += 4;
      if (aLen > 0) {
        var pp = q + 8, cnt = le32(dv, q + 4);
        for (var k = 0; k < cnt; k++) {
          var l1 = le32(dv, pp); pp += 4;
          if (l1 <= 0) continue;
          tr.leaves.push({ a: le32(dv, pp + 4), b: le32(dv, pp + 8), c: le32(dv, pp + 12), d: le32(dv, pp + 16) });
          pp += l1;
        }
        q += aLen;
      }
      var bLen = le32(dv, q); q += 4;
      var bp = q + 8, nda = le32(dv, q + 4);
      for (var di = 0; di < nda; di++) {
        var bl1 = le32(dv, bp); bp += 4;
        if (bl1 <= 0) continue;
        var fp = bp; // echo 位
        var fTabLen = le32(dv, fp + 4);
        var base = fp + 8 + fTabLen;
        var blk = { e: le32(dv, base + 208), f: le32(dv, base + 212), g: le32(dv, base + 216), h: le32(dv, base + 220),
          innerF: [], windows: [], voice: [], tb: 0, loop: null, sub: 0 };
        if (fTabLen > 0) {
          var p2 = fp + 8 + 8, cnt2 = le32(dv, fp + 12);
          for (var k2 = 0; k2 < cnt2; k2++) {
            var l2 = le32(dv, p2); p2 += 4;
            if (l2 <= 0) continue;
            blk.innerF.push(parseRow(dv, p2)); // p2 指住 echo
            p2 += l2;
          }
        }
        if (blk.h > 0) {
          var blob = new DataView(dv.buffer, dv.byteOffset + base + 224, blk.h);
          if (blk.f === 0) {
            var cnt3 = le32(dv, base + 228), cp = base + 232;
            for (var k3 = 0; k3 < cnt3; k3++) {
              var ty = le32(dv, cp), ln = le32(dv, cp + 4);
              if (ln <= 0 || cp + 8 + ln > base + 224 + blk.h) break;
              if (ty === 0 && ln === 8) blk.tb = le32(dv, cp + 8);
              else if (ty === 1) blk.windows = blk.windows.concat(parseWindows(new Uint8Array(dv.buffer, dv.byteOffset + cp + 8, ln), false));
              else if (ty === 4) blk.voice = blk.voice.concat(parseWindows(new Uint8Array(dv.buffer, dv.byteOffset + cp + 8, ln), true));
              cp += 8 + ln;
            }
          } else if (blk.f === 2) {
            blk.sub = le32(dv, base + 228);
            if (blk.sub === 2) blk.loop = parseLoopBlob(blob);
          } else if (blk.f === 4) {
            blk.sub = le32(dv, base + 228);
          }
        }
        tr.blocks.push(blk);
        bp += bl1;
      }
      if (q + bLen !== tend) fail("track slack");
      tracks.push(tr);
      p += 4 + itemLen;
    }
    return tracks;
  }
  // 官方流程模擬 → 幀序（tick 精確：喺 a.h 視窗內按 slot 逐幀）
  function buildOfficial(tracks) {
    var frames = [], voice = [], t = 0, vt = 0, logs = [];
    var T = 50; // static p.f2630a（正常每個 servo block 都有 type-0 覆寫）
    var findTrack = function (id) { for (var i = 0; i < tracks.length; i++) if (tracks[i].id === id) return tracks[i]; return null; };
    var trk0 = findTrack(0);
    if (!trk0) return { frames: frames, voice: voice, durationMs: 0, logs: ["no track 0"] };
    var loopCache = {};
    var queue = [];
    trk0.leaves.forEach(function (l) { if (l.a === -1 && l.b === 0) queue.push({ track: trk0, leaf: l }); });
    var guard = 0;
    while (queue.length && guard++ < 500) {
      var cur = queue.shift(), track = cur.track, leaf = cur.leaf;
      if (leaf.c === -2) {
        if (track.id === 0) { logs.push("STOP(-2 id0)"); break; }
        var nt = null, nb = null;
        for (var i = 0; i < tracks.length; i++)
          for (var j = 0; j < tracks[i].blocks.length; j++)
            if (tracks[i].blocks[j].g === track.id) { nt = tracks[i]; nb = tracks[i].blocks[j]; break; }
        if (!nt) { logs.push("DEAD(-2 no next track)"); break; }
        var r2 = null;
        for (var m = 0; m < nb.innerF.length; m++) if (nb.innerF[m].d === 2) { r2 = nb.innerF[m]; break; }
        var av = r2 ? r2.a : -1;
        queue = nt.leaves.filter(function (l) { return l.a === nb.e && l.b === av; })
          .map(function (l) { return { track: nt, leaf: l }; });
        logs.push("JUMP trk" + nt.id);
        continue;
      }
      var blk = null;
      for (var b2 = 0; b2 < track.blocks.length; b2++) if (track.blocks[b2].e === leaf.c) { blk = track.blocks[b2]; break; }
      if (!blk) { logs.push("DEAD(no block e=" + leaf.c + ")"); continue; }
      var row = null;
      for (var r = 0; r < blk.innerF.length; r++) if (blk.innerF[r].a === leaf.d) { row = blk.innerF[r]; break; }
      var iC = row ? row.d : -1;
      var pushNext = function (oi) {
        track.leaves.forEach(function (l) { if (l.a === blk.e && l.b === oi) queue.push({ track: track, leaf: l }); });
      };
      var findRowD2 = function () { for (var x = 0; x < blk.innerF.length; x++) if (blk.innerF[x].d === 2) return blk.innerF[x]; return null; };
      if (iC === 0 || iC === 3) {
        if (blk.f === 0) {
          if (blk.tb) T = blk.tb;
          // servo：逐幀排（官方 a.h＋m：每幀 slot=(s+e)*T，順序發）
          blk.windows.forEach(function (fr) {
            frames.push({ t: t, move: fr.s * T, a: fr.a });
            t += (fr.s + fr.e) * T;
          });
          blk.voice.forEach(function (vf) {
            voice.push({ t: vt, bound: vf.s * T, music: vf.music });
            vt += (vf.s + vf.e) * T;
          });
          logs.push("PLAY trk" + track.id + " e" + blk.e);
          pushNext(2);
        } else if (blk.f === 1) {
          var nt2 = findTrack(blk.g);
          logs.push("JUMP(f1) trk" + track.id + " →trk" + blk.g);
          if (nt2) nt2.leaves.forEach(function (l) { if (l.a === -1 && l.b === 0) queue.push({ track: nt2, leaf: l }); });
        } else if (blk.f === 2) {
          if (blk.sub === 2 && blk.loop) {
            var key = track.id + ":" + blk.e;
            var st = loopCache[key];
            if (!st) { st = { i: blk.loop.f, g: blk.loop.g, h: blk.loop.h }; loopCache[key] = st; }
            var oi;
            if (st.i >= st.h) { var dr = findRowD2(); oi = dr ? dr.a : -1; }
            else { var rl = null; for (var q2 = 0; q2 < blk.innerF.length; q2++) if (blk.innerF[q2].name === "Loop") { rl = blk.innerF[q2]; break; } oi = rl ? rl.a : -1; st.i += st.g; }
            logs.push("LOOP trk" + track.id + " e" + blk.e + " i=" + st.i + "/" + st.h + " oi=" + oi);
            pushNext(oi);
          } else if (blk.sub === 1) {
            var rt = null; for (var q3 = 0; q3 < blk.innerF.length; q3++) if (blk.innerF[q3].name === "True") { rt = blk.innerF[q3]; break; }
            pushNext(rt ? rt.a : -1);
          } else logs.push("F2sub" + blk.sub + "（唔支持 → 斷）");
        } else if (blk.f === 4) {
          var d4 = findRowD2(); pushNext(d4 ? d4.a : -1);
        } else logs.push("F" + blk.f + "（無 dispatch → 斷）");
      } else if (iC === 1) logs.push("GATE1（中斷分支，corpus 未用）");
      else if (iC === 2) logs.push("SKIP(iC2)");
      else logs.push("DEAD-GATE iC=" + iC + " e=" + blk.e);
    }
    return { frames: frames, voice: voice, durationMs: t, logs: logs };
  }
  function parseUbx(buf) {
    var bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    var tracks = parseTracks(bytes);
    var off = buildOfficial(tracks);
    // per-track 原始（畀 UI 揀單條軌道用；全部＝官方播放序）
    var tracksData = [];
    var rawT = 0, rawVt = 0;
    tracks.forEach(function (tr) {
      var tf = [], tv = [], t2 = 0, v2 = 0;
      tr.blocks.forEach(function (blk) {
        var tb = blk.tb || 50;
        blk.windows.forEach(function (w) {
          tf.push({ t: t2, move: w.s * tb, a: w.a });
          t2 += (w.s + w.e) * tb;
        });
        blk.voice.forEach(function (vf) {
          tv.push({ t: v2, bound: vf.s * tb, music: vf.music });
          v2 += (vf.s + vf.e) * tb;
        });
      });
      tracksData.push({ id: tr.id, frames: tf, voice: tv, durationMs: t2 });
    });
    return { frames: off.frames, voice: off.voice, durationMs: off.durationMs, tracks: tracks.length, tracksData: tracksData };
  }
  var api = { parse: parseUbx };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.UbxParse = api;
})(typeof self !== "undefined" ? self : this);
