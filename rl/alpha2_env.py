"""Gymnasium env for the UBTech Alpha 2 on mujoco/alpha2.xml (same physics model as the web player's Physics mode).
Task: stand and keep balance under random pushes, with domain randomisation. pip install mujoco gymnasium numpy
obs (43) : joint pos - default (20), previous action (20), gravity direction in base frame (3; the robot's only
           inertial sensor is the head accelerometer, so no base angular velocity / linear velocity is given)
action(20): ctrl = q_default + ACT_SCALE * a   (clamped to the actuator ctrl range = joint limits)
"""
import os, re, numpy as np, mujoco, gymnasium as gym
from gymnasium import spaces
HERE = os.path.dirname(os.path.abspath(__file__)); PKG = os.path.dirname(HERE)
ACT_SCALE, DECIM, EP_STEPS = 0.3, 10, 500          # 0.02 s control step, 10 s episodes
FALL_Z, FALL_TILT = 0.15, np.radians(40)           # same fallen criterion as the README / web player

def _q_default():
    q = {}
    for l in open(os.path.join(PKG, 'config', 'servo_map.yaml')):
        m = re.search(r'joint: (\w+).*?q_init_deg: (-?[\d.]+)', l)
        if m: q[m.group(1)] = np.radians(float(m.group(2)))
    return q

class Alpha2Env(gym.Env):
    def __init__(self, randomize=True, push=True, seed=None):
        self.m = mujoco.MjModel.from_xml_path(os.path.join(PKG, 'mujoco', 'alpha2.xml')); self.d = mujoco.MjData(self.m)
        qd = _q_default(); J, A = mujoco.mjtObj.mjOBJ_JOINT, mujoco.mjtObj.mjOBJ_ACTUATOR
        names = list(qd)
        self.qadr = np.array([self.m.jnt_qposadr[mujoco.mj_name2id(self.m, J, n)] for n in names])
        self.act = np.array([mujoco.mj_name2id(self.m, A, 'act_' + n) for n in names])
        self.q0 = np.array([qd[n] for n in names]); self.lo = self.m.actuator_ctrlrange[self.act, 0]; self.hi = self.m.actuator_ctrlrange[self.act, 1]
        assert len(names) == 20
        self.nom = dict(fric=self.m.geom_friction.copy(), mass=self.m.body_mass.copy(), inert=self.m.body_inertia.copy(),
                        gain=self.m.actuator_gainprm.copy(), bias=self.m.actuator_biasprm.copy(), frc=self.m.actuator_forcerange.copy())
        self.randomize, self.push = randomize, push
        self.observation_space = spaces.Box(-np.inf, np.inf, (43,), np.float32); self.action_space = spaces.Box(-1, 1, (20,), np.float32)
        self.rng = np.random.default_rng(seed); self.prev = np.zeros(20)

    def _dr(self):
        m, n, r = self.m, self.nom, self.rng
        m.geom_friction[:] = n['fric']; m.geom_friction[:, 0] = r.uniform(0.4, 1.2) if self.randomize else 0.8   # contact uses the max of both geoms -> set all
        s = r.uniform(0.9, 1.1) if self.randomize else 1.0; m.body_mass[:] = n['mass'] * s; m.body_inertia[:] = n['inert'] * s
        kp = r.uniform(0.7, 1.3) if self.randomize else 1.0
        m.actuator_gainprm[:] = n['gain']; m.actuator_biasprm[:] = n['bias']
        m.actuator_gainprm[:, 0] *= kp; m.actuator_biasprm[:, 1] *= kp
        m.actuator_forcerange[:] = n['frc'] * (r.uniform(0.6, 1.0) if self.randomize else 1.0)   # no torque-speed curve is modelled: real torque is below stall

    def _obs(self):
        d = self.d; R = d.xmat[1].reshape(3, 3); g = R.T @ np.array([0, 0, -1.0])
        return np.concatenate([d.qpos[self.qadr] - self.q0, self.prev, g]).astype(np.float32)

    def reset(self, seed=None, options=None):
        if seed is not None: self.rng = np.random.default_rng(seed)
        self._dr(); d = self.d; mujoco.mj_resetData(self.m, d)
        d.qpos[:7] = [0, 0, 0.2206 + 0.0015, 1, 0, 0, 0]; d.qpos[self.qadr] = self.q0; d.ctrl[self.act] = self.q0
        if self.randomize: d.qpos[self.qadr] += self.rng.normal(0, 0.03, 20)
        mujoco.mj_forward(self.m, d); self.t = 0; self.prev[:] = 0; self.lag = [np.zeros(20)] * (int(self.rng.integers(0, 3)) if self.randomize else 0)
        return self._obs(), {}

    def step(self, a):
        a = np.clip(a, -1, 1).astype(np.float64); self.lag.append(a); a_eff = self.lag.pop(0) if self.lag else a   # 0-2 step action delay
        d = self.d; ctrl = np.clip(self.q0 + ACT_SCALE * a_eff, self.lo, self.hi)
        if self.push and self.t % 100 == 50 and self.rng.random() < 0.7:
            d.xfrc_applied[1, :2] = self.rng.uniform(-1, 1, 2) * 3.0     # N, held for one control step
        for k in range(DECIM):
            d.ctrl[self.act] = ctrl
            mujoco.mj_step(self.m, d)
        d.xfrc_applied[:] = 0
        self.t += 1
        zz = d.xmat[1].reshape(3, 3)[2, 2]; tilt = np.arccos(np.clip(zz, -1, 1)); z = d.qpos[2]
        fallen = z < FALL_Z or tilt > FALL_TILT
        dq = d.qpos[self.qadr] - self.q0
        r = 1.0 - 2.0 * tilt ** 2 - 1.0 * np.sum(dq ** 2) * 0.1 - 0.02 * np.sum((a - self.prev) ** 2) - 0.002 * np.sum(d.actuator_force[self.act] ** 2) - 0.5 * np.sum(d.qvel[:2] ** 2)
        self.prev = a.copy()
        return self._obs(), float(-5.0 if fallen else r), bool(fallen), self.t >= EP_STEPS, {}
