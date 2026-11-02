"""Strict policy evaluation (CPU). The training-time eval only reports survival, which saturates (even the untrained baseline survives),
so this measures what actually differs:
  clean : n episodes without pushes  -> survival rate, forward distance x, lateral drift |y|, mean / max tilt, mean torque
  push  : a push of F newtons held for `--push-steps` control steps (0.02 s each) while moving, 4 directions x seeds,
          for each F in --forces  -> survival rate per force, their mean (push_mean) and the force where survival crosses 50 % (push_f50)
  score : one number in 0..1 used by rl/autoloop.py to rank policies (see score()).
Evaluation seeds are fixed (independent of the training seed) so scores of different policies are comparable.
  python rl/evaluate.py --model rl/out/model.zip --task walk --out rl/out/eval.json
  python rl/evaluate.py --baseline --task walk --out rl/out/eval_baseline.json      # zero action (= replay of the reference for walk)"""
import argparse, json, os, sys, time
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('ALPHA2_CFG', '{}')
import alpha2_env as E
from scoring import score, f50

DIRS = [(1, 0), (-1, 0), (0, 1), (0, -1)]
FORCES = [8, 12, 16, 20, 26]
_G = {}


def _init(model_path, task, ref):
    _G.update(task=task, ref=ref)
    if model_path:
        from stable_baselines3 import PPO
        import torch; torch.set_num_threads(1)
        _G['model'] = PPO.load(model_path, device='cpu')


def _env(seed):
    return E.make_env(_G['task'], ref=_G['ref'], seed=seed, push=False)


def _episode_getup(job):
    """get-up tasks: success = standing during the last 0.5 s; a push (force held nsteps control steps) hits the standing robot 0.6 s after the reference ends"""
    seed, force, direc, nsteps = job
    env = _env(seed); o, _ = env.reset(seed=seed); vec = np.array(DIRS[direc], float) * force; t_push = env.T + 30; stood, tq = [], []
    for t in range(env.EP):
        if force > 0 and t_push <= t < t_push + nsteps: env.d.xfrc_applied[1, :2] = vec
        a = _G['model'].predict(o, deterministic=True)[0] if 'model' in _G else np.zeros(20)
        o, _, te, tr, _ = env.step(a); stood.append(env.standing()); tq.append(float(np.mean(np.abs(env.d.actuator_force[env.act]))))
        if tr: break
    ok = all(stood[-25:]); i = len(stood)
    if ok:
        while i > 0 and stood[i - 1]: i -= 1
    zz = env.d.xmat[1].reshape(3, 3)[2, 2]
    return dict(fell=not ok, ok=ok, t_stand=(i if ok else None), tilt=float(np.degrees(np.arccos(np.clip(zz, -1, 1)))), z=float(env.d.qpos[2]), torque=float(np.mean(tq)))


def _episode(job):
    if _G['task'].startswith('getup'): return _episode_getup(job)
    seed, force, direc, nsteps = job
    walk = _G['task'] == 'walk'
    env = _env(seed); o, _ = env.reset(seed=seed)
    t_push, T = (300, 700) if walk else (100, 400)
    if force <= 0: T = 1000 if walk else 500
    vec = np.array(DIRS[direc], float) * force
    tilts, tq, fell = [], [], False
    for t in range(T):
        if force > 0 and t_push <= t < t_push + nsteps: env.d.xfrc_applied[1, :2] = vec
        a = _G['model'].predict(o, deterministic=True)[0] if 'model' in _G else np.zeros(20)
        o, _, te, tr, _ = env.step(a)
        zz = env.d.xmat[1].reshape(3, 3)[2, 2]; tilts.append(np.degrees(np.arccos(np.clip(zz, -1, 1))))
        tq.append(float(np.mean(np.abs(env.d.actuator_force[env.act]))))
        if te: fell = True; break
        if tr: break
    return dict(fell=fell, x=float(env.d.qpos[0]), y=float(env.d.qpos[1]), tilt_mean=float(np.mean(tilts)), tilt_max=float(np.max(tilts)), torque=float(np.mean(tq)))


def evaluate(model, task, ref, seeds=8, push_seeds=3, forces=FORCES, push_steps=5, workers=None):
    from multiprocessing import Pool
    jobs_clean = [(1000 + s, 0, 0, 0) for s in range(seeds)]
    jobs_push = [(2000 + s, F, d, push_steps) for F in forces for s in range(push_seeds) for d in range(4)]
    with Pool(workers or os.cpu_count(), initializer=_init, initargs=(model, task, ref)) as P:
        C = P.map(_episode, jobs_clean); R = P.map(_episode, jobs_push)
    per = len(R) // len(forces)
    surv = [float(np.mean([not r['fell'] for r in R[i * per:(i + 1) * per]])) for i in range(len(forces))]
    push = dict(forces=list(forces), steps=push_steps, survive=surv, mean=float(np.mean(surv)), f50=f50(forces, surv))
    if task.startswith('getup'):
        ts = [c['t_stand'] * 0.02 for c in C if c['ok']]
        clean = dict(n=len(C), survive=float(np.mean([c['ok'] for c in C])), x_mean=0.0, x_std=0.0, y_abs=0.0, tilt_mean=float(np.mean([c['tilt'] for c in C])),
                     tilt_max=float(np.max([c['tilt'] for c in C])), torque=float(np.mean([c['torque'] for c in C])), z_final=float(np.mean([c['z'] for c in C])),
                     stand_time=(float(np.mean(ts)) if ts else None))
        return dict(task=task, clean=clean, push=push)
    clean = dict(n=len(C), survive=float(np.mean([not c['fell'] for c in C])), x_mean=float(np.mean([c['x'] for c in C])), x_std=float(np.std([c['x'] for c in C])),
                 y_abs=float(np.mean([abs(c['y']) for c in C])), tilt_mean=float(np.mean([c['tilt_mean'] for c in C])), tilt_max=float(np.max([c['tilt_max'] for c in C])),
                 torque=float(np.mean([c['torque'] for c in C])))
    return dict(task=task, clean=clean, push=push)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--model'); ap.add_argument('--baseline', action='store_true', help='zero action instead of a model')
    ap.add_argument('--task', default='walk', choices=['stand', 'walk', 'getup_back', 'getup_front']); ap.add_argument('--ref', default=None, help='reference json (default: rl/ref/ of the task)')
    ap.add_argument('--out', required=True); ap.add_argument('--base-json', help='baseline eval json (for the score); default constants')
    ap.add_argument('--seeds', type=int, default=8); ap.add_argument('--push-seeds', type=int, default=3); ap.add_argument('--push-steps', type=int, default=5)
    ap.add_argument('--forces', default=','.join(map(str, FORCES))); ap.add_argument('--workers', type=int, default=None)
    a = ap.parse_args()
    if not a.model and not a.baseline: ap.error('give --model or --baseline')
    t0 = time.time()
    m = evaluate(None if a.baseline else a.model, a.task, a.ref, a.seeds, a.push_seeds, [float(x) for x in a.forces.split(',')], a.push_steps, a.workers)
    base = json.load(open(a.base_json)) if a.base_json and os.path.exists(a.base_json) else None
    m['score'] = score(m, base if not a.baseline else m); m['seconds'] = round(time.time() - t0, 1)
    json.dump(m, open(a.out, 'w'), indent=1)
    c, p = m['clean'], m['push']
    if 'z_final' in c: print(f"[eval] score {m['score']:.3f} | get-up success {c['survive']:.2f} stand time {c['stand_time']} s final tilt {c['tilt_mean']:.1f} deg z {c['z_final']:.3f} | after-standing push {p['steps']}x0.02s survive {['%.0f%%' % (100 * v) for v in p['survive']]} @ {p['forces']} N | {m['seconds']}s", flush=True); sys.exit(0)
    print(f"[eval] score {m['score']:.3f} | clean survive {c['survive']:.2f} x {c['x_mean']:.3f} m |y| {c['y_abs']:.3f} tilt {c['tilt_mean']:.1f}/{c['tilt_max']:.0f} deg torque {c['torque']:.3f}"
          f" | push {p['steps']}x0.02s survive {['%.0f%%' % (100 * v) for v in p['survive']]} @ {p['forces']} N, f50 {p['f50']:.1f} N | {m['seconds']}s", flush=True)
