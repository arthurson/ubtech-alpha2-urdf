"""Export the stand_test.py physics model (free base, ground, position servos, armature, implicitfast)
as ONE self-contained MJCF: mujoco/alpha2.xml, with the 160 CoACD collision STLs inlined as <mesh vertex=...>.
The web player (web/mj-sim.js) loads this file into MuJoCo WASM, so the browser needs no mesh files.
Run:  python mujoco/make_mjcf.py        (pip install mujoco numpy)
Check: python mujoco/make_mjcf.py --check   (xml == stand_test model: mass, geoms, 5 s stand result)"""
import os, re, struct, sys, numpy as np, mujoco
HERE = os.path.dirname(os.path.abspath(__file__)); PKG = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import stand_test as st
OUT = os.path.join(HERE, 'alpha2.xml')

def read_stl(path):
    """Binary or ASCII STL -> (vertices Nx3 float32, unique, first-seen order)."""
    b = open(path, 'rb').read()
    n = struct.unpack('<I', b[80:84])[0] if len(b) >= 84 else -1
    if len(b) == 84 + 50 * n:
        tri = np.frombuffer(b[84:], dtype=np.dtype([('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')]), count=n)['v'].reshape(-1, 3)
    else:
        tri = np.array([[float(x) for x in l.split()[1:4]] for l in b.decode().splitlines() if l.strip().startswith('vertex')], dtype=np.float32)
    _, idx = np.unique(tri, axis=0, return_index=True)
    return tri[np.sort(idx)]

def build_xml():
    xml = st.build_spec().to_xml()
    def inline(m):
        name, rel = m.group(1), m.group(2)
        v = read_stl(os.path.join(PKG, rel))
        return '<mesh name="%s" vertex="%s"/>' % (name, ' '.join('%.9g' % x for x in v.ravel()))
    xml, n = re.subn(r'<mesh name="([^"]+)" content_type="model/stl" file="([^"]+)"/>', inline, xml)
    xml = xml.replace(' meshdir=".."', '')          # no external files any more
    assert n == 160 and 'file=' not in xml, n
    return xml

def check(xml):
    a = mujoco.MjModel.from_xml_string(xml); b = st.load()
    assert abs(a.body_mass.sum() - b.body_mass.sum()) < 1e-9 and a.ngeom == b.ngeom and a.nu == b.nu == 20 and a.nbody == b.nbody
    assert np.allclose(a.jnt_range, b.jnt_range) and np.allclose(a.actuator_forcerange, b.actuator_forcerange)
    assert a.opt.timestep == b.opt.timestep and a.opt.integrator == b.opt.integrator
    res = []
    for m in (a, b):
        d = mujoco.MjData(m); q = st.default_stance(); d.qpos[:7] = [0, 0, 0.2206 + 0.0015, 1, 0, 0, 0]
        for n, v in q.items():
            d.qpos[m.jnt_qposadr[mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_JOINT, n)]] = v
            d.ctrl[mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_ACTUATOR, 'act_' + n)] = v
        for _ in range(2500): mujoco.mj_step(m, d)
        res.append((d.qpos[2], np.degrees(np.arccos(d.xmat[1].reshape(3, 3)[2, 2]))))
    print('xml  : z %.4f tilt %.2f deg\nbuild: z %.4f tilt %.2f deg' % (*res[0], *res[1]))
    assert abs(res[0][0] - res[1][0]) < 5e-4 and abs(res[0][1] - res[1][1]) < 0.3, 'xml model differs from stand_test model'
    print('OK')

if __name__ == '__main__':
    xml = build_xml()
    if '--check' in sys.argv: check(xml)
    else: open(OUT, 'w', encoding='utf-8').write(xml); print('wrote', OUT, len(xml) // 1024, 'KB')
