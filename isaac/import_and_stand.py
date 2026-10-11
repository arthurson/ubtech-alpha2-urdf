"""Alpha 2 -> Isaac Sim: import urdf/alpha2_isaac.urdf, add position drives, and run a standing test.

!! NOT RUN. This script was written without access to Isaac Sim (no GPU / no NVIDIA package index in the
!! build environment). Extension names and USD attribute names differ slightly between Isaac Sim 4.0-4.5;
!! the try/except blocks below cover the ones I know of. Send the first error you get and it can be fixed.

Run (Isaac Sim 4.x, from the Isaac Sim install folder):   ./python.sh <path>/isaac/import_and_stand.py
Needs a recent RTX GPU. Joint drives use degrees in USD (kp N*m/deg), so rad-based gains are converted below.
"""
import os, re, math, sys
HERE = os.path.dirname(os.path.abspath(__file__)); PKG = os.path.dirname(HERE)
URDF = os.path.join(PKG, 'urdf', 'alpha2_isaac.urdf')
KP, KV, ARMATURE = 20.0, 0.5, 0.005          # N*m/rad, N*m*s/rad, kg*m^2  (same values as the MuJoCo test)
HEIGHT = 0.2186 + 0.002                      # base_link height above ground at the zero pose (feet 2 mm above ground reference)

try:
    from isaacsim import SimulationApp       # Isaac Sim 4.5
except ImportError:
    from omni.isaac.kit import SimulationApp # Isaac Sim 4.0-4.2
app = SimulationApp({"headless": True})

import omni.kit.commands, omni.timeline, omni.usd
try:
    from isaacsim.core.utils.extensions import enable_extension
    enable_extension("isaacsim.asset.importer.urdf")
except Exception:
    from omni.isaac.core.utils.extensions import enable_extension
    enable_extension("omni.importer.urdf")
app.update()
from pxr import Usd, UsdGeom, UsdPhysics, PhysxSchema, Gf, Sdf

# --- import ---
ok, cfg = omni.kit.commands.execute("URDFCreateImportConfig")
cfg.merge_fixed_joints = True        # camera / accel / sole / hand-tip / base_footprint frames have no mass
cfg.fix_base = False
cfg.import_inertia_tensor = True     # use the URDF inertials (masses sum to 2.3 kg)
cfg.convex_decomp = False            # collision geometry is already 160 convex pieces
cfg.self_collision = False
cfg.make_default_prim = True
cfg.create_physics_scene = True
cfg.default_drive_type = 1           # position drive
ok, prim_path = omni.kit.commands.execute("URDFParseAndImportFile", urdf_path=URDF, import_config=cfg, dest_path="")
print("imported to", prim_path)
stage = omni.usd.get_context().get_stage()

# ground
omni.kit.commands.execute("CreateMeshPrimWithDefaultXform", prim_type="Plane", prim_path="/World/ground")
g = stage.GetPrimAtPath("/World/ground"); UsdGeom.Xformable(g).AddScaleOp().Set(Gf.Vec3f(20, 20, 1))
UsdPhysics.CollisionAPI.Apply(g)

# --- drives (torque limit per servo from config/servo_map.yaml) ---
torque = {}
for line in open(os.path.join(PKG, 'config', 'servo_map.yaml')):
    m = re.search(r'joint: (\w+).*?torque_nm: ([\d.]+)', line)
    if m: torque[m.group(1)] = float(m.group(2))
n = 0
for prim in stage.Traverse():
    if prim.IsA(UsdPhysics.RevoluteJoint):
        name = prim.GetName()                                   # e.g. r_knee_joint
        drive = UsdPhysics.DriveAPI.Get(prim, "angular") or UsdPhysics.DriveAPI.Apply(prim, "angular")
        drive.CreateStiffnessAttr(KP * math.pi / 180.0)         # N*m/rad -> N*m/deg
        drive.CreateDampingAttr(KV * math.pi / 180.0)
        drive.CreateMaxForceAttr(torque.get(name, 1.2))
        drive.CreateTargetPositionAttr(0.0)                     # zero pose (straight legs, arms down)
        PhysxSchema.PhysxJointAPI.Apply(prim).CreateArmatureAttr(ARMATURE)
        n += 1
print("drives configured on", n, "revolute joints (expected 20)")

# root height
root = None
for cand in ("base_link", "base_footprint"):
    for prim in stage.Traverse():
        if prim.GetName() == cand and prim.HasAPI(UsdPhysics.RigidBodyAPI): root = prim; break
    if root: break
print("root body prim:", root.GetPath() if root else None)
if root:
    xf = UsdGeom.Xformable(root); xf.ClearXformOpOrder(); xf.AddTranslateOp().Set(Gf.Vec3d(0, 0, HEIGHT))

# --- simulate 5 s ---
omni.timeline.get_timeline_interface().play()
for i in range(int(5.0 * 60)):
    app.update()
if root:
    m = UsdGeom.Xformable(root).ComputeLocalToWorldTransform(Usd.TimeCode.Default())
    z = m.ExtractTranslation()[2]; zb = m.GetRow3(2)[2]         # z of the body's z-axis in world
    print(f"after ~5 s: base z = {z:.4f} m, tilt = {math.degrees(math.acos(max(-1,min(1,zb)))):.2f} deg  (MuJoCo reference: 0.219 m, 0.5 deg)")
app.close()
