"""PPO training for Alpha2Env on CPU (GitHub Actions). Saves checkpoints + policy.onnx.
  python rl/train.py --minutes 300 --out rl/out [--resume rl/out/model.zip]"""
import argparse, os, time, json, numpy as np, torch
from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import SubprocVecEnv, DummyVecEnv, VecMonitor
from stable_baselines3.common.callbacks import BaseCallback
import alpha2_env as E
from alpha2_env import CFG, make_env, REF_DEFAULT, TASKS, OBS_DIM, OBS_LAYOUT, CTRL_DT

class Budget(BaseCallback):   # stop + checkpoint when the wall-clock budget is used up; also records the learning curve
    def __init__(self, minutes, out, every=600, curve=None, curve_every=10):
        super().__init__(); self.end = time.time() + minutes * 60; self.out, self.every, self.last = out, every, time.time()
        self.curve, self.curve_every, self.it = curve if curve is not None else [], curve_every, 0
        self.t0, self.s0 = time.time(), (self.curve[-1]['s'] if self.curve else 0)    # training seconds continue across resumed runs
    def _on_rollout_end(self):   # every PPO iteration (n_envs * n_steps env steps)
        self.it += 1
        buf = self.model.ep_info_buffer
        if self.it % self.curve_every == 0 and len(buf) > 0:
            self.curve.append(dict(t=int(self.num_timesteps), s=int(self.s0 + time.time() - self.t0),
                                   len=round(float(np.mean([e['l'] for e in buf])), 1), rew=round(float(np.mean([e['r'] for e in buf])), 2)))
    def save_curve(self): json.dump(self.curve, open(os.path.join(self.out, 'curve.json'), 'w'), separators=(',', ':'))
    def _on_step(self):
        if time.time() - self.last > self.every:
            self.model.save(os.path.join(self.out, 'model')); self.save_curve(); self.last = time.time()
            print(f'[ckpt] {self.num_timesteps} steps', flush=True)
        return time.time() < self.end

def export_onnx(model, path, nobs=OBS_DIM, scale=0.3):
    """obs (1, 68) -> action (clamped to -1..1; feed it back into obs[20:40]) and delta (= scale * action in rad).  The web player applies for every
    task  ctrl = q_default + obs[48:68] + delta  so it needs no task-specific constants."""
    pol = model.policy.eval().cpu()
    class Actor(torch.nn.Module):
        def __init__(s): super().__init__(); s.p = pol
        def forward(s, obs):
            f = s.p.mlp_extractor.forward_actor(s.p.extract_features(obs, s.p.pi_features_extractor)); a = torch.clamp(s.p.action_net(f), -1, 1); return a, a * scale
    torch.onnx.export(Actor(), torch.zeros(1, nobs), path, input_names=['obs'], output_names=['action', 'delta'],
                      dynamic_axes={'obs': {0: 'batch'}, 'action': {0: 'batch'}, 'delta': {0: 'batch'}}, opset_version=17, dynamo=False)

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--minutes', type=float, default=20); ap.add_argument('--out', default='rl/out')
    ap.add_argument('--task', default='stand', choices=list(TASKS)); ap.add_argument('--ref', default=None, help='reference json (default: rl/ref/ of the task)')
    ap.add_argument('--resume', default=''); ap.add_argument('--envs', type=int, default=os.cpu_count() or 2); ap.add_argument('--seed', type=int, default=0)
    a = ap.parse_args(); os.makedirs(a.out, exist_ok=True); torch.set_num_threads(1); print('env cfg:', CFG, flush=True)
    if a.task in REF_DEFAULT and not a.ref: a.ref = os.path.join(E.PKG, 'rl', 'ref', REF_DEFAULT[a.task])
    getup = a.task.startswith('getup')
    mk = lambda i: (lambda: make_env(a.task, ref=a.ref, seed=a.seed * 1000 + i))
    env = VecMonitor((SubprocVecEnv if a.envs > 1 else DummyVecEnv)([mk(i) for i in range(a.envs)]))   # VecMonitor -> rollout/ep_len_mean, ep_rew_mean in the log + learning curve (SB3 does not add it to a VecEnv by itself)
    curve = []
    if a.resume and os.path.exists(a.resume):
        model = PPO.load(a.resume, env=env); print('resumed', a.resume)
        try: curve = [c for c in json.load(open(os.path.join(a.out, 'curve.json'))) if c['t'] <= model.num_timesteps]   # keep the earlier part of the curve
        except (OSError, ValueError, KeyError, TypeError): curve = []
    else: model = PPO('MlpPolicy', env, n_steps=256, batch_size=1024, learning_rate=3e-4, gamma=0.99, ent_coef=0.0, seed=a.seed, verbose=1,
                      policy_kwargs=dict(net_arch=dict(pi=[128, 128], vf=[128, 128]), activation_fn=torch.nn.Tanh, log_std_init=-1.0))
    cb = Budget(a.minutes, a.out, curve=curve)
    model.learn(total_timesteps=10**10, callback=cb, reset_num_timesteps=False, log_interval=10)
    model.save(os.path.join(a.out, 'model')); cb.save_curve(); export_onnx(model, os.path.join(a.out, 'policy.onnx'), env.observation_space.shape[0], env.get_attr('SCALE')[0])
    if a.ref: import shutil; shutil.copy(a.ref, os.path.join(a.out, 'ref.json'))   # the web player needs the same reference
    ev = make_env(a.task, ref=a.ref); L = []; X = []; S = []; EPMAX = ev.EP; extra = {}
    if a.task == 'walk':   # velocity walk: hold each command for one episode, report survival and velocity tracking error (heading frame)
        vx, vy, wz = CFG['cmd_vx'], CFG['cmd_vy'], CFG['cmd_wz']
        cmds = [(vx, 0, 0), (-vx, 0, 0), (0, vy, 0), (0, -vy, 0), (0, 0, wz), (0, 0, -wz), (0, 0, 0)]; rows = []
        for ci, c in enumerate(cmds):
            ev.cmd_fixed = c; o, _ = ev.reset(seed=ci); n = 0; el, ea = [], []
            while True:
                o, r, te, tr, _ = ev.step(model.predict(o, deterministic=True)[0]); n += 1
                if n > 20: el.append(float(np.hypot(c[0] - ev.vb[0], c[1] - ev.vb[1]))); ea.append(abs(c[2] - ev.wz))   # skip the first 2 s (start-up)
                if te or tr: break
            L.append(n); X.append(ev.d.qpos[0]); rows.append(dict(cmd=list(c), len=n, lin_err=round(float(np.mean(el)) if el else 0, 4), ang_err=round(float(np.mean(ea)) if ea else 0, 3), x=round(float(ev.d.qpos[0]), 3), y=round(float(ev.d.qpos[1]), 3)))
            print('  cmd (vx %+.2f vy %+.2f wz %+.2f): len %d/%d  lin err %.3f m/s  ang err %.3f rad/s  moved x %+.3f y %+.3f' % (*c, n, EPMAX, rows[-1]['lin_err'], rows[-1]['ang_err'], rows[-1]['x'], rows[-1]['y']), flush=True)
        extra['velocity_eval'] = rows; ev.cmd_fixed = None
    else:
        for ep in range(10):
            o, _ = ev.reset(seed=ep); n = 0
            while True:
                o, r, te, tr, _ = ev.step(model.predict(o, deterministic=True)[0]); n += 1
                if te or tr: break
            L.append(n); X.append(ev.d.qpos[0]); S.append(ev.standing() if getup else None)
    if a.task == 'walk_ref':   # baseline: zero residual = replay the reference open loop
        B = []; Bx = []
        for ep in range(10):
            ev.reset(seed=ep); n = 0
            while True:
                _, r, te, tr, _ = ev.step(np.zeros(20)); n += 1
                if te or tr: break
            B.append(n); Bx.append(ev.d.qpos[0])
        print('baseline (zero residual) episode length:', B, 'mean', np.mean(B), '| final x [m]:', np.round(Bx, 2).tolist())
    if getup:   # success = standing at the end of the episode; baseline = replay of the official action (zero residual)
        BS = []
        for ep in range(10): ev.reset(seed=ep); [ev.step(np.zeros(20)) for _ in range(ev.EP)]; BS.append(ev.standing())
        print('get-up success (standing at the end): policy %d/10, official-action replay %d/10' % (sum(S), sum(BS)))
    print('eval episode length (max %d = never fell):' % EPMAX, L, 'mean', np.mean(L), '| final x [m]:', np.round(X, 2).tolist())
    meta = dict(task=a.task, seed=a.seed, cfg=CFG, timesteps=int(model.num_timesteps), eval_max_len=EPMAX,
                eval_lens=[int(x) for x in L], eval_mean_len=float(np.mean(L)), eval_final_x=[round(float(x), 3) for x in X],
                ctrl_dt=CTRL_DT, obs_dim=OBS_DIM, obs_layout=OBS_LAYOUT, act_scale=float(ev.SCALE), **extra)
    if a.task == 'walk_ref': meta['baseline_mean_len'] = float(np.mean(B))
    if getup: meta.update(success=float(np.mean(S)), baseline_success=float(np.mean(BS)))
    json.dump(meta, open(os.path.join(a.out, 'meta.json'), 'w'), indent=1)   # picked up by .github/workflows/train.yml -> policies branch
