"""Gymnasium envs for the UBTech Alpha 2 on mujoco/alpha2.xml (same physics model as the web player's Physics mode).
pip install mujoco gymnasium numpy

ONE observation layout for every task (OBS_DIM = 68, float32) - the web player builds the same vector whatever policy is loaded:
    [ 0:20] joint position - q_default (servo order 1..20, rad)
    [20:40] previous action (normalised, -1..1)
    [40:43] gravity direction in the base frame (the robot's only inertial sensor is the head accelerometer, so there is
            no base angular / linear velocity in the observation)
    [43:46] velocity command (vx m/s forward, vy m/s left, wz rad/s counter-clockwise); zeros for tasks without a command
    [46:48] phase features: stand / walk = sin, cos of a free-running clock (period GAIT_PERIOD s); walk_ref = sin, cos of the loop of the
            reference (0, 0 during its start-up); get-up = (progress t/T <= 1, 1 once the reference is over)
    [48:68] base target - q_default  (zeros for stand / walk; reference - q_default for walk_ref / get-up)
action (20, -1..1): ctrl = base target + SCALE * a   (base target = q_default or the reference; clamped to the joint limits = actuator ctrl range)
    -> the exported ONNX has two outputs: 'action' (clamped a, goes back into obs[20:40]) and 'delta' (= SCALE * a in rad), so the
       player applies the same rule for every task:  ctrl = q_default + obs[48:68] + delta.

Control period CTRL_DT = 0.1 s (physics 0.002 s x DECIM 50); must equal web/mj-sim.js (CDT / DECIM).
Tasks: stand | walk (velocity command: forward / back / left / right / turn, like Rhoban/mjlab_microban) | walk_ref (imitate the official forward walk) |
       getup_back | getup_front
"""
import os, re, json, numpy as np, mujoco, gymnasium as gym
from gymnasium import spaces
HERE = os.path.dirname(os.path.abspath(__file__)); PKG = os.path.dirname(HERE)
CTRL_DT, DECIM, PHYS_DT = 0.1, 50, 0.002           # 100 ms control step = 50 physics steps of 2 ms
SCALE_STAND, SCALE_WALK, SCALE_REF = 0.3, 0.5, 0.2   # rad per unit action (stand / velocity walk / residual around a reference)
GAIT_PERIOD = 1.0                                  # s, free-running clock given to the stand / velocity-walk policies (10 control steps); must equal web/mj-sim.js
EP_STAND, EP_WALK = 100, 200                        # 10 s / 20 s episodes
CMD_EVERY = 40                                     # new velocity command every 4 s
PUSH_EVERY = 20                                    # a push is possible every 2 s
FALL_Z, FALL_TILT = 0.15, np.radians(40)           # same fallen criterion as the README / web player
OBS_DIM = 68
OBS_LAYOUT = dict(q=(0, 20), prev_action=(20, 40), gravity=(40, 43), command=(43, 46), phase=(46, 48), target=(48, 68))

# Tunable push / reward weights. Override with env var ALPHA2_CFG (JSON), e.g. ALPHA2_CFG='{"push_force": 5, "w_smooth": 0.05}'
# (the web player's cloud-training panel / train.yml `cfg` input sets it). Values are clamped to the ranges below; unknown keys are ignored.
# push_steps = how long one push is held in units of 0.02 s (1 = the original 20 ms impulse, 5 = 0.1 s = one whole control step).
# cmd_vx / cmd_vy / cmd_wz = maximum velocity command of the walk task (m/s, m/s, rad/s). obs layout, CTRL_DT, SCALE_* are NOT tunable
# (they must match web/mj-sim.js).
_DEF = dict(push_force=3.0, push_steps=1.0, push_prob=0.7, w_tilt=2.0, w_pose=0.1, w_smooth=0.02, w_torque=0.002, w_track=1.0, w_up=0.5, w_stand=1.0,
            w_air=0.5, cmd_vx=0.05, cmd_vy=0.03, cmd_wz=0.4)
_LIM = dict(push_force=(0, 80), push_steps=(1, 25), push_prob=(0, 1), w_tilt=(0, 10), w_pose=(0, 2), w_smooth=(0, 1), w_torque=(0, 0.05), w_track=(0, 5), w_up=(0, 5), w_stand=(0, 10),
            w_air=(0, 3), cmd_vx=(0, 0.3), cmd_vy=(0, 0.2), cmd_wz=(0, 2))
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

def load_ref(path):
    R = json.load(open(path)); return np.array(R['q']), R.get('dt', 0.02), R.get('loop')

def ref_at(q, dt, loop, t):
    """reference joint target at control step t (time t*CTRL_DT), linearly interpolated from the 50 Hz reference; the loop window [a,b) (50 Hz steps) repeats"""
    x = t * CTRL_DT / dt
    if loop and x >= loop[1]: a, b = loop; x = a + (x - a) % (b - a)
    x = min(max(x, 0.0), len(q) - 1.0); i = int(x); j = min(i + 1, len(q) - 1); f = x - i
    return q[i] * (1 - f) + q[j] * f


class Alpha2Env(gym.Env):
    """Task 'stand': keep balance under random pushes, with domain randomisation. Base class of all tasks."""
    SCALE = SCALE_STAND; EP = EP_STAND
    def __init__(self, randomize=True, push=True, seed=None):
        self.m = mujoco.MjModel.from_xml_path(os.path.join(PKG, 'mujoco', 'alpha2.xml')); self.d = mujoco.MjData(self.m)
        assert abs(self.m.opt.timestep - PHYS_DT) < 1e-9, 'mujoco/alpha2.xml timestep must be %g' % PHYS_DT
        qd = _q_default(); J, A, B, G = mujoco.mjtObj.mjOBJ_JOINT, mujoco.mjtObj.mjOBJ_ACTUATOR, mujoco.mjtObj.mjOBJ_BODY, mujoco.mjtObj.mjOBJ_GEOM
        names = list(qd)
        self.qadr = np.array([self.m.jnt_qposadr[mujoco.mj_name2id(self.m, J, n)] for n in names])
        self.act = np.array([mujoco.mj_name2id(self.m, A, 'act_' + n) for n in names])
        self.q0 = np.array([qd[n] for n in names]); self.lo = self.m.actuator_ctrlrange[self.act, 0]; self.hi = self.m.actuator_ctrlrange[self.act, 1]
        assert len(names) == 20
        self.gid = mujoco.mj_name2id(self.m, G, 'ground'); self.fb = [mujoco.mj_name2id(self.m, B, n) for n in ('r_ankle_roll_link', 'l_ankle_roll_link')]
        self.nom = dict(fric=self.m.geom_friction.copy(), mass=self.m.body_mass.copy(), inert=self.m.body_inertia.copy(),
                        gain=self.m.actuator_gainprm.copy(), bias=self.m.actuator_biasprm.copy(), frc=self.m.actuator_forcerange.copy())
        self.randomize, self.push = randomize, push
        self.pleft, self.pvec = 0.0, np.zeros(2)
        self.observation_space = spaces.Box(-np.inf, np.inf, (OBS_DIM,), np.float32); self.action_space = spaces.Box(-1, 1, (20,), np.float32)
        self.rng = np.random.default_rng(seed); self.prev = np.zeros(20); self.cmd = np.zeros(3); self.cmd_fixed = None; self.t = 0; self.lat = 0; self.prev_ctrl = self.q0.copy()

    # ---- hooks of the tasks ----
    def target(self, t): return self.q0                 # base target the action is a residual around
    def phase(self):   # free-running clock (stand / walk); the player only needs to know whether a reference is loaded
        ph = 2 * np.pi * (self.t * CTRL_DT) / GAIT_PERIOD; return float(np.sin(ph)), float(np.cos(ph))
    def command(self): return np.zeros(3)

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
        return np.concatenate([d.qpos[self.qadr] - self.q0, self.prev, g, self.command(), self.phase(), self.target(self.t) - self.q0]).astype(np.float32)

    def reset(self, seed=None, options=None):
        if seed is not None: self.rng = np.random.default_rng(seed)
        self._dr(); d = self.d; mujoco.mj_resetData(self.m, d)
        d.qpos[:7] = [0, 0, 0.2206 + 0.0015, 1, 0, 0, 0]; d.qpos[self.qadr] = self.q0; d.ctrl[self.act] = self.q0
        if self.randomize: d.qpos[self.qadr] += self.rng.normal(0, 0.03, 20)
        mujoco.mj_forward(self.m, d); self.t = 0; self.pleft = 0.0; self.prev[:] = 0; self.prev_ctrl = self.q0.copy()
        self.lat = 5 * int(self.rng.integers(0, 3)) if self.randomize else 0      # command latency 0 / 10 / 20 ms inside the 100 ms step
        return self._obs(), {}

    def _maybe_push(self):   # random horizontal push on the body: every 2 s with probability push_prob, push_force N held push_steps * 0.02 s
        if self.push and self.t % PUSH_EVERY == PUSH_EVERY // 2 and self.rng.random() < CFG['push_prob']:
            self.pvec = self.rng.uniform(-1, 1, 2) * CFG['push_force']; self.pleft = CFG['push_steps'] * 0.02

    def _sim(self, ctrl):
        """DECIM physics steps with the commanded targets (new targets arrive `lat` physics steps late), the push, and foot-contact bookkeeping.
        returns the fraction of the control step spent in single support"""
        d = self.d; self._maybe_push(); nph = min(DECIM, int(np.ceil(self.pleft / PHYS_DT - 1e-9))) if self.pleft > 0 else 0
        if nph: d.xfrc_applied[1, :2] = self.pvec
        single = 0; n = 0
        for k in range(DECIM):
            if nph and k == nph: d.xfrc_applied[1, :2] = 0
            d.ctrl[self.act] = self.prev_ctrl if k < self.lat else ctrl
            mujoco.mj_step(self.m, d)
            if k % 5 == 4: n += 1; single += self._feet() == 1
        self.pleft = max(0.0, self.pleft - nph * PHYS_DT); self.prev_ctrl = ctrl
        d.xfrc_applied[:] = 0
        return single / max(n, 1)

    def _feet(self):   # number of feet touching the ground
        f = set()
        for c in self.d.contact[:self.d.ncon]:
            b = self.m.geom_bodyid[c.geom2] if c.geom1 == self.gid else self.m.geom_bodyid[c.geom1] if c.geom2 == self.gid else -1
            if b in self.fb: f.add(b)
        return len(f)

    def _apply(self, a):
        a = np.clip(a, -1, 1).astype(np.float64)
        return a, np.clip(self.target(self.t) + self.SCALE * a, self.lo, self.hi)

    def _tilt(self):
        zz = self.d.xmat[1].reshape(3, 3)[2, 2]; return float(np.arccos(np.clip(zz, -1, 1)))

    def step(self, a):
        a, ctrl = self._apply(a); self._sim(ctrl); d = self.d; self.t += 1
        tilt = self._tilt(); z = d.qpos[2]; fallen = z < FALL_Z or tilt > FALL_TILT
        dq = d.qpos[self.qadr] - self.q0
        r = 1.0 - CFG['w_tilt'] * tilt ** 2 - CFG['w_pose'] * np.sum(dq ** 2) - CFG['w_smooth'] * np.sum((a - self.prev) ** 2) - CFG['w_torque'] * np.sum(d.actuator_force[self.act] ** 2) - 0.5 * np.sum(d.qvel[:2] ** 2)
        self.prev = a.copy()
        return self._obs(), float(-5.0 if fallen else r), bool(fallen), self.t >= self.EP, {}


def _sample_command(rng, vmax):
    """velocity command like mjlab_microban: 15 % stand still, 15 % turn on the spot, otherwise a random (vx, vy, wz)"""
    u = rng.random(); vx, vy, wz = vmax
    if u < 0.15: return np.zeros(3)
    if u < 0.30: return np.array([0, 0, rng.choice([-1, 1]) * rng.uniform(0.5, 1.0) * wz])
    c = np.array([rng.uniform(-vx, vx), rng.uniform(-vy, vy), rng.uniform(-wz, wz)])
    return c if np.any(np.abs(c) > [0.15 * vx, 0.15 * vy, 0.15 * wz]) else np.zeros(3)


class WalkEnv(Alpha2Env):
    """Velocity walking: track a commanded (vx, vy, wz) in the heading frame - forward, backward, sideways and turning, changing every 4 s
    (like Rhoban/mjlab_microban's velocity task, but with the Alpha 2's sensors: gravity only, no angular velocity).  No reference motion.
    Reward = velocity tracking (exp kernels) + single-support (gait) bonus while walking + alive - tilt / pose / smoothness / torque penalties.
    A free-running gait clock (period GAIT_PERIOD) is given as phase features.
    Set env.cmd_fixed = (vx, vy, wz) to hold one command (evaluation / play)."""
    SCALE = SCALE_WALK; EP = EP_WALK
    SIG_LIN, SIG_ANG = 0.03, 0.3
    def command(self): return self.cmd
    def _new_cmd(self):
        self.cmd = np.array(self.cmd_fixed, float) if self.cmd_fixed is not None else _sample_command(self.rng, (CFG['cmd_vx'], CFG['cmd_vy'], CFG['cmd_wz']))
    def reset(self, seed=None, options=None):
        super().reset(seed=seed); self._new_cmd(); return self._obs(), {}
    def step(self, a):
        a, ctrl = self._apply(a); single = self._sim(ctrl); d = self.d; self.t += 1
        R = d.xmat[1].reshape(3, 3); yaw = np.arctan2(R[1, 0], R[0, 0]); c, s = np.cos(yaw), np.sin(yaw)
        vb = np.array([c * d.qvel[0] + s * d.qvel[1], -s * d.qvel[0] + c * d.qvel[1]]); wz = float((R @ d.qvel[3:6])[2])
        tilt = self._tilt(); z = d.qpos[2]; fallen = z < FALL_Z or tilt > FALL_TILT
        walking = bool(np.any(np.abs(self.cmd) > 1e-6)); dq = d.qpos[self.qadr] - self.q0
        r_lin = np.exp(-np.sum((self.cmd[:2] - vb) ** 2) / self.SIG_LIN ** 2); r_ang = np.exp(-(self.cmd[2] - wz) ** 2 / self.SIG_ANG ** 2)
        r = (0.2 + CFG['w_track'] * (r_lin + r_ang) + (CFG['w_air'] * single if walking else 0.0)
             - CFG['w_tilt'] * tilt ** 2 - CFG['w_pose'] * (0.3 if walking else 1.0) * np.sum(dq ** 2)
             - CFG['w_smooth'] * np.sum((a - self.prev) ** 2) - CFG['w_torque'] * np.sum(d.actuator_force[self.act] ** 2) - 0.05 * np.sum(d.qvel[3:5] ** 2))
        self.prev = a.copy(); self.vb, self.wz = vb, wz
        if self.t % CMD_EVERY == 0: self._new_cmd()
        return self._obs(), float(-5.0 if fallen else r), bool(fallen), self.t >= self.EP, {}


class WalkRefEnv(Alpha2Env):
    """Imitation walking (the previous 'walk'): track the official forward .ubx walk (rl/ref/*.json from rl/make_ref.mjs); the policy outputs a residual
    around the reference joint targets so it can balance. The reference = start-up, then the exact gait loop repeated.  Forward only."""
    SCALE = SCALE_REF; EP = EP_WALK
    def __init__(self, ref=os.path.join(PKG, 'rl', 'ref', 'forward.json'), **kw):
        super().__init__(**kw); self.ref, self.rdt, self.loop = load_ref(ref); assert self.loop
    def target(self, t): return ref_at(self.ref, self.rdt, self.loop, t)
    def phase(self):
        a, b = self.loop; x = self.t * CTRL_DT / self.rdt
        if x < a: return 0.0, 0.0
        ph = 2 * np.pi * (x - a) / (b - a); return float(np.sin(ph)), float(np.cos(ph))
    def reset(self, seed=None, options=None):
        super().reset(seed=seed); d = self.d; q0 = self.target(0); d.qpos[self.qadr] = q0; d.ctrl[self.act] = q0; self.prev_ctrl = q0.copy()
        if self.randomize: d.qpos[self.qadr] += self.rng.normal(0, 0.02, 20)
        mujoco.mj_forward(self.m, d); self.t = 0; return self._obs(), {}
    def step(self, a):
        a, ctrl = self._apply(a); qr = self.target(self.t); self._sim(ctrl); d = self.d; self.t += 1
        tilt = self._tilt(); z = d.qpos[2]; fallen = z < FALL_Z or tilt > FALL_TILT
        err = np.mean((d.qpos[self.qadr] - qr) ** 2)
        r = 0.5 + CFG['w_track'] * np.exp(-60 * err) - CFG['w_tilt'] * tilt ** 2 - CFG['w_smooth'] * np.sum((a - self.prev) ** 2) - CFG['w_torque'] * np.sum(d.actuator_force[self.act] ** 2) - 0.5 * d.qvel[1] ** 2
        self.prev = a.copy()
        return self._obs(), float(-5.0 if fallen else r), bool(fallen), self.t >= self.EP, {}


GETUP_QUAT = {'back': [np.sqrt(.5), 0, -np.sqrt(.5), 0], 'front': [np.sqrt(.5), 0, np.sqrt(.5), 0]}   # lying on the back (face up) / on the front (face down); body x = front, z = up
REF_DEFAULT = {'walk_ref': 'forward.json', 'getup_back': 'backstand.json', 'getup_front': 'frontstand.json'}


class GetUpEnv(Alpha2Env):
    """Get up from lying on the floor and stay standing.  mode 'back' = lying on the back, face up / head up (official action BackStand, 8 s)
    or 'front' = lying on the front, face down (official action FrontStand, 11.3 s).  Like WalkRefEnv the policy outputs a residual around the
    reference joint targets (rl/ref/backstand.json | frontstand.json from rl/make_ref.mjs); after the reference ends its last pose is held.
    phase features = (t / T (<= 1), 1 once the reference is over).  Episode = the reference + HOLD control steps (the robot has to be up and stay up).
    No termination on falling (it starts on the floor); reward = reference tracking + height/upright progress + a bonus while standing."""
    SCALE, HOLD, SETTLE = SCALE_REF, 30, 10     # HOLD = 3 s standing after the reference, SETTLE = 1 s lying on the floor first
    def __init__(self, mode='back', ref=None, **kw):
        super().__init__(**kw); self.mode = mode
        self.ref, self.rdt, _ = load_ref(ref or os.path.join(PKG, 'rl', 'ref', REF_DEFAULT['getup_' + mode]))
        self.T = int(np.ceil((len(self.ref) - 1) * self.rdt / CTRL_DT)) + 1; self.EP = self.T + self.HOLD
    def target(self, t): return ref_at(self.ref, self.rdt, None, t)
    def phase(self): return min(self.t / self.T, 1.0), 1.0 if self.t >= self.T else 0.0
    def standing(self):
        d = self.d; return bool(d.xmat[1].reshape(3, 3)[2, 2] > np.cos(np.radians(20)) and d.qpos[2] > 0.19)
    def reset(self, seed=None, options=None):
        super().reset(seed=seed); m, d, rng = self.m, self.d, self.rng
        mujoco.mj_resetData(m, d)
        q = np.array(GETUP_QUAT[self.mode], float); n = 0.0; q0 = self.target(0)
        if self.randomize:   # random heading and a few degrees of tilt
            yaw = np.zeros(4); mujoco.mju_axisAngle2Quat(yaw, np.array([0.0, 0, 1]), rng.uniform(-0.35, 0.35)); tmp = np.zeros(4); mujoco.mju_mulQuat(tmp, yaw, q); q = tmp
            tilt = np.zeros(4); mujoco.mju_axisAngle2Quat(tilt, np.array([1.0, 0, 0]), rng.normal(0, 0.05)); tmp = np.zeros(4); mujoco.mju_mulQuat(tmp, q, tilt); q = tmp
            n = rng.uniform(0, 0.02)
        d.qpos[:7] = [0, 0, 0.10 + n, *q]; d.qpos[self.qadr] = q0 + (rng.normal(0, 0.02, 20) if self.randomize else 0); d.ctrl[self.act] = q0; self.prev_ctrl = q0.copy()
        mujoco.mj_forward(m, d)
        for _ in range(self.SETTLE * DECIM):   # 1 s lying on the floor, holding the first reference pose
            d.ctrl[self.act] = q0; mujoco.mj_step(m, d)
        self.t = 0; self.pleft = 0.0; self.prev[:] = 0
        return self._obs(), {}
    def _maybe_push(self):   # pushes only make sense once the robot should be standing
        if self.t >= self.T: super()._maybe_push()
    def step(self, a):
        a, ctrl = self._apply(a); qr = self.target(self.t); self._sim(ctrl); d = self.d; self.t += 1
        zz = d.xmat[1].reshape(3, 3)[2, 2]; z = d.qpos[2]; err = np.mean((d.qpos[self.qadr] - qr) ** 2)
        prog = 0.5 * max(zz, 0.0) + 0.5 * min(z / 0.216, 1.0)
        r = CFG['w_track'] * np.exp(-30 * err) + CFG['w_up'] * prog + CFG['w_stand'] * float(self.standing()) - CFG['w_smooth'] * np.sum((a - self.prev) ** 2) - CFG['w_torque'] * np.sum(d.actuator_force[self.act] ** 2)
        self.prev = a.copy()
        return self._obs(), float(r), False, self.t >= self.EP, {}


TASKS = ('stand', 'walk', 'walk_ref', 'getup_back', 'getup_front')
def make_env(task, ref=None, **kw):
    """environment of a training task: stand | walk | walk_ref | getup_back | getup_front"""
    if task == 'stand': return Alpha2Env(**kw)
    if task == 'walk': return WalkEnv(**kw)
    if task == 'walk_ref': return WalkRefEnv(ref=ref or os.path.join(PKG, 'rl', 'ref', REF_DEFAULT['walk_ref']), **kw)
    if task in ('getup_back', 'getup_front'): return GetUpEnv(mode=task[6:], ref=ref, **kw)
    raise ValueError('unknown task ' + task)
