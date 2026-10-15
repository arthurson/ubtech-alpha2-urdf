#!/usr/bin/env python3
"""Generate a minimal VALID .ubx (per UbxParser/ubx_to_traj layout) with known frames.

Used to verify web/ubx-parse.js byte-for-byte against ubx_to_traj.py.
Writes web/tools/test-action.ubx + prints expected rows as JSON.
Layout refs: UbxParser.java (sdk-module/.../ubx) + scripts/ubx_to_traj.py.
"""
import struct, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "test-action.ubx")

def i32(v):
    return struct.pack("<i", v)

def echoed(body_wo_len):
    """[len][echo==len][rest...]; body_wo_len starts with 4B echo placeholder."""
    ln = len(body_wo_len)
    return i32(ln) + i32(ln) + body_wo_len[4:]

def frame_blob(s, e, angles20):
    assert len(angles20) == 20
    eb = bytearray(168)
    for gi, a in enumerate(angles20):
        eb[8 + gi * 8] = a & 0xFF
    # [echo][a=0][b=start][c=end][d=30xint16][f=ffb][e-blob]
    body = b"\x00\x00\x00\x00" + i32(0) + i32(s) + i32(e) + bytes(60) \
        + i32(168) + bytes(eb)
    return echoed(body)

def ablock(frames):
    items = b"".join(frame_blob(s, e, an) for s, e, an in frames)
    # [echo][a=0][b=0][c=0][d=30xint16][count][frames]
    body = b"\x00\x00\x00\x00" + i32(0) + i32(0) + i32(0) + bytes(60) \
        + i32(len(frames)) + items
    return echoed(body)

def ah_container(block_bytes):
    # a.h: [echo==len][count][items...] (no separate outer len)
    body = i32(1) + block_bytes
    return i32(4 + len(body)) + body

def chain(tb, ah):
    t0 = i32(0) + i32(8) + i32(tb) + i32(0)          # type0 timebase
    t1 = i32(1) + i32(len(ah)) + ah                  # type1 servo
    body = i32(2) + t0 + t1
    tot = 4 + len(body)                              # fh INCLUDES its own len (Java [h,h+fh))
    return i32(tot) + body, tot                      # chain: [len][...]

def da_frame(tb, frames):
    blk = ablock(frames)
    ah = ah_container(blk)
    ch, fh = chain(tb, ah)
    # d.a: [echo][fLen=0][a][b][c=50xint16][d=50xint16][e][f=0][g][h=fh][i]
    body = b"\x00\x00\x00\x00" + i32(0) + i32(0) + i32(0) \
        + bytes(100) + bytes(100) + i32(0) + i32(0) + i32(0) + i32(fh) + ch
    return echoed(body)

def main():
    tb = 20
    frames = [
        (20, 10, [(i * 7 + 11) % 256 for i in range(20)]),
        (10, 5, [(i * 13 + 101) % 256 for i in range(20)]),
        (30, 15, [(255 - i * 5) % 256 for i in range(20)]),
    ]
    da = da_frame(tb, frames)
    # b-section (d.a list): [echo==len][count][d.a...] (no separate outer len)
    bl_body = i32(1) + da
    blist = i32(4 + len(bl_body)) + bl_body
    ft_empty = i32(8) + i32(0)      # d.f empty table: [echo][count]
    a_empty = i32(8) + i32(0)       # d.d empty list
    track_body = b"\x00\x00\x00\x00" + i32(0) + i32(8) + ft_empty \
        + i32(8) + a_empty + i32(len(blist)) + blist
    track = echoed(track_body)                          # [outer][echo][id]...
    motion_body = i32(1) + track
    motion = i32(len(motion_body)) + motion_body       # [len][count] no echo
    elen = len(motion_body)
    blob = i32(0) + b"ubx-alpha" + i32(1) + i32(elen) + motion \
        + i32(8) + bytes(8)
    blob = i32(len(blob)) + blob[4:]
    open(OUT, "wb").write(blob)
    t = 0
    rows = []
    for s, e, an in frames:
        rows.append({"t": t, "move": s * tb, "a": an})
        t += (s + e) * tb
    print(json.dumps({"frames": rows, "tb": tb}))
    print("wrote", OUT, len(blob), "bytes")

main()
