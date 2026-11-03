"""Quick checks of the get-up environments (needs mujoco):  python rl/test_getup.py"""
import os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import alpha2_env as E

for mode, must_stand in (('back', True), ('front', None)):
    env = E.make_env('getup_' + mode, randomize=False, push=False, seed=0); o, _ = env.reset(seed=0)
    assert o.shape == (E.OBS_DIM,) and env.observation_space.shape == (E.OBS_DIM,)
    zz = env.d.xmat[1].reshape(3, 3)[2, 2]; assert zz < 0.2 and env.d.qpos[2] < 0.08 and not env.standing(), 'starts lying on the floor'
    assert abs(o[46]) == 0 and o[47] == 0                                   # progress 0, reference not over
    n = 0
    while True:
        o, r, te, tr, _ = env.step(np.zeros(20)); n += 1
        if te or tr: break
    assert not te and n == env.EP == env.T + env.HOLD and o[46] == 1 and o[47] == 1
    if must_stand: assert env.standing(), 'the official BackStand replay gets up in the simulator'
    print(mode, 'ok: steps', n, 'standing at the end:', env.standing())
# pushes only after the reference is over
E.CFG.update(push_force=50.0, push_steps=3, push_prob=1.0)
env = E.make_env('getup_back', randomize=False, push=True, seed=0); env.reset(seed=0); seen = []
import mujoco; orig = mujoco.mj_step
def spy(m, d, *a, **k): seen.append(float(np.abs(d.xfrc_applied[1, :2]).sum()) > 0); return orig(m, d, *a, **k)
mujoco.mj_step = spy
for t in range(env.EP): env.step(np.zeros(20))
mujoco.mj_step = orig
first = next(i for i, v in enumerate(seen) if v) // E.DECIM
assert first >= env.T, 'no push while getting up (first push at control step %d, reference ends at %d)' % (first, env.T)
print('push only after the reference: ok (first push at step %d)' % first)
print('ALL GETUP ENV TESTS PASSED')
