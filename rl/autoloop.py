"""Controller of the automatic train -> review -> adjust -> train loop (.github/workflows/autoloop.yml). Standard library only.

One GENERATION = K candidates trained in parallel from the current champion (each with its own push / reward-weight setting),
every candidate evaluated with rl/evaluate.py, then:
  review  : rank by the evaluation score (rl/scoring.py); the best candidate becomes the new champion only if it beats the old
            champion by MARGIN (so evaluation noise does not make it drift); otherwise the champion stays.
  adjust  : candidate 0 = "hold" (same settings, just keeps training), candidate 1 = curriculum (harder pushes once the champion
            survives them, otherwise a stronger tilt penalty), the others = random mutations whose size (sigma) shrinks after a
            generation without improvement and resets after a success.
  stop    : target score reached / `patience` generations in a row without improvement / max generations / all candidates failed /
            state['stopped'] or the STOP file.
It only changes the settings listed in TUNE (inside the ranges below, which the env clamps again). It never edits code.
State lives in <state-dir>/state.json (the `policies` branch: loop/<task>/<id>/state.json).
  autoloop.py plan   --state-dir D --loop-id X --task walk --k 3 --minutes 60 --max-gens 10 --patience 3 --seed 0
  autoloop.py select --state-dir D --cands-dir C --winner-dir W"""
import argparse, copy, json, math, os, random, shutil, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scoring import score

MARGIN, TARGET, SIGMA0, SIGMA_MIN = 0.01, 0.95, 0.35, 0.1
TUNE = {   # key: (lo, hi, kind)   kind: log = multiplicative noise, lin = additive, int = rounded multiplicative
    'push_force': (4.0, 24.0, 'log'), 'push_steps': (1, 10, 'int'), 'push_prob': (0.3, 1.0, 'lin'),
    'w_tilt': (0.5, 8.0, 'log'), 'w_smooth': (0.003, 0.3, 'log'), 'w_torque': (0.0003, 0.02, 'log'),
    'w_pose': (0.02, 1.0, 'log'), 'w_track': (0.3, 3.0, 'log'), 'w_up': (0.1, 3.0, 'log'), 'w_stand': (0.3, 6.0, 'log'), 'w_air': (0.1, 2.0, 'log'),
}
TASK_KEYS = {'stand': ['push_force', 'push_steps', 'push_prob', 'w_tilt', 'w_smooth', 'w_torque', 'w_pose'],
             'walk': ['push_force', 'push_steps', 'push_prob', 'w_tilt', 'w_smooth', 'w_torque', 'w_track', 'w_air'],   # velocity walk (forward / back / left / right / turn)
             'walk_ref': ['push_force', 'push_steps', 'push_prob', 'w_tilt', 'w_smooth', 'w_torque', 'w_track']}   # imitation of the official forward walk
for _t in ('getup_back', 'getup_front'): TASK_KEYS[_t] = ['push_force', 'push_steps', 'push_prob', 'w_up', 'w_stand', 'w_track', 'w_smooth', 'w_torque']
START = {'push_force': 6.0, 'push_steps': 5, 'push_prob': 0.7, 'w_tilt': 2.0, 'w_smooth': 0.02, 'w_torque': 0.002, 'w_pose': 0.1, 'w_track': 1.0, 'w_up': 0.5, 'w_stand': 1.0, 'w_air': 0.5}
ID_RE_MAX = 20


def now(): return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
def r4(v): return float('%.4g' % v)


def new_state(loop_id, task, k, minutes, max_gens, patience, seed):
    return dict(version=1, loop_id=loop_id, task=task, k=k, minutes=minutes, max_gens=max_gens, patience_max=patience, patience=patience, seed=seed,
                gen=0, sigma=SIGMA0, stopped=False, reason='', champion=None, baseline=None, history=[], created=now(), updated=now())


def clamp(k, v):
    lo, hi, kind = TUNE[k]; v = min(hi, max(lo, v)); return int(round(v)) if kind == 'int' else r4(v)


def mutate(cfg, keys, rng, sigma):
    for _ in range(20):   # a mutation that lands on the old values (clamped at a bound) would just repeat the hold candidate: try again
        c = dict(cfg); chosen = [k for k in keys if rng.random() < 0.45] or [rng.choice(keys)]
        for k in chosen:
            kind = TUNE[k][2]
            if kind == 'lin': v = cfg[k] + rng.gauss(0, sigma * 0.5)
            else:
                v = cfg[k] * math.exp(rng.gauss(0, sigma))
                if kind == 'int' and round(v) == cfg[k]: v = cfg[k] + rng.choice([-1, 1])
            c[k] = clamp(k, v)
        if c != cfg: return c
    return c


def curriculum(cfg, champ_eval, task='walk'):
    c = dict(cfg); pm = ((champ_eval or {}).get('push') or {}).get('mean', 0)
    if task.startswith('getup'):   # get-up: first make it stand up reliably, then ask for robustness against pushes
        if ((champ_eval or {}).get('clean') or {}).get('survive', 0) < 0.9: c['w_stand'] = clamp('w_stand', cfg['w_stand'] * 1.4)
        elif pm >= 0.7: c['push_force'] = clamp('push_force', cfg['push_force'] * 1.35); c['push_steps'] = clamp('push_steps', cfg['push_steps'] + 1)
        else: c['w_stand'] = clamp('w_stand', cfg['w_stand'] * 1.2)
        return c
    if pm >= 0.7: c['push_force'] = clamp('push_force', cfg['push_force'] * 1.35); c['push_steps'] = clamp('push_steps', cfg['push_steps'] + 1)   # it copes: push harder
    else: c['w_tilt'] = clamp('w_tilt', cfg['w_tilt'] * 1.4)                                                                                         # it does not: care more about staying upright
    return c


def restart(state, more_gens=None, patience=None):
    """resume a stopped loop (patience used up, generation limit, all candidates failed, STOP file): clear the stop flag, reset patience and
    explore widely again; `more_gens` = how many MORE generations to run from now on. The champion and the history are kept."""
    state['stopped'], state['reason'] = False, ''
    if patience: state['patience_max'] = max(1, int(patience))
    state['patience'] = state['patience_max']; state['sigma'] = SIGMA0
    if more_gens: state['max_gens'] = state['gen'] + max(1, min(100, int(more_gens)))
    state['updated'] = now()
    return state


def plan(state, stop_file=False):
    """-> dict(stop, reason, gen, candidates=[{id, cand, seed, cfg(json string), baseline(bool)}])"""
    if stop_file: state['stopped'], state['reason'] = True, 'STOP file'
    if state['stopped']: return dict(stop=True, reason=state['reason'] or 'stopped', gen=state['gen'], candidates=[])
    if state['gen'] >= state['max_gens']: return dict(stop=True, reason='max generations reached', gen=state['gen'], candidates=[])
    keys = TASK_KEYS[state['task']]; rng = random.Random('%s-%d' % (state['seed'], state['gen']))
    champ = state['champion']; base = {k: START[k] for k in keys} if not champ else {k: clamp(k, champ['cfg'].get(k, START[k])) for k in keys}
    cfgs = [base]                                                   # 0: hold
    if state['k'] > 1: cfgs.append(curriculum(base, champ['eval'] if champ else None, state['task']) if champ else mutate(base, keys, rng, state['sigma']))
    while len(cfgs) < state['k']: cfgs.append(mutate(base, keys, rng, state['sigma']))
    cands = [dict(id='g%dc%d' % (state['gen'], i), cand=i, seed=int(state['seed']) + state['gen'] * 100 + i, cfg=json.dumps(c, separators=(',', ':')),
                  baseline=(i == 0 and state['baseline'] is None)) for i, c in enumerate(cfgs)]
    return dict(stop=False, reason='', gen=state['gen'], candidates=cands)


def review(state, results, baseline_eval=None):
    """results: [{id, cand, cfg(dict), eval(dict|None), timesteps, ...}]. Mutates state; -> dict(accepted, winner, stop, reason)"""
    if baseline_eval and state['baseline'] is None: state['baseline'] = baseline_eval
    base, gen = state['baseline'], state['gen']; ok = [r for r in results if r.get('eval')]
    for r in ok: r['score'] = score(r['eval'], base)
    state['updated'] = now()
    if not ok:
        state.update(stopped=True, reason='all candidates failed'); state['gen'] += 1
        return dict(accepted=False, winner=None, stop=True, reason=state['reason'])
    best = max(ok, key=lambda r: (r['score'], r['eval']['clean']['survive'], r['eval']['push']['mean']))
    champ = state['champion']; accepted = champ is None or best['score'] > champ['score'] + MARGIN
    for r in results:
        e = r.get('eval') or {}; c, p = e.get('clean', {}), e.get('push', {})
        state['history'].append(dict(gen=gen, id=r['id'], cand=r['cand'], cfg=r['cfg'], score=r.get('score'), push_mean=p.get('mean'), f50=p.get('f50'), tilt_mean=c.get('tilt_mean'),
                                     x_mean=c.get('x_mean'), survive=c.get('survive'), timesteps=r.get('timesteps'), accepted=bool(accepted and r is best), failed=not e))
    state['history'] = state['history'][-300:]
    if accepted:
        state['champion'] = dict(cfg=best['cfg'], score=best['score'], eval=best['eval'], gen=gen, cand=best['cand'], id=best['id'], timesteps=best.get('timesteps'), name='%s-g%d' % (state['loop_id'], gen))
        state['sigma'], state['patience'] = SIGMA0, state['patience_max']
    else:
        state['sigma'] = max(SIGMA_MIN, state['sigma'] * 0.8); state['patience'] -= 1
    state['gen'] += 1
    reason = ''
    if state['champion'] and state['champion']['score'] >= TARGET: reason = 'target score reached'
    elif state['patience'] <= 0: reason = 'no improvement for %d generations' % state['patience_max']
    elif state['gen'] >= state['max_gens']: reason = 'max generations reached'
    if reason: state['stopped'], state['reason'] = True, reason
    return dict(accepted=accepted, winner=best if accepted else None, stop=bool(reason), reason=reason)


def emit(name, value):   # GitHub Actions step output
    f = os.environ.get('GITHUB_OUTPUT')
    if f:
        with open(f, 'a', encoding='utf-8') as fh: fh.write('%s=%s\n' % (name, value))


def load_state(d): 
    try:
        with open(os.path.join(d, 'state.json'), encoding='utf-8') as f: return json.load(f)
    except (OSError, ValueError): return None


def save_state(d, st):
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, 'state.json'), 'w', encoding='utf-8') as f: json.dump(st, f, indent=1)


def rj(path):
    try:
        with open(path, encoding='utf-8') as f: return json.load(f)
    except (OSError, ValueError): return None


def main():
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('plan'); p.add_argument('--state-dir', required=True); p.add_argument('--loop-id', required=True); p.add_argument('--task', default=None, choices=['stand', 'walk', 'walk_ref', 'getup_back', 'getup_front'])
    p.add_argument('--k', type=int, default=3); p.add_argument('--minutes', type=int, default=60); p.add_argument('--max-gens', type=int, default=10)
    p.add_argument('--patience', type=int, default=3); p.add_argument('--seed', type=int, default=0)
    p.add_argument('--restart', action='store_true', help='resume a stopped loop: --max-gens = how many MORE generations, --patience = new patience')
    s = sub.add_parser('select'); s.add_argument('--state-dir', required=True); s.add_argument('--cands-dir', required=True); s.add_argument('--winner-dir', required=True)
    a = ap.parse_args()
    if a.cmd == 'plan':
        import re
        if not re.match(r'^[A-Za-z0-9][A-Za-z0-9_-]{0,%d}$' % (ID_RE_MAX - 1), a.loop_id): sys.exit('loop id: letters/digits/-/_, max %d chars' % ID_RE_MAX)
        st = load_state(a.state_dir)
        if st is None: st = new_state(a.loop_id, a.task or 'walk', max(1, min(6, a.k)), max(1, min(330, a.minutes)), max(1, min(100, a.max_gens)), max(1, a.patience), a.seed)
        elif a.task and st['task'] != a.task:   # the task is fixed when a loop is created; silently continuing another task is what made every run train the old one
            sys.exit("loop '%s' already exists and trains task '%s' (you asked for '%s'): the task of an existing loop cannot be changed. "
                     "Use another loop_id (or leave it empty = <task>-1), or delete the loop folder on the `policies` branch." % (a.loop_id, st['task'], a.task))
        elif a.restart:
            restart(st, a.max_gens, a.patience)
            if os.path.exists(os.path.join(a.state_dir, 'STOP')): os.remove(os.path.join(a.state_dir, 'STOP'))
        out = plan(st, stop_file=os.path.exists(os.path.join(a.state_dir, 'STOP'))); save_state(a.state_dir, st)
        print(json.dumps(out, indent=1))
        emit('stop', 'true' if out['stop'] else 'false'); emit('gen', out['gen']); emit('reason', out['reason'])
        emit('task', st['task']); emit('minutes', st['minutes']); emit('matrix', json.dumps({'include': out['candidates']}, separators=(',', ':')))
    else:
        st = load_state(a.state_dir)
        if st is None: sys.exit('no state.json in %s' % a.state_dir)
        results, baseline = [], None
        for d in sorted(os.listdir(a.cands_dir)) if os.path.isdir(a.cands_dir) else []:
            cd = os.path.join(a.cands_dir, d); ev = rj(os.path.join(cd, 'eval.json')); meta = rj(os.path.join(cd, 'meta.json')) or {}
            if os.path.exists(os.path.join(cd, 'eval_baseline.json')): baseline = rj(os.path.join(cd, 'eval_baseline.json'))
            cid = d[5:] if d.startswith('cand-') else d
            cand = int(cid.split('c')[-1]) if 'c' in cid else 0
            results.append(dict(id=cid, cand=cand, cfg=meta.get('cfg') or {}, eval=ev, timesteps=meta.get('timesteps'), dir=cd))
        gen = st['gen']; dec = review(st, results, baseline); save_state(a.state_dir, st)
        if dec['accepted']:
            w = dec['winner']; os.makedirs(a.winner_dir, exist_ok=True)
            for f in ('policy.onnx', 'ref.json', 'curve.json', 'model.zip', 'eval.json'):
                if os.path.exists(os.path.join(w['dir'], f)): shutil.copy(os.path.join(w['dir'], f), os.path.join(a.winner_dir, f))
            meta = rj(os.path.join(w['dir'], 'meta.json')) or {}; e = w['eval']
            meta.update(score=round(w['score'], 4), push_mean=round(e['push']['mean'], 3), push_f50=round(e['push']['f50'], 1), tilt_mean=round(e['clean']['tilt_mean'], 2),
                        x_mean=round(e['clean']['x_mean'], 3), loop=st['loop_id'], gen=gen)
            with open(os.path.join(a.winner_dir, 'meta.json'), 'w', encoding='utf-8') as f: json.dump(meta, f, indent=1)
        print(json.dumps(dict(gen=gen, accepted=dec['accepted'], stop=dec['stop'], reason=dec['reason'], champion_score=(st['champion'] or {}).get('score'),
                              scores={r['id']: round(r.get('score') or 0, 3) for r in results}), indent=1))
        emit('accepted', 'true' if dec['accepted'] else 'false'); emit('stop', 'true' if dec['stop'] else 'false'); emit('reason', dec['reason'])
        emit('name', st['champion']['name'] if dec['accepted'] else ''); emit('gen', gen)


if __name__ == '__main__':
    main()
