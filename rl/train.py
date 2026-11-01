"""PPO training for Alpha2Env on CPU (GitHub Actions). Saves checkpoints + policy.onnx.
  python rl/train.py --minutes 300 --out rl/out [--resume rl/out/model.zip]"""
import argparse, os, time, numpy as np, torch
from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import SubprocVecEnv, DummyVecEnv
from stable_baselines3.common.callbacks import BaseCallback
from alpha2_env import Alpha2Env

class Budget(BaseCallback):   # stop + checkpoint when the wall-clock budget is used up
    def __init__(self, minutes, out, every=600):
        super().__init__(); self.end = time.time() + minutes * 60; self.out, self.every, self.last = out, every, time.time()
    def _on_step(self):
        if time.time() - self.last > self.every:
            self.model.save(os.path.join(self.out, 'model')); self.last = time.time()
            print(f'[ckpt] {self.num_timesteps} steps', flush=True)
        return time.time() < self.end

def export_onnx(model, path):
    pol = model.policy.eval().cpu()
    class Actor(torch.nn.Module):
        def __init__(s): super().__init__(); s.p = pol
        def forward(s, obs):
            f = s.p.mlp_extractor.forward_actor(s.p.extract_features(obs, s.p.pi_features_extractor)); return torch.clamp(s.p.action_net(f), -1, 1)
    torch.onnx.export(Actor(), torch.zeros(1, 43), path, input_names=['obs'], output_names=['action'], dynamic_axes={'obs': {0: 'batch'}, 'action': {0: 'batch'}}, opset_version=17, dynamo=False)

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--minutes', type=float, default=20); ap.add_argument('--out', default='rl/out')
    ap.add_argument('--resume', default=''); ap.add_argument('--envs', type=int, default=os.cpu_count() or 2); ap.add_argument('--seed', type=int, default=0)
    a = ap.parse_args(); os.makedirs(a.out, exist_ok=True); torch.set_num_threads(1)
    mk = lambda i: (lambda: Alpha2Env(seed=a.seed * 1000 + i))
    env = (SubprocVecEnv if a.envs > 1 else DummyVecEnv)([mk(i) for i in range(a.envs)])
    if a.resume and os.path.exists(a.resume): model = PPO.load(a.resume, env=env); print('resumed', a.resume)
    else: model = PPO('MlpPolicy', env, n_steps=256, batch_size=1024, learning_rate=3e-4, gamma=0.99, ent_coef=0.0, seed=a.seed, verbose=1,
                      policy_kwargs=dict(net_arch=dict(pi=[128, 128], vf=[128, 128]), activation_fn=torch.nn.Tanh, log_std_init=-1.0))
    model.learn(total_timesteps=10**10, callback=Budget(a.minutes, a.out), reset_num_timesteps=False, log_interval=10)
    model.save(os.path.join(a.out, 'model')); export_onnx(model, os.path.join(a.out, 'policy.onnx'))
    ev = Alpha2Env(); L = []
    for ep in range(10):
        o, _ = ev.reset(seed=ep); n = 0
        while True:
            o, r, te, tr, _ = ev.step(model.predict(o, deterministic=True)[0]); n += 1
            if te or tr: break
        L.append(n)
    print('eval episode length (500 = never fell):', L, 'mean', np.mean(L))
