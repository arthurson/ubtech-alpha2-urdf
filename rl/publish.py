"""Copy a finished training result into a checkout of the `policies` branch and keep policies/index.json up to date.
Used by .github/workflows/train.yml (standard library only):
  python rl/publish.py --dest /tmp/pol --out rl/out --task walk --name my-run --run-id 123 --run-url https://... --minutes 60

Layout:  <dest>/index.json                      list of every published policy (newest first), read by the web player
         <dest>/<task>/<name>/policy.onnx, ref.json (walk), meta.json, curve.json
Same task + name overwrites; an empty name becomes <task>-YYYYMMDD-HHMM so nothing is overwritten by accident.
A result in the old layout (<dest>/<task>/policy.onnx) is moved to <dest>/<task>/legacy/ and listed as 'legacy'."""
import argparse, json, os, re, shutil, sys, time

NAME_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$')
KEEP = ('task', 'name', 'path', 'finished_at', 'minutes', 'run_id', 'run_url', 'timesteps', 'eval_mean_len', 'eval_max_len', 'baseline_mean_len', 'cfg', 'seed',
        'score', 'push_mean', 'push_f50', 'tilt_mean', 'x_mean', 'loop', 'gen', 'success', 'baseline_success')   # the last group comes from rl/autoloop.py


def entry_from(meta, task, name):
    e = {k: meta[k] for k in KEEP if k in meta}
    e.update(id='%s/%s' % (task, name), task=task, name=name, path='%s/%s' % (task, name))
    return e


def load_json(path, default):
    try:
        with open(path, encoding='utf-8') as f: return json.load(f)
    except (OSError, ValueError): return default


def publish(dest, out, task, name, run_id='', run_url='', minutes=0, now=None):
    if task not in ('stand', 'walk', 'getup_back', 'getup_front'): raise SystemExit('task must be stand, walk, getup_back or getup_front')
    now = now or time.gmtime()
    name = (name or '').strip() or '%s-%s' % (task, time.strftime('%Y%m%d-%H%M', now))
    if not NAME_RE.match(name) or name == 'legacy': raise SystemExit('name must match %s (and not be "legacy")' % NAME_RE.pattern)
    idx = load_json(os.path.join(dest, 'index.json'), {'version': 1, 'policies': []})
    pols = [p for p in idx.get('policies', []) if isinstance(p, dict)]
    tdir = os.path.join(dest, task)
    os.makedirs(tdir, exist_ok=True)

    # 1. old flat layout -> <task>/legacy/
    flat = os.path.join(tdir, 'policy.onnx')
    if os.path.exists(flat):
        ldir = os.path.join(tdir, 'legacy'); os.makedirs(ldir, exist_ok=True)
        for f in ('policy.onnx', 'ref.json', 'meta.json'):
            src = os.path.join(tdir, f)
            if os.path.exists(src): shutil.move(src, os.path.join(ldir, f))
        lid = '%s/legacy' % task
        if not any(p.get('id') == lid for p in pols):
            pols.append(entry_from(load_json(os.path.join(ldir, 'meta.json'), {'task': task}), task, 'legacy'))

    # 2. the new result
    ndir = os.path.join(tdir, name); os.makedirs(ndir, exist_ok=True)
    meta = load_json(os.path.join(out, 'meta.json'), {})
    meta.update(task=task, name=name, run_id=str(run_id), run_url=run_url, minutes=minutes, path='%s/%s' % (task, name),
                finished_at=time.strftime('%Y-%m-%dT%H:%M:%SZ', now))
    shutil.copy(os.path.join(out, 'policy.onnx'), os.path.join(ndir, 'policy.onnx'))
    for f in ('ref.json', 'curve.json', 'eval.json'):    # optional files: drop a stale copy of the same name
        src, dst = os.path.join(out, f), os.path.join(ndir, f)
        if os.path.exists(src): shutil.copy(src, dst)
        elif os.path.exists(dst): os.remove(dst)
    with open(os.path.join(ndir, 'meta.json'), 'w', encoding='utf-8') as f: json.dump(meta, f, indent=1)

    # 3. index: newest first, one entry per id
    e = entry_from(meta, task, name)
    pols = [e] + [p for p in pols if p.get('id') != e['id']]
    with open(os.path.join(dest, 'index.json'), 'w', encoding='utf-8') as f: json.dump({'version': 1, 'policies': pols}, f, indent=1)
    return e


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    for k in ('dest', 'out', 'task'): ap.add_argument('--' + k, required=True)
    ap.add_argument('--name', default=''); ap.add_argument('--run-id', default=''); ap.add_argument('--run-url', default=''); ap.add_argument('--minutes', type=float, default=0)
    a = ap.parse_args()
    e = publish(a.dest, a.out, a.task, a.name, a.run_id, a.run_url, int(a.minutes))
    print('published', e['id'], file=sys.stderr)
