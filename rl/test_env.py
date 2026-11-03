"""Checks of the unified observation / 100 ms control step / velocity walk (needs mujoco):  python rl/test_env.py"""
import os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import alpha2_env as E

assert E.CTRL_DT == 0.1 and E.DECIM * E.PHYS_DT == E.CTRL_DT
L = E.OBS_LAYOUT
for task in E.TASKS:
    env = E.make_env(task, randomize=False, push=False, seed=0); o, _ = env.reset(seed=0)
    assert o.shape == (E.OBS_DIM,) and env.observation_space.shape == (E.OBS_DIM,) and o.dtype == np.float32, task
    q = env.d.qpos[env.qadr]
    assert np.allclose(o[slice(*L['q'])], q - env.q0, atol=1e-6) and not o[slice(*L['prev_action'])].any(), task
    g = env.d.xmat[1].reshape(3, 3).T @ [0, 0, -1.0]; assert np.allclose(o[slice(*L['gravity'])], g, atol=1e-6), task
    if task in ('stand', 'walk'): assert not o[slice(*L['target'])].any(), 'no reference -> target block is zero'
    else: assert np.allclose(o[slice(*L['target'])], env.target(0) - env.q0, atol=1e-6)
    a = np.full(20, 0.5); o2, *_ = env.step(a); assert np.allclose(o2[slice(*L['prev_action'])], 0.5)
    print(task, 'obs ok')

# velocity walk: the command is in the observation, held for 4 s, resampled, never zero-range; fixed command works
env = E.make_env('walk', randomize=True, push=False, seed=5); o, _ = env.reset(seed=5); seen = [tuple(o[43:46])]
for t in range(1, 41 * 10):
    o, r, te, tr, _ = env.step(np.zeros(20))
    if te or tr: o, _ = env.reset()
    if t % E.CMD_EVERY == 0 and tuple(o[43:46]) != seen[-1]: seen.append(tuple(o[43:46]))
c = np.array(seen); assert len(seen) > 4
assert (np.abs(c[:, 0]) <= E.CFG['cmd_vx'] + 1e-9).all() and (np.abs(c[:, 1]) <= E.CFG['cmd_vy'] + 1e-9).all() and (np.abs(c[:, 2]) <= E.CFG['cmd_wz'] + 1e-9).all()
assert (np.abs(c).sum(1) == 0).any() and (np.abs(c).sum(1) > 0).any() and (c[:, 0] < 0).any() and (c[:, 1] < 0).any() and (c[:, 2] < 0).any() and (c[:, 0] > 0).any()
env = E.make_env('walk', randomize=False, push=False, seed=0); env.cmd_fixed = (0.04, -0.02, 0.3); o, _ = env.reset(seed=0)
for _ in range(E.CMD_EVERY + 1): o, *_ = env.step(np.zeros(20))
assert np.allclose(o[43:46], [0.04, -0.02, 0.3]); print('walk command ok:', len(seen), 'different commands seen')

# clock: free running, period GAIT_PERIOD (stand and walk)
env = E.make_env('walk', randomize=False, push=False, seed=0); o, _ = env.reset(seed=0); assert np.allclose(o[46:48], [0, 1])
n = int(round(E.GAIT_PERIOD / E.CTRL_DT))
for _ in range(n): o, *_ = env.step(np.zeros(20))
assert np.allclose(o[46:48], [0, 1], atol=1e-6); print('gait clock ok')

# the zero-residual replay of the official forward walk still walks (reference resampled from 50 Hz to the 100 ms step)
print('ref resampling: walk_ref zero residual travels', end=' ')
env = E.make_env('walk_ref', randomize=False, push=False, seed=0); env.reset(seed=0)
while True:
    _, r, te, tr, _ = env.step(np.zeros(20))
    if te or tr: break
assert not te and 0.2 < env.d.qpos[0] < 0.35, env.d.qpos[0]; print('x = %.3f m in %d steps (official walk, same as the 20 ms version)' % (env.d.qpos[0], env.t))

# push: held push_steps * 0.02 s, in the first physics steps of a control step
E.CFG.update(push_force=10.0, push_steps=2.0, push_prob=1.0)
import mujoco; orig = mujoco.mj_step; log = []
def spy(m, d, *a, **k): log.append(float(np.abs(d.xfrc_applied[1, :2]).sum()) > 0); return orig(m, d, *a, **k)
env = E.make_env('stand', randomize=False, push=True, seed=0); env.reset(seed=0); mujoco.mj_step = spy
for t in range(E.PUSH_EVERY): env.step(np.zeros(20))
mujoco.mj_step = orig
on = sum(log); assert on == 20, on          # 2 * 0.02 s / 0.002 s = 20 physics steps
assert log[:E.PUSH_EVERY // 2 * E.DECIM].count(True) == 0 and log[E.PUSH_EVERY // 2 * E.DECIM: E.PUSH_EVERY // 2 * E.DECIM + 20] == [True] * 20
print('push duration ok: %d physics steps = %.0f ms' % (on, on * E.PHYS_DT * 1000))
print('ALL ENV TESTS PASSED')
