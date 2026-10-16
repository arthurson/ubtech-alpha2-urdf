#!/usr/bin/env python3
"""Build actions/manifest.json for the web player.

{"count": N, "files": [...ubx...],
 "music": {"<ubx-stem>": ["song.mp3", ...]}}  (dirs next to each .ubx)
"""
import os, json

HERE = os.path.dirname(os.path.abspath(__file__))
ADIR = os.path.join(os.path.dirname(os.path.dirname(HERE)), "actions")
OUT = os.path.join(ADIR, "manifest.json")

names = sorted(f for f in os.listdir(ADIR) if f.lower().endswith(".ubx"))
music = {}
for f in names:
    stem = f[:-4]
    d = os.path.join(ADIR, stem)
    if os.path.isdir(d):
        songs = sorted(x for x in os.listdir(d)
                       if x.lower().endswith((".mp3", ".wav", ".ogg", ".m4a")))
        if songs:
            music[stem] = songs
# 中英文名（actions/names.json，由 openalpha2 xiaozhi_actions.json 抄一次過嚟）
npath = os.path.join(ADIR, "names.json")
anames = json.load(open(npath, encoding="utf-8")) if os.path.isfile(npath) else {}
with open(OUT, "w", encoding="utf-8") as f:
    json.dump({"count": len(names), "files": names, "music": music,
               "names": {s[:-4]: anames.get(s[:-4], {}) for s in names}}, f,
              ensure_ascii=False)
print("wrote", OUT, len(names), "actions,", len(music), "with music")
