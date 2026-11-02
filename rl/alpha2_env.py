"""Gymnasium env for the UBTech Alpha 2 on mujoco/alpha2.xml (same physics model as the web player's Physics mode).
Task: stand and keep balance under random pushes, with domain randomisation. pip install mujoco gymnasium numpy
obs (43) : joint pos - default (20), previous action (20), gravity direction in base frame (3; the robot's only
           inertial sensor is the head accelerometer, so no base angular velocity / linear velocity is given)
action(20): ctrl = q_default + ACT_SCALE * a   (clamped to the actuator ctrl range = joint limits)
"""
import os, re, json, numpy as np, mujoco, gymnasium as gym
from gymnasium import spaces
HERE = os.path.dirname(os.path.abspath(__file__)); PKG = os.path.dirname(HERE)
ACT_SCALE, DECIM, EP_STEPS = 0.3, 10, 500          # 0.02 s control step, 10 s episodes
FALL_Z, FALL_TILT = 0.15, np.radians(40)           # same fallen criterion as the README / web player

# Tunable push / reward weights. Defaults = the original hard-coded values. Override with env var ALPHA2_CFG (JSON), e.g.
# ALPHA2_CFG='{"push_force": 5, "w_smooth": 0.05}' (the web player's cloud-training panel / train.yml `cfg` input sets it).
# Values are clamped to the ranges below; unknown keys are ignored. obs / action layout and ACT_SCALE / DECIM are NOT tunable
# (they must match web/mj-sim.js). push_steps = how many control steps (0.02 s each) one push is held; 1 = the original single-step push.
_DEF = dict(push_force=3.0, push_steps=1.0, push_prob=0.7, w_tilt=2.0, w_pose=0.1, w_smooth=0.02, w_torque=0.002, w_track=1.0, w_up=0.5, w_stand=1.0)
_LIM = dict(push_force=(0, 80), push_steps=(1, 25), push_prob=(0, 1), w_tilt=(0, 10), w_pose=(0, 2), w_smooth=(0, 1), w_torque=(0, 0.05), w_track=(0, 5), w_up=(0, 5), w_stand=(0, 10))
def _load_cfg():
    c = dict(_DEF)
    try: u = json.loads(os.environ.get('ALPHA2_CFG') or '{}')
    except ValueError: u = {}
    if isinstance(u, dict):
        for k, (lo, hi) in _LIM.items():
            v = u.get(k)
            if isinstance(v, (int, float)) and not isinstance(v, bool) and np.isfinite(v): c[k] = float(min(hi, max(lo, v)))
    return c
CFG = _load_cfg()

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
        self.pleft, self.pvec = 0, np.zeros(2)
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
        mujoco.mj_forward(self.m, d); self.t = 0; self.pleft = 0; self.prev[:] = 0; self.lag = [np.zeros(20)] * (int(self.rng.integers(0, 3)) if self.randomize else 0)
        return self._obs(), {}

    def _push(self):   # random horizontal push on the body: every 2 s with probability push_prob, push_force N held for push_steps control steps
        if self.push and self.t % 100 == 50 and self.rng.random() < CFG['push_prob']:
            self.pvec = self.rng.uniform(-1, 1, 2) * CFG['push_force']; self.pleft = int(round(CFG['push_steps']))
        if self.pleft > 0: self.d.xfrc_applied[1, :2] = self.pvec; self.pleft -= 1     # cleared again after the physics steps

    def step(self, a):
        a = np.clip(a, -1, 1).astype(np.float64); self.lag.append(a); a_eff = self.lag.pop(0) if self.lag else a   # 0-2 step action delay
        d = self.d; ctrl = np.clip(self.q0 + ACT_SCALE * a_eff, self.lo, self.hi)
        self._push()
        for k in range(DECIM):
            d.ctrl[self.act] = ctrl
            mujoco.mj_step(self.m, d)
        d.xfrc_applied[:] = 0
        self.t += 1
        zz = d.xmat[1].reshape(3, 3)[2, 2]; tilt = np.arccos(np.clip(zz, -1, 1)); z = d.qpos[2]
        fallen = z < FALL_Z or tilt > FALL_TILT
        dq = d.qpos[self.qadr] - self.q0
        r = 1.0 - CFG['w_tilt'] * tilt ** 2 - CFG['w_pose'] * np.sum(dq ** 2) - CFG['w_smooth'] * np.sum((a - self.prev) ** 2) - CFG['w_torque'] * np.sum(d.actuator_force[self.act] ** 2) - 0.5 * np.sum(d.qvel[:2] ** 2)
        self.prev = a.copy()
        return self._obs(), float(-5.0 if fallen else r), bool(fallen), self.t >= EP_STEPS, {}


class WalkEnv(Alpha2Env):
    """Imitation walking: track an official .ubx walk (rl/ref/*.json from rl/make_ref.mjs); the policy outputs a residual
    around the reference joint targets so it can balance. The reference = start-up, then the exact gait loop repeated.
    obs (65) = Alpha2Env obs (43) + (ref q - default) (20) + sin/cos of the gait phase (2; zeros during start-up)
    ctrl = ref_q(t) + WALK_SCALE * a"""
    WALK_SCALE = 0.2
    def __init__(self, ref=os.path.join(PKG, 'rl', 'ref', 'forward.json'), **kw):
        import json
        super().__init__(**kw); R = json.load(open(ref)); self.ref = np.array(R['q']); self.loop = R['loop']; assert self.loop
        self.observation_space = spaces.Box(-np.inf, np.inf, (65,), np.float32); self.EP = 1000
    def ref_q(self, t):
        a, b = self.loop
        return self.ref[t] if t < b else self.ref[a + (t - a) % (b - a)]
    def _wobs(self):
        a, b = self.loop; ph = 2 * np.pi * (self.t - a) / (b - a) if self.t >= a else None
        ex = np.concatenate([self.ref_q(self.t) - self.q0, [np.sin(ph), np.cos(ph)] if ph is not None else [0.0, 0.0]])
        return np.concatenate([super()._obs(), ex]).astype(np.float32)
    def reset(self, seed=None, options=None):
        super().reset(seed=seed); d = self.d; d.qpos[self.qadr] = self.ref[0]; d.ctrl[self.act] = self.ref[0]
        if self.randomize: d.qpos[self.qadr] += self.rng.normal(0, 0.02, 20)
        mujoco.mj_forward(self.m, d); self.t = 0; return self._wobs(), {}
    def step(self, a):
        a = np.clip(a, -1, 1).astype(np.float64); self.lag.append(a); a_eff = self.lag.pop(0) if self.lag else a
        d = self.d; qr = self.ref_q(self.t); ctrl = np.clip(qr + self.WALK_SCALE * a_eff, self.lo, self.hi)
        self._push()
        for _ in range(DECIM): d.ctrl[self.act] = ctrl; mujoco.mj_step(self.m, d)
        d.xfrc_applied[:] = 0; self.t += 1
        zz = d.xmat[1].reshape(3, 3)[2, 2]; tilt = np.arccos(np.clip(zz, -1, 1)); z = d.qpos[2]; fallen = z < FALL_Z or tilt > FALL_TILT
        err = np.mean((d.qpos[self.qadr] - qr) ** 2)
        r = 0.5 + CFG['w_track'] * np.exp(-60 * err) - CFG['w_tilt'] * tilt ** 2 - CFG['w_smooth'] * np.sum((a - self.prev) ** 2) - CFG['w_torque'] * np.sum(d.actuator_force[self.act] ** 2) - 0.5 * d.qvel[1] ** 2
        self.prev = a.copy()
        return self._wobs(), float(-5.0 if fallen else r), bool(fallen), self.t >= self.EP, {}


GETUP_QUAT = {'back': [np.sqrt(.5), 0, -np.sqrt(.5), 0], 'front': [np.sqrt(.5), 0, np.sqrt(.5), 0]}   # lying on the back (face up) / on the front (face down); body x = front, z = up
REF_DEFAULT = {'walk': 'forward.json', 'getup_back': 'backstand.json', 'getup_front': 'frontstand.json'}


class GetUpEnv(Alpha2Env):
    """Get up from lying on the floor and stay standing.  mode 'back' = lying on the back, face up / head up (official action BackStand, 8 s)
    or 'front' = lying on the front, face down (official action FrontStand, 11.3 s).  Like WalkEnv the policy outputs a residual around the
    reference joint targets (rl/ref/backstand.json | frontstand.json from rl/make_ref.mjs); after the reference ends its last pose is held.
    obs (65) = Alpha2Env obs (43) + (ref q - default) (20) + [t / T (<= 1), 1 once the reference is over]
    ctrl = ref_q(t) + GETUP_SCALE * a.   Episode = the reference + HOLD control steps (the robot has to be up and stay up).
    No termination on falling (it starts on the floor); reward = reference tracking + height/upright progress + a bonus while standing."""
    SCALE, HOLD, SETTLE = 0.2, 150, 50
    def __init__(self, mode='back', ref=None, **kw):
        import json
        super().__init__(**kw); self.mode = mode
        R = json.load(open(ref or os.path.join(PKG, 'rl', 'ref', REF_DEFAULT['getup_' + mode]))); self.ref = np.array(R['q']); self.T = len(self.ref)
        self.EP = self.T + self.HOLD; self.observation_space = spaces.Box(-np.inf, np.inf, (65,), np.float32)
    def ref_q(self, t): return self.ref[min(t, self.T - 1)]
    def standing(self):
        d = self.d; return bool(d.xmat[1].reshape(3, 3)[2, 2] > np.cos(np.radians(20)) and d.qpos[2] > 0.19)
    def _gobs(self):
        ex = np.concatenate([self.ref_q(self.t) - self.q0, [min(self.t / self.T, 1.0), 1.0 if self.t >= self.T else 0.0]])
        return np.concatenate([super()._obs(), ex]).astype(np.float32)
    def reset(self, seed=None, options=None):
        super().reset(seed=seed); m, d, rng = self.m, self.d, self.rng
        mujoco.mj_resetData(m, d)
        q = np.array(GETUP_QUAT[self.mode], float); n = 0.0
        if self.randomize:   # random heading and a few degrees of tilt
            yaw = np.zeros(4); mujoco.mju_axisAngle2Quat(yaw, np.array([0.0, 0, 1]), rng.uniform(-0.35, 0.35)); tmp = np.zeros(4); mujoco.mju_mulQuat(tmp, yaw, q); q = tmp
            tilt = np.zeros(4); mujoco.mju_axisAngle2Quat(tilt, np.array([1.0, 0, 0]), rng.normal(0, 0.05)); tmp = np.zeros(4); mujoco.mju_mulQuat(tmp, q, tilt); q = tmp
            n = rng.uniform(0, 0.02)
        d.qpos[:7] = [0, 0, 0.10 + n, *q]; d.qpos[self.qadr] = self.ref[0] + (rng.normal(0, 0.02, 20) if self.randomize else 0); d.ctrl[self.act] = self.ref[0]
        mujoco.mj_forward(m, d)
        for _ in range(self.SETTLE):   # 1 s lying on the floor, holding the first reference pose
            for _ in range(DECIM): d.ctrl[self.act] = self.ref[0]; mujoco.mj_step(m, d)
        self.t = 0; self.pleft = 0; self.prev[:] = 0
        return self._gobs(), {}
    def _push(self):   # pushes only make sense once the robot should be standing
        if self.t >= self.T: super()._push()
    def step(self, a):
        a = np.clip(a, -1, 1).astype(np.float64); self.lag.append(a); a_eff = self.lag.pop(0) if self.lag else a
        d = self.d; qr = self.ref_q(self.t); ctrl = np.clip(qr + self.SCALE * a_eff, self.lo, self.hi)
        self._push()
        for _ in range(DECIM): d.ctrl[self.act] = ctrl; mujoco.mj_step(self.m, d)
        d.xfrc_applied[:] = 0; self.t += 1
        zz = d.xmat[1].reshape(3, 3)[2, 2]; z = d.qpos[2]; err = np.mean((d.qpos[self.qadr] - qr) ** 2)
        prog = 0.5 * max(zz, 0.0) + 0.5 * min(z / 0.216, 1.0)
        r = CFG['w_track'] * np.exp(-30 * err) + CFG['w_up'] * prog + CFG['w_stand'] * float(self.standing()) - CFG['w_smooth'] * np.sum((a - self.prev) ** 2) - CFG['w_torque'] * np.sum(d.actuator_force[self.act] ** 2)
        self.prev = a.copy()
        return self._gobs(), float(r), False, self.t >= self.EP, {}


def make_env(task, ref=None, **kw):
    """environment of a training task: stand | walk | getup_back | getup_front"""
    if task == 'stand': return Alpha2Env(**kw)
    if task == 'walk': return WalkEnv(ref=ref or os.path.join(PKG, 'rl', 'ref', REF_DEFAULT['walk']), **kw)
    if task in ('getup_back', 'getup_front'): return GetUpEnv(mode=task[6:], ref=ref, **kw)
    raise ValueError('unknown task ' + task)
