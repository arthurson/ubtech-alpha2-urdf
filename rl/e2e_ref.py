"""Reference trajectory for web/tools/test-policy-e2e.mjs: run a policy.onnx in the Python env (no randomisation, no push) and dump the joint angles.
  python rl/e2e_ref.py policy.onnx /tmp/e2e.json [steps]"""
import os, sys, json
import numpy as np, onnxruntime as ort
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import alpha2_env as E
sess = ort.InferenceSession(sys.argv[1]); steps = int(sys.argv[3]) if len(sys.argv) > 3 else 40; cmd = [0.02, 0.0, 0.0]
env = E.make_env('walk', randomize=False, push=False, seed=0); env.cmd_fixed = cmd; o, _ = env.reset(seed=0); Q, Z = [], []
for t in range(steps):
    a = sess.run(None, {'obs': o[None].astype(np.float32)})[0][0]; o, r, te, tr, _ = env.step(a)
    Q.append(env.d.qpos[env.qadr].tolist()); Z.append(float(env.d.qpos[2]))
json.dump(dict(cmd=cmd, steps=steps, q=Q, z=Z), open(sys.argv[2], 'w')); print('dumped', steps, 'steps')
