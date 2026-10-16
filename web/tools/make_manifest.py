#!/usr/bin/env python3
"""Build actions/manifest.json: sorted list of bundled .ubx files for the web player."""
import os, json

HERE = os.path.dirname(os.path.abspath(__file__))
ADIR = os.path.join(os.path.dirname(os.path.dirname(HERE)), "actions")
OUT = os.path.join(ADIR, "manifest.json")

names = sorted(f for f in os.listdir(ADIR) if f.lower().endswith(".ubx"))
with open(OUT, "w", encoding="utf-8") as f:
    json.dump({"count": len(names), "files": names}, f)
print("wrote", OUT, len(names), "actions")
