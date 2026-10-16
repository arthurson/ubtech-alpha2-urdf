// ubx-parse.js — minimal .ubx -> trajectory parser for browsers + node.
// Port of scripts/ubx_to_traj.py (parse order; the on-robot player may use
// chain order for multi-track files — same motion data, occasionally
// different segment order; see UbxParser.computePlayOrder).
// Output: {frames:[{t, move, a:[20]}], voice:[{t, bound, music}],
//           durationMs, tracks}
// t = slot start (ms); servo move = travel time; voice bound = song cap.
// voice clock 同 servo clock 各自獨立（同真機 UbxPlayer 一樣，由 0 並行起）。
(function (root) {
  function le32(dv, p) { return dv.getInt32(p, true); }
  function fail(m) { throw new Error("ubx: " + m); }
  function voiceMusic(u8) {
    // e-blob [8B頭][GBK路徑][8B尾]：去頭留尾解歌名（a/o.a 原文）
    if (u8.length <= 8) return null;
    var s;
    try {
      s = new TextDecoder("gbk").decode(u8.subarray(8)).trim();
    } catch (e) {
      var t = "";
      for (var i = 8; i < u8.length; i++) {
        var c = u8[i];
        if (c >= 32 && c < 127) t += String.fromCharCode(c);
      }
      s = t.trim();
    }
    if (!s) return null;
    var k = Math.max(s.lastIndexOf("\\"), s.lastIndexOf("/"));
    var base = (k >= 0 ? s.substring(k + 1) : s).trim();
    return base || null;
  }

  function parseBlist(dv, n, bo) {
    var count = le32(dv, bo + 4), bp = bo + 8, das = [];
    for (var i = 0; i < count; i++) {
      var l1 = le32(dv, bp); bp += 4;
      var fp = bp;
      if (le32(dv, fp) !== l1) fail("aframe echo");
      var fTabLen = le32(dv, fp + 4);
      var base = fp + 8 + fTabLen;
      var fb = le32(dv, base + 4);
      var ff = le32(dv, base + 212);
      var fh = le32(dv, base + 220);
      var ep = base + 224;
      var chain = new Uint8Array(dv.buffer, dv.byteOffset + ep, fh);
      das.push({ f: ff, fh: fh, chain: chain });
      bp += l1;
    }
    return das;
  }

  function parseChain(u8) {
    // u8 = chain bytes starting at its [len]; fh INCLUDES its own len.
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.length);
    var fh = le32(dv, 0);
    if (fh !== u8.length) fail("chain len " + fh + "!=" + u8.length);
    var cnt = le32(dv, 4), pp = 8, out = [];
    for (var i = 0; i < cnt; i++) {
      var ty = le32(dv, pp), ln = le32(dv, pp + 4);
      out.push({ ty: ty, data: new Uint8Array(dv.buffer, dv.byteOffset + pp + 8, ln) });
      pp += 8 + ln;
    }
    if (fh !== u8.length) fail("chain len " + fh + "!=" + u8.length);
    return out;
  }

  function parseTrackh(u8, voice) {
    // a.h container: [echo][count=nblk][a.b block = [L1][echo][a][b][c][d30][count][a.a]*]*
    // servo 幀 e-blob 係角度；voice 幀 e-blob 係歌名（同一布局，s/e 照讀）
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.length);
    if (le32(dv, 0) !== u8.length) fail("ablock len");
    var nblk = le32(dv, 4), hp = 8, frms = [];
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
          var blob = new Uint8Array(dv.buffer, dv.byteOffset + epos, ffb);
          frms.push({ s: s, e: e, music: voiceMusic(blob) });
        } else {
          var angs = [];
          for (var gi = 0; gi < 20; gi++) {
            var o = epos + gi * 8 + 8;
            angs.push(o < epos + ffb ? dv.getUint8(o) : 0);
          }
          frms.push({ s: s, e: e, a: angs });
        }
        fp += fl1;
      }
      hp += bl1;
    }
    return frms;
  }

  function parseUbx(buf) {
    var bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    var n = bytes.length;
    if (le32(dv, 0) !== n) fail("total mismatch");
    var magic = "";
    for (var i = 4; i < 13; i++) magic += String.fromCharCode(dv.getUint8(i));
    if (magic !== "ubx-alpha") fail("bad magic");
    if (le32(dv, 13) > 2) fail("version>2");
    var eLen = le32(dv, 17), ms = 21;
    if (le32(dv, ms) !== eLen) fail("motion len");
    var count = le32(dv, ms + 4), p = ms + 8, rows = [], t = 0;
    var voice = [], vt = 0; // 配樂獨立 clock（同真機並行起線）
    for (var ti = 0; ti < count; ti++) {
      var itemLen = le32(dv, p);
      if (le32(dv, p + 4) !== itemLen) fail("track echo");
      var tend = p + 4 + itemLen, q = p + 8;
      q += 4; // id
      var fLen = le32(dv, q); q += 4 + fLen;
      var aLen = le32(dv, q); q += 4 + aLen;
      var bLen = le32(dv, q); q += 4;
      var bo = q;
      q += bLen;
      if (q !== tend) fail("track slack");
      var tb = 0;
      var das = parseBlist(dv, n, bo);
      for (var di = 0; di < das.length; di++) {
        var da = das[di];
        if (da.f !== 0 || !da.chain.length) continue;
        var entries = parseChain(da.chain);
        for (var ei = 0; ei < entries.length; ei++) {
          var ty = entries[ei].ty, data = entries[ei].data;
          if (ty === 0 && data.length === 8 && !tb) {
            tb = new DataView(data.buffer, data.byteOffset, 8).getInt32(0, true);
          } else if (ty === 1) {
            if (!tb) fail("timebase missing");
            var blks = parseTrackh(data, false);
            for (var bi = 0; bi < blks.length; bi++) {
              var fr = blks[bi];
              rows.push({ t: t, move: fr.s * tb, a: fr.a });
              t += (fr.s + fr.e) * tb;
            }
          } else if (ty === 4) {
            if (!tb) fail("timebase missing");
            var vblks = parseTrackh(data, true);
            for (var vi = 0; vi < vblks.length; vi++) {
              var vf = vblks[vi];
              voice.push({ t: vt, bound: vf.s * tb, music: vf.music });
              vt += (vf.s + vf.e) * tb;
            }
          }
        }
      }
      p += 4 + itemLen;
    }
    return { frames: rows, voice: voice, durationMs: t, tracks: count };
  }

  var api = { parse: parseUbx };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.UbxParse = api;
})(typeof self !== "undefined" ? self : this);
