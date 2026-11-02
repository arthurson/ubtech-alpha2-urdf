"""Pure-python scoring of an evaluation result (see rl/evaluate.py); shared by evaluate.py and autoloop.py."""


def clip(v, lo, hi): return max(lo, min(hi, v))


def f50(forces, surv):
    """force at which survival falls below 50 % (linear interpolation); forces[0] if it is already below, forces[-1] if it never is"""
    if surv[0] < 0.5: return float(forces[0])
    for i in range(1, len(forces)):
        if surv[i] < 0.5:
            a, b = surv[i - 1], surv[i]; return float(forces[i - 1] + (forces[i] - forces[i - 1]) * (a - 0.5) / max(a - b, 1e-9))
    return float(forces[-1])


def score(m, base=None):
    """0..1, higher is better. Gate: clean survival must be >= 95 % (else 0).
    push    (weight .5): mean survival over the push forces
    upright (weight .3): clip(1.5 - tilt_mean / baseline tilt_mean, 0, 1)   (half the baseline tilt -> 1.0, same tilt -> 0.5)
    dist    (weight .2, walk only): clip(x_mean / baseline x_mean - 0.5, 0, 1)   (1.5x the baseline distance -> 1.0, same -> 0.5)
    `base` = evaluation of the zero-action baseline (same task); without it fixed constants (10 deg, 0.27 m) are used."""
    c, p = m['clean'], m['push']
    if c['survive'] < 0.95: return 0.0
    bt = ((base or {}).get('clean') or {}).get('tilt_mean') or 10.0
    parts = [(0.5, p['mean']), (0.3, clip(1.5 - c['tilt_mean'] / bt, 0, 1))]
    if m.get('task') == 'walk':
        bx = ((base or {}).get('clean') or {}).get('x_mean') or 0.27
        parts.append((0.2, clip(c['x_mean'] / bx - 0.5, 0, 1)))
    return float(sum(w * v for w, v in parts) / sum(w for w, _ in parts))
