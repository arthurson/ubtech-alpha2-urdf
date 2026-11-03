"""Dump env states + the expected observation / ctrl of every task for the JS parity test (web/tools/test-policy.mjs):
  python rl/dump_parity.py /tmp/parity.json && node web/tools/test-policy.mjs /tmp/parity.json"""
import os, sys, json
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import alpha2_env as E

out = {'q0': None, 'tasks': {}}
rng = np.random.default_rng(0)
for task in E.TASKS:
    env = E.make_env(task, randomize=False, push=False, seed=0); o, _ = env.reset(seed=0); out['q0'] = env.q0.tolist(); rows = []
    if task == 'walk': env.cmd_fixed = (0.04, -0.02, 0.3)
    n_total = 0
    while len(rows) < 14:
        if n_total % 9 == 0 or n_total < 3:   # states along the rollout (also across the loop wrap / reference end)
            a = rng.uniform(-1, 1, 20) * 0.7                        # the action the (mock) policy outputs in this state
            qpos = env.d.qpos[env.qadr].tolist(); R = env.d.xmat[1].tolist(); expect_obs = env._obs().tolist()
            ctrl = np.clip(env.target(env.t) + env.SCALE * np.clip(a, -1, 1), env.lo, env.hi).tolist()
            rows.append(dict(k=env.t, qpos=qpos, xmat=R, prev=env.prev.tolist(), cmd=env.command().tolist(), obs=expect_obs, action=a.tolist(), delta=(env.SCALE * np.clip(a, -1, 1)).tolist(), ctrl=ctrl,
                             lo=env.lo.tolist(), hi=env.hi.tolist()))
        o, r, te, tr, _ = env.step(rng.uniform(-1, 1, 20) * 0.5); n_total += 1
        if te or tr: o, _ = env.reset(seed=n_total)
        if n_total > 600: break
    ref = None
    if task in ('walk_ref', 'getup_back', 'getup_front'): ref = json.load(open(os.path.join(E.PKG, 'rl', 'ref', E.REF_DEFAULT[task])))
    out['tasks'][task] = dict(rows=rows, ref=ref)
json.dump(out, open(sys.argv[1] if len(sys.argv) > 1 else '/tmp/parity.json', 'w'))
print('dumped', {t: len(v['rows']) for t, v in out['tasks'].items()})
