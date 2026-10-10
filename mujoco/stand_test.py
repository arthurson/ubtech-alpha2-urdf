"""Stand test for the Alpha 2 in MuJoCo.  pip install mujoco numpy
Servo model: position actuators (kp, kv, +-1.5 N*m) + joint armature + implicitfast integrator.
Armature is REQUIRED: the lightest links have principal inertia ~8e-7 kg*m^2, which is numerically
unstable with servo stiffness unless reflected rotor inertia (armature) is added."""
import os, re, sys, numpy as np, mujoco
HERE = os.path.dirname(os.path.abspath(__file__)); PKG = os.path.dirname(HERE)
KP, KV, ARMATURE, FORCE = 20.0, 0.5, 0.005, 1.5

def load(kp=KP, kv=KV, armature=ARMATURE, force=FORCE):
    spec = mujoco.MjSpec.from_file(os.path.join(PKG, 'urdf', 'alpha2_mujoco.urdf'))
    spec.option.timestep = 0.002
    spec.option.integrator = mujoco.mjtIntegrator.mjINT_IMPLICITFAST
    spec.body('base_link').add_freejoint()
    spec.worldbody.add_geom(name='ground', type=mujoco.mjtGeom.mjGEOM_PLANE, size=[2, 2, 0.1])
    for b in ('r_shoulder_roll_link', 'l_shoulder_roll_link'):      # source models overlap by 3-5 mm here
        spec.add_exclude(bodyname1='base_link', bodyname2=b)
    for j in spec.joints:
        if j.type == mujoco.mjtJoint.mjJNT_HINGE:
            j.armature = armature
            a = spec.add_actuator(); a.name = 'act_' + j.name; a.target = j.name
            a.trntype = mujoco.mjtTrn.mjTRN_JOINT; a.gainprm[0] = kp
            a.biastype = mujoco.mjtBias.mjBIAS_AFFINE; a.biasprm[1] = -kp; a.biasprm[2] = -kv
            a.forcelimited = mujoco.mjtLimited.mjLIMITED_TRUE; a.forcerange = [-force, force]
            a.ctrllimited = mujoco.mjtLimited.mjLIMITED_TRUE; a.ctrlrange = list(j.range)
    return spec.compile()

def default_stance():
    q = {}
    for line in open(os.path.join(PKG, 'config', 'servo_map.yaml')):
        m = re.search(r'joint: (\w+).*?q_init_deg: (-?[\d.]+)', line)
        if m: q[m.group(1)] = np.radians(float(m.group(2)))
    return q

if __name__ == '__main__':
    m = load(); d = mujoco.MjData(m); q = default_stance()
    d.qpos[:7] = [0, 0, 0.2206 + 0.0015, 1, 0, 0, 0]
    for n, v in q.items():
        d.qpos[m.jnt_qposadr[mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_JOINT, n)]] = v
        d.ctrl[mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_ACTUATOR, 'act_' + n)] = v
    for k in range(int(5.0 / m.opt.timestep)): mujoco.mj_step(m, d)
    zb = d.xmat[1].reshape(3, 3)[:, 2]
    print(f'total mass {m.body_mass.sum():.3f} kg | after 5 s: base z {d.qpos[2]:.4f} m, tilt {np.degrees(np.arccos(zb[2])):.2f} deg, '
          f'max joint error {np.degrees(np.abs(d.qpos[7:] - d.ctrl).max()):.2f} deg')
