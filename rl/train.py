"""PPO training for Alpha2Env on CPU (GitHub Actions). Saves checkpoints + policy.onnx.
  python rl/train.py --minutes 300 --out rl/out [--resume rl/out/model.zip]"""
import argparse, os, time, json, numpy as np, torch
from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import SubprocVecEnv, DummyVecEnv, VecMonitor
from stable_baselines3.common.callbacks import BaseCallback
import alpha2_env as E
from alpha2_env import Alpha2Env, WalkEnv, CFG, make_env, REF_DEFAULT

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

def export_onnx(model, path, nobs=43):
    pol = model.policy.eval().cpu()
    class Actor(torch.nn.Module):
        def __init__(s): super().__init__(); s.p = pol
        def forward(s, obs):
            f = s.p.mlp_extractor.forward_actor(s.p.extract_features(obs, s.p.pi_features_extractor)); return torch.clamp(s.p.action_net(f), -1, 1)
    torch.onnx.export(Actor(), torch.zeros(1, nobs), path, input_names=['obs'], output_names=['action'], dynamic_axes={'obs': {0: 'batch'}, 'action': {0: 'batch'}}, opset_version=17, dynamo=False)

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--minutes', type=float, default=20); ap.add_argument('--out', default='rl/out')
    ap.add_argument('--task', default='stand', choices=['stand', 'walk', 'getup_back', 'getup_front']); ap.add_argument('--ref', default=None, help='reference json (default: rl/ref/ of the task)')
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
    model.save(os.path.join(a.out, 'model')); cb.save_curve(); export_onnx(model, os.path.join(a.out, 'policy.onnx'), env.observation_space.shape[0])
    if a.ref: import shutil; shutil.copy(a.ref, os.path.join(a.out, 'ref.json'))   # the web player needs the same reference
    ev = make_env(a.task, ref=a.ref); L = []; X = []; S = []
    for ep in range(10):
        o, _ = ev.reset(seed=ep); n = 0
        while True:
            o, r, te, tr, _ = ev.step(model.predict(o, deterministic=True)[0]); n += 1
            if te or tr: break
        L.append(n); X.append(ev.d.qpos[0]); S.append(ev.standing() if getup else None)
    if a.task == 'walk':   # baseline: zero residual = replay the reference open loop
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
    print('eval episode length (max %d = never fell):' % (ev.EP if getup else 1000 if a.task == 'walk' else 500), L, 'mean', np.mean(L), '| final x [m]:', np.round(X, 2).tolist())
    meta = dict(task=a.task, seed=a.seed, cfg=CFG, timesteps=int(model.num_timesteps), eval_max_len=(ev.EP if getup else 1000 if a.task == 'walk' else 500),
                eval_lens=[int(x) for x in L], eval_mean_len=float(np.mean(L)), eval_final_x=[round(float(x), 3) for x in X])
    if a.task == 'walk': meta['baseline_mean_len'] = float(np.mean(B))
    if getup: meta.update(success=float(np.mean(S)), baseline_success=float(np.mean(BS)))
    json.dump(meta, open(os.path.join(a.out, 'meta.json'), 'w'), indent=1)   # picked up by .github/workflows/train.yml -> policies branch
