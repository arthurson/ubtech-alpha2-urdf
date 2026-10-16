#!/usr/bin/env python3
"""Extract full-body FK params from alpha2.urdf + servo_map.yaml -> web/fk-params.js

Covers 20 servos (IDs 1..20): joint origins/axes (URDF), angle offsets
(servo_map: q_deg = servo + offset, except ID20 uses urdf_offset),
joint limits + servo ranges. No hand copying.
"""
import re, sys, os, json

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
URDF = os.path.join(REPO, "urdf", "alpha2.urdf")
SMAP = os.path.join(REPO, "config", "servo_map.yaml")
OUT = os.path.join(REPO, "web", "fk-params.js")

def parse_urdf(path):
    import xml.etree.ElementTree as ET
    tr = ET.parse(path)
    joints = {}
    for j in tr.getroot().iter("joint"):
        name = j.get("name")
        if j.get("type") != "revolute":
            continue
        o = j.find("origin").get("xyz").split()
        a = j.find("axis").get("xyz").split()
        lim = j.find("limit")
        joints[name] = {
            "parent": j.find("parent").get("link"),
            "origin": [float(x) for x in o],
            "axis": [float(x) for x in a],
            "qlim": [float(lim.get("lower")), float(lim.get("upper"))],
        }
    fixed = {}
    for j in tr.getroot().iter("joint"):
        if j.get("type") == "fixed":
            o = j.find("origin").get("xyz").split()
            fixed[j.get("name")] = {
                "parent": j.find("parent").get("link"),
                "child": j.find("child").get("link"),
                "origin": [float(x) for x in o],
            }
    return joints, fixed

def split_top(body):
    parts, cur, depth, q = [], "", 0, None
    for ch in body:
        if q:
            cur += ch
            if ch == q:
                q = None
        elif ch in "\"'":
            q, cur = ch, cur + ch
        elif ch == "[":
            depth, cur = depth + 1, cur + ch
        elif ch == "]":
            depth, cur = depth - 1, cur + ch
        elif ch == "," and depth == 0:
            parts.append(cur); cur = ""
        else:
            cur += ch
    parts.append(cur)
    return parts

def parse_smap(path):
    rows = []
    for ln in open(path, encoding="utf-8"):
        ln = ln.strip()
        if not ln.startswith("- {"):
            continue
        body = ln[3:].strip("{}")
        d = {}
        for kv in split_top(body):
            k, v = kv.split(":", 1)
            k, v = k.strip(), v.strip().strip('"')
            if v.startswith("["):
                v = [float(x) for x in v.strip("[]").split(",")]
            else:
                try:
                    v = int(v)
                except ValueError:
                    try:
                        v = float(v)
                    except ValueError:
                        pass
            d[k] = v
        rows.append(d)
    return rows

joints, fixed = parse_urdf(URDF)
smap = parse_smap(SMAP)
by_joint = {r["joint"]: r for r in smap}

# chains in URDF order (parent link -> joint -> child), with tip frames
CHAINS = {
    "r_arm": ["r_shoulder_pitch_joint", "r_shoulder_roll_joint", "r_elbow_joint"],
    "l_arm": ["l_shoulder_pitch_joint", "l_shoulder_roll_joint", "l_elbow_joint"],
    "r_leg": ["r_hip_roll_joint", "r_hip_pitch_joint", "r_knee_joint",
              "r_ankle_pitch_joint", "r_ankle_roll_joint"],
    "l_leg": ["l_hip_roll_joint", "l_hip_pitch_joint", "l_knee_joint",
              "l_ankle_pitch_joint", "l_ankle_roll_joint"],
    "head": ["head_yaw_joint", "head_pitch_joint"],
}
# fixed tip after each chain: joint name -> offset in last link frame
TIPS = {
    "r_arm": ("r_hand_tip_joint", [17]),
    "l_arm": ("l_hand_tip_joint", [18]),
    "r_leg": ("r_sole_frame_joint", []),
    "l_leg": ("l_sole_frame_joint", []),
    "head": (None, [19, 20]),
}

out = {"chains": {}, "tips": {}, "hands": {},
       "torso": {"x": [-42.3, 52.7], "y": [-56.8, 57.4], "z": [-16.0, 104.8]}}
for cname, jnames in CHAINS.items():
    items = []
    for jn in jnames:
        uj = joints[jn]
        sm = by_joint[jn]
        off = sm.get("urdf_offset", sm["pc_offset"])
        items.append({
            "servo": sm["servo_id"], "joint": jn,
            "origin": uj["origin"], "axis": uj["axis"],
            "offset": off, "qlim": uj["qlim"],
            "srg": [sm["servo_min"], sm["servo_max"]],
            "home": sm["servo_home"],
        })
    out["chains"][cname] = items
    tj, _ = TIPS[cname]
    if tj:
        out["tips"][cname] = fixed[tj]["origin"]
    else:
        out["tips"][cname] = [0, 0, 0.06]  # head top marker above pitch link
out["wrists"] = {"r_arm": joints["r_hand_joint"]["origin"],
                 "l_arm": joints["l_hand_joint"]["origin"]}
# finger joints (servo 17/18, driven for mesh display; tiny motion)
out["handJoints"] = {}
for jn, sid in (("r_hand_joint", 17), ("l_hand_joint", 18)):
    sm = [r for r in smap if r["servo_id"] == sid][0]
    out["handJoints"][str(sid)] = {
        "joint": jn, "origin": joints[jn]["origin"], "axis": joints[jn]["axis"],
        "offset": sm.get("urdf_offset", sm["pc_offset"]),
        "parent": "r_arm" if sid == 17 else "l_arm",
    }
# mesh link names (meshes/visual/<link>.obj), one per joint child + base + hands
links = ["base_link"]
for cname, jnames in CHAINS.items():
    links += [jn.replace("_joint", "_link") for jn in jnames]
links += ["r_hand_link", "l_hand_link"]
out["links"] = links
out["meshKB"] = {}
for ln in links:
    mp = os.path.join(REPO, "meshes", "visual", ln + ".obj")
    out["meshKB"][ln] = round(os.path.getsize(mp) / 1024) if os.path.isfile(mp) else -1
# hand (finger) servos: fixed closed value display only
for sid in (17, 18):
    sm = [r for r in smap if r["servo_id"] == sid][0]
    out["hands"][str(sid)] = {"servo_min": sm["servo_min"], "servo_max": sm["servo_max"]}

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    f.write("// Auto-generated by web/tools/extract_fk_params.py — do not hand-edit.\n")
    f.write("var FK = ")
    json.dump(out, f)
    f.write(";\n")
print("wrote", OUT, "chains:", {k: len(v) for k, v in out["chains"].items()})
