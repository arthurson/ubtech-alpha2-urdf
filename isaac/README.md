# Isaac Sim notes (NOT run)

`urdf/alpha2_isaac.urdf` = `alpha2.urdf` with relative mesh paths. `import_and_stand.py` imports it, sets position drives and runs a 5 s standing test.
Neither was executed in Isaac Sim (the build environment has no GPU / NVIDIA package index). Offline pre-flight checks that did pass:
all 181 mesh references resolve; 160 collision pieces are convex (max 49 vertices, 94 faces; PhysX limit 255); inertias positive-definite;
worst parent/child mass ratio 8.2; 21 visual OBJ meshes, 459k faces (largest 195k).

Importer settings to use: merge fixed joints ON (8 massless frame links), fix base OFF for a floating test, import inertia tensor ON, convex decomposition OFF, self collision OFF.

Expected problems to watch for:
- Lightest link principal inertia 7.8e-7 kg*m^2: needs joint armature (0.003-0.005 kg*m^2) or stiff drives will jitter / explode (same as in MuJoCo).
- USD angular drive gains are per degree, not per radian.
- Drive/effort values come from the 12/20 kg*cm servo table; velocity limit 5 rad/s is a placeholder.
- Visual meshes are full resolution; decimate them for many-robot scenes.
