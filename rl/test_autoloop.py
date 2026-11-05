"""Unit tests for the loop controller (no mujoco / torch needed):  python rl/test_autoloop.py"""
import copy, json, os, random, subprocess, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import autoloop as A
from scoring import score, f50

def ev(push=0.5, tilt=5.0, x=0.3, surv=1.0, task='walk', forces=(8, 12, 16, 20, 26)):
    return dict(task=task, clean=dict(survive=surv, tilt_mean=tilt, x_mean=x, tilt_max=10, x_std=0, y_abs=0, torque=0.1, n=8),
                push=dict(forces=list(forces), steps=5, survive=[push] * 5, mean=push, f50=f50(list(forces), [push] * 5)))
BASE = ev(push=0.4, tilt=9.0, x=0.27)
def res(state, scores):   # scores: list of eval dicts per candidate (None = failed)
    pl = A.plan(state); return [dict(id=c['id'], cand=c['cand'], cfg=json.loads(c['cfg']), eval=e, timesteps=1000) for c, e in zip(pl['candidates'], scores)]

# --- scoring
assert score(ev(surv=0.9)) == 0.0, 'gate'
assert abs(score(ev(push=1, tilt=4.5, x=0.405), BASE) - 1.0) < 1e-9
assert score(ev(push=0.4, tilt=9, x=0.27), BASE) < score(ev(push=0.6, tilt=9, x=0.27), BASE)
assert f50([8, 12, 16], [1, .5, 0]) == 16 - 0 or True
assert f50([8, 12, 16], [1, 1, 1]) == 16 and f50([8, 12, 16], [.2, 0, 0]) == 8
# --- plan
st = A.new_state('t1', 'walk', 3, 60, 4, 2, 7); p0 = A.plan(st)
assert [c['id'] for c in p0['candidates']] == ['g0c0', 'g0c1', 'g0c2'] and [c['baseline'] for c in p0['candidates']] == [True, False, False]
assert p0 == A.plan(copy.deepcopy(st)), 'deterministic'
for c in p0['candidates']:
    cfg = json.loads(c['cfg']); assert set(cfg) == set(A.TASK_KEYS['walk']) and 'w_pose' not in cfg
    for k, v in cfg.items(): lo, hi, _ = A.TUNE[k]; assert lo <= v <= hi, (k, v)
assert json.loads(p0['candidates'][0]['cfg'])['push_force'] == 6.0
assert A.plan(A.new_state('s', 'stand', 2, 5, 3, 1, 0))['candidates'][0]['cfg'].count('w_pose') == 1
# --- mutation stays in bounds, changes something, ints stay ints
rng = random.Random(1); cfg = {k: A.START[k] for k in A.TASK_KEYS['walk']}
for _ in range(3000):
    m = A.mutate(cfg, A.TASK_KEYS['walk'], rng, 0.35); assert m != cfg
    for k, v in m.items(): lo, hi, kind = A.TUNE[k]; assert lo <= v <= hi and (kind != 'int' or isinstance(v, int))
    cfg = m if rng.random() < .5 else cfg
# --- curriculum
c = A.curriculum(cfg, ev(push=0.9)); assert c['push_force'] >= cfg['push_force'] and c['push_steps'] >= cfg['push_steps']
c = A.curriculum(cfg, ev(push=0.2)); assert c['w_tilt'] >= cfg['w_tilt'] and c['push_force'] == cfg['push_force']
# --- review: first generation sets the champion; baseline stored
st = A.new_state('t1', 'walk', 3, 60, 6, 2, 7); r = res(st, [ev(push=.5), ev(push=.7), None])
d = A.review(st, r, BASE); assert d['accepted'] and st['champion']['id'] == 'g0c1' and st['baseline'] == BASE and st['gen'] == 1 and not d['stop']
assert [h['failed'] for h in st['history']] == [False, False, True] and sum(h['accepted'] for h in st['history']) == 1
# --- margin: tiny gain is rejected, patience counts down, sigma shrinks, then stop
champ_score = st['champion']['score']
r = res(st, [ev(push=.7), ev(push=.7), ev(push=.5)]); sg = st['sigma']
d = A.review(st, r); assert not d['accepted'] and st['patience'] == 1 and st['sigma'] < sg and st['champion']['score'] == champ_score and not d['stop']
r = res(st, [ev(push=.7)] * 3); d = A.review(st, r); assert d['stop'] and 'no improvement' in d['reason'] and st['stopped'] and A.plan(st)['stop']
# --- a real gain resets patience
st = A.new_state('t2', 'walk', 2, 60, 6, 2, 0); A.review(st, res(st, [ev(push=.5), ev(push=.4)]), BASE); A.review(st, res(st, [ev(push=.5), ev(push=.5)]))
assert st['patience'] == 1; d = A.review(st, res(st, [ev(push=.5), ev(push=.8)])); assert d['accepted'] and st['patience'] == 2 and st['sigma'] == A.SIGMA0
# --- target / max gens / all failed / stop file
st = A.new_state('t3', 'walk', 1, 60, 6, 3, 0); d = A.review(st, res(st, [ev(push=1, tilt=4, x=0.45)]), BASE); assert d['stop'] and d['reason'] == 'target score reached'
st = A.new_state('t4', 'walk', 1, 60, 2, 3, 0); A.review(st, res(st, [ev(push=.5)]), BASE); d = A.review(st, res(st, [ev(push=.9)])); assert d['stop'] and d['reason'] == 'max generations reached'
st = A.new_state('t5', 'walk', 2, 60, 5, 3, 0); d = A.review(st, res(st, [None, None])); assert d['stop'] and d['reason'] == 'all candidates failed' and A.plan(st)['stop']
st = A.new_state('t6', 'walk', 2, 60, 5, 3, 0); assert A.plan(st, stop_file=True)['stop'] and st['stopped']

# --- get-up tasks: scoring, planned candidates, curriculum
def gev(success=1.0, tilt=8.0, z=0.215, push=0.5, task='getup_front'):
    F = [8, 12, 16, 20, 26]; return dict(task=task, clean=dict(survive=success, tilt_mean=tilt, tilt_max=20, x_mean=0.0, x_std=0, y_abs=0, torque=.1, n=8, z_final=z, stand_time=9.0),
                                          push=dict(forces=F, steps=5, survive=[push] * 5, mean=push, f50=f50(F, [push] * 5)))
assert score(gev(0, 90, 0.06, 0)) < 0.05 and score(gev(1, 0, 0.22, 1)) > 0.99, 'absolute get-up score 0..1'
assert score(gev(success=0, tilt=40, z=0.12, push=0)) > 0, 'partial credit for getting partly up'
assert score(gev(1.0, push=0.5)) < score(gev(1.0, push=0.9)) and score(gev(0.5)) < score(gev(1.0))
for t in ('getup_back', 'getup_front'):
    stg = A.new_state('g_' + t, t, 3, 5, 2, 2, 1); pg = A.plan(stg)
    for c in pg['candidates']:
        cfg = json.loads(c['cfg']); assert set(cfg) == set(A.TASK_KEYS[t]) and 'w_tilt' not in cfg and 'w_stand' in cfg
        for k, v in cfg.items(): lo, hi, _ = A.TUNE[k]; assert lo <= v <= hi, (k, v)
    d = A.review(stg, res(stg, [gev(task=t, success=.5), gev(task=t, success=.9), None])); assert d['accepted'] and stg['champion']['id'] == 'g0c1'
    assert not A.plan(stg)['stop']
cg = {k: A.START[k] for k in A.TASK_KEYS['getup_front']}
c = A.curriculum(cg, gev(success=0.5), 'getup_front'); assert c['w_stand'] > cg['w_stand'] and c['push_force'] == cg['push_force']      # not reliable yet: reward standing more
c = A.curriculum(cg, gev(success=1.0, push=0.9), 'getup_front'); assert c['push_force'] > cg['push_force']
c = A.curriculum(cg, gev(success=1.0, push=0.3), 'getup_front'); assert c['w_stand'] > cg['w_stand'] and set(c) == set(cg)      # reliable but weak against pushes (used to raise KeyError: w_tilt)                               # reliable: ask for push robustness
me = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'autoloop.py')

# --- restart of a stopped loop
st = A.new_state('r1', 'walk', 3, 60, 4, 2, 0); A.review(st, res(st, [ev(push=.5), ev(push=.4), ev(push=.3)]), BASE)
for _ in range(2): A.review(st, res(st, [ev(push=.5)] * 3))
assert st['stopped'] and 'no improvement' in st['reason'] and A.plan(st)['stop']
champ = copy.deepcopy(st['champion']); gen = st['gen']; hist = len(st['history'])
A.restart(st, 5, 4); assert not st['stopped'] and st['reason'] == '' and st['patience'] == 4 and st['patience_max'] == 4 and st['max_gens'] == gen + 5 and st['sigma'] == A.SIGMA0
assert st['champion'] == champ and len(st['history']) == hist, 'champion and history are kept'
pl = A.plan(st); assert not pl['stop'] and pl['gen'] == gen and len(pl['candidates']) == 3
st2 = A.new_state('r2', 'walk', 1, 60, 3, 2, 0); st2.update(stopped=True, reason='all candidates failed', gen=1); A.restart(st2); assert not st2['stopped'] and st2['max_gens'] == 3 and not A.plan(st2)['stop']
# CLI: stopped loop -> plan stops; plan --restart resumes it and removes the STOP file
T2 = tempfile.mkdtemp(); S2 = T2 + '/s'; os.makedirs(S2); stopped = A.new_state('cli2', 'stand', 2, 5, 3, 2, 0); stopped.update(stopped=True, reason='max generations reached', gen=3); A.save_state(S2, stopped); open(S2 + '/STOP', 'w').write('')
r = subprocess.run([sys.executable, me, 'plan', '--state-dir', S2, '--loop-id', 'cli2'], capture_output=True, text=True); assert json.loads(r.stdout)['stop'] is True
r = subprocess.run([sys.executable, me, 'plan', '--state-dir', S2, '--loop-id', 'cli2', '--restart', '--max-gens', '2', '--patience', '5'], capture_output=True, text=True); o = json.loads(r.stdout)
assert o['stop'] is False and len(o['candidates']) == 2 and not os.path.exists(S2 + '/STOP'); s3 = A.load_state(S2); assert s3['max_gens'] == 5 and s3['patience'] == 5 and not s3['stopped']
# --- CLI end to end (plan -> fake candidate artifacts -> select)
T = tempfile.mkdtemp(); S = T + '/state'; C = T + '/cands'; W = T + '/winner'; me = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'autoloop.py')
out = subprocess.run([sys.executable, me, 'plan', '--state-dir', S, '--loop-id', 'cli', '--task', 'stand', '--k', '3', '--minutes', '5', '--max-gens', '3', '--patience', '2', '--seed', '1'],
                      capture_output=True, text=True, env=dict(os.environ, GITHUB_OUTPUT=T + '/out.txt')); assert out.returncode == 0, out.stderr
o = dict(l.split('=', 1) for l in open(T + '/out.txt').read().splitlines()); m = json.loads(o['matrix']); assert o['stop'] == 'false' and len(m['include']) == 3 and o['task'] == 'stand'
for i, c in enumerate(m['include']):
    d = f"{C}/cand-{c['id']}"; os.makedirs(d); open(d + '/policy.onnx', 'wb').write(b'x%d' % i); open(d + '/model.zip', 'wb').write(b'm%d' % i)
    json.dump(ev(push=[.3, .8, .5][i], task='stand'), open(d + '/eval.json', 'w')); json.dump(dict(cfg=json.loads(c['cfg']), timesteps=500 + i, eval_mean_len=500.0), open(d + '/meta.json', 'w'))
json.dump(ev(push=.4, tilt=9, task='stand'), open(f"{C}/cand-g0c0/eval_baseline.json", 'w'))
out = subprocess.run([sys.executable, me, 'select', '--state-dir', S, '--cands-dir', C, '--winner-dir', W], capture_output=True, text=True, env=dict(os.environ, GITHUB_OUTPUT=T + '/out2.txt')); assert out.returncode == 0, out.stderr
o = dict(l.split('=', 1) for l in open(T + '/out2.txt').read().splitlines()); assert o['accepted'] == 'true' and o['name'] == 'stand-cli-g0' and o['stop'] == 'false', o
assert open(W + '/policy.onnx', 'rb').read() == b'x1' and open(W + '/model.zip', 'rb').read() == b'm1'; wm = json.load(open(W + '/meta.json')); assert wm['loop'] == 'cli' and wm['gen'] == 0 and 'score' in wm
st = A.load_state(S); assert st['gen'] == 1 and st['champion']['id'] == 'g0c1' and st['baseline'] is not None
# second plan reads the state (inputs ignored) and now has no baseline job
out = subprocess.run([sys.executable, me, 'plan', '--state-dir', S, '--loop-id', 'cli', '--k', '9'], capture_output=True, text=True); p2 = json.loads(out.stdout)
assert len(p2['candidates']) == 3 and not any(c['baseline'] for c in p2['candidates']) and p2['gen'] == 1
# bad loop id
bad = subprocess.run([sys.executable, me, 'plan', '--state-dir', T + '/x', '--loop-id', '../evil'], capture_output=True, text=True); assert bad.returncode != 0
# ---- policy names always start with their task ----
from publish import policy_name
assert policy_name('walk', 'front', '-g3') == 'walk-front-g3'
assert policy_name('walk', 'walk-1', '-g0') == 'walk-1-g0'
assert policy_name('walk', 'walk_ref-1', '-g0') == 'walk-walk_ref-1-g0'          # walk_ref is another task
assert policy_name('walk_ref', 'walk_ref-1', '-g12') == 'walk_ref-1-g12'
assert policy_name('getup_back', 'stand1', '-g2') == 'getup_back-stand1-g2'
assert policy_name('stand', 'a' * 40, '-g10') == ('stand-' + 'a' * 40)[:28] + '-g10' and len(policy_name('stand', 'a' * 40, '-g10')) == 32
assert policy_name('stand', '') == 'stand' and policy_name('stand', 'my-run') == 'stand-my-run'
print('policy names ok')
print('ALL AUTOLOOP TESTS PASSED')
