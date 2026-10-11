# alpha2_description

Standard URDF of the UBTech Alpha 2 (20 revolute joints, 21 links), built from
`alpha2_21parts.zip` (OBJ parts) and the PC software's `alpha2.FBX` / `alpha2.xml`.

- Frame: REP-103 (x forward, y left, z up), metres, `base_link` = body (bady1) pivot.
- Zero pose = PC-software model pose (standing, arms down). All link frames are axis-aligned with `base_link` at q=0 and sit on the servo pivot.
- Part placement: the OBJ parts are not in the assembled pose; each object was matched to its FBX mesh (same name / vertex order) and mapped exactly (residual 0.001 mm). Only two small foot sub-parts per foot needed an affine fit.
- Joint axes: from `alpha2.xml` `<Axis>`; the PC software (UBXRobot3DView.dll) encodes it as an Euler channel (1x+2y+3z) and applies it on the FBX node, which reproduces the axes used here (head_yaw is about the parent vertical axis).
- Servo angle <-> q (from UBXRobot3DView.dll): rotation_deg = servo_angle_deg + Offset (alpha2.xml). So q_rad = radians(servo + Offset); q = 0 at servo = -Offset. EXCEPTION: head pitch (servo 20) uses q = servo - 120 (urdf_offset -120 in servo_map.yaml) because on the real robot servo 19/20 at 120 = head level/centred; the PC software Offset (-135) would tilt the model head up 15 deg at 120. Joint limits = measured servo min/max (ubtech-open-alpha2 `SERVO_CALIBRATION` (identical to ubtech-open-lynx)): lower = min+Offset, upper = max+Offset. PC default stance (servo = InitAngle) = q_init in `config/servo_map.yaml`: arms out to the sides (+-90 deg shoulder roll), hips/knees slightly flexed, feet flat.
- Still placeholders: inertials (2.3 kg total (user-stated). Explicit masses: 20 servos as point masses at their joint pivots in the child link (IDs 2,3,5,6,17,18,19,20: 40.3 g each, 12 kg*cm; IDs 1,4,7-16: 52.8 g each, 20 kg*cm) and 3 x 50 g 18650 cells in base_link. The remaining 1.194 kg (shell, mainboards, wiring) is distributed by hull volume. Servo bodies are placed at the pivot, not at their real centre; mainboards are not modelled separately), velocity 5 rad/s (effort = servo STALL torque, confirmed by the maintainer: 12 kg*cm = 1.177 N*m for the light servos, 20 kg*cm = 1.961 N*m for the heavy ones; no torque-speed curve is modelled, so the torque available while moving is lower). Direction: the PC software stores it only as the sign of `<Axis>` in alpha2.xml (no separate direction field anywhere in the PC software files); positive = right-hand rotation of (servo + Offset) about that axis (LibFBX uses the Autodesk FBX SDK). Consistent with a flat-foot / forward-knee check on the default stance; not yet measured on hardware.
- Visual meshes: full-resolution OBJ + original vertex colours baked into per-colour mtl materials (source geometry, only moved into link frames, no decimation); collision = convex decomposition (CoACD, up to 8 convex pieces per link, 160 pieces in total, clamped to the visual mesh bounding box so soles and extents match the visual).
- View: `ros2 launch urdf_launch display.launch.py urdf_path_or_xacro:=<path>/urdf/alpha2.urdf` (needs package on the path for package:// URIs).

## Added frames / files
- `base_footprint` (root; ground point below base_link in the PC-software default stance, height 0.2206 m = lowest point of the visual meshes; at the zero pose the feet sit 2 mm above it), `r_sole_frame`/`l_sole_frame` (sole-plane centre of each foot), `r_hand_tip`/`l_hand_tip` (lowest point of the hand link at the zero pose). Fixed joints, no mass.
- `config/alpha2.srdf`: planning groups (right_arm, left_arm, right_leg, left_leg, head, arms, legs, whole_body), group states (`zero`, `default_stance` = PC-software default stance) and a collision-disable table from the convex pieces: 20 adjacent, 2 default-overlapping, 83 never colliding in 10,000 random samples within the joint limits (105 pairs stay enabled). No virtual joint is defined.
- `launch/display.launch.py` + `rviz/alpha2.rviz`: robot_state_publisher + joint_state_publisher_gui + RViz2. NOT run in real ROS/RViz (no ROS install in the build environment); the URDF was instead checked with an offscreen renderer that resolves package:// URIs, mesh colours and TF frames the same way (zero pose, default stance, six official actions, soles from below).
- Tested with the 202 official .ubx actions (limits, directions, self-collision, ground contact): results in the chat; scripts are not included.
- `camera_link` / `camera_optical_frame`: lens centre of the small circle on the front face of the head (x=0.053, z=0.04937 in head_pitch_link); intrinsics unknown. The robot has no IMU, only an accelerometer on the head mainboard lying flat: `accel_link` (fixed to head_pitch_link, axes aligned with the head frame, position assumed at the head link centre of mass).
- Battery model (base_link inertial): 3 upright 18650 cells (18.3 x 65 mm, 50 g each) in a row across the back of the body, centres at x=-0.026, y=-0.0183/0/+0.0183, z=0.062 in base_link. The positions are assumed, not measured; change them in the base_link inertial comment/values if you know better.

## License
GPL-3.0-only (see `LICENSE`; `package.xml` license field). This covers the files generated here (URDF, SRDF, config, launch, scripts of this package). The mesh geometry is derived from the UBTECH Alpha 2 PC-software model / part exports supplied by the maintainer; this package does not grant any rights to that third-party material.

## Joint-limit decision
Limits are kept exactly at the measured servo min/max (SERVO_CALIBRATION) + Offset; they are intentionally NOT widened. About 10% of the frames in the 202 official .ubx actions (95 files) exceed them by up to 15 deg, mainly shoulder roll (servo 2/5); a controller that clamps to these limits will therefore play those frames slightly reduced.

## Known limits of the collision model
- The feet of the source model are 81.5 mm wide with their centres only ~78 mm apart, so the two ankle_roll links overlap by a few mm in the model itself (this shows up as a foot-foot collision in some poses, up to ~7 mm inside the joint limits).
- Collision pieces are inflated by CoACD pre-processing by a few mm in places (clamped to the visual bounding box, not to the exact surface).

## MuJoCo
- `urdf/alpha2_mujoco.urdf`: physics copy (collision pieces only, no visuals, no frame links, no base_footprint, MuJoCo `<compiler>` hints). `mujoco/stand_test.py`: free base + ground + position servos (kp 20, kv 0.5, per-servo torque limit 1.177 / 1.961 N*m) + joint armature 0.005 kg*m^2 + implicitfast integrator; needs `pip install mujoco`.
- Armature and implicitfast are required: the lightest links have principal inertia ~8e-7 kg*m^2 and are numerically unstable under servo stiffness with MuJoCo's default explicit integration (the robot tips over / explodes without them).
- Results (MuJoCo 3.15): URDF joint ranges/axes/origins agree with the independent FK to 0.00000 mm; total mass 2.300 kg; default stance holds for 5 s with ~0.5 deg tilt; 202 official actions replayed with position servos: 193 stay up, 9 fall (floor/one-leg motions without a balance controller); at mu = 1.0 the hip-roll servos appeared to saturate in ~30 actions (15-37 N*m demand): this was a friction artifact (feet gripping the floor while hips are commanded to slide). At mu = 0.5 only 1 of 193 upright actions exceeds the hip-roll stall torque (BackStand 4.2 N*m); the remaining over-stall cases are shoulder roll (12-14 actions) and head pitch (10 actions), partly from frames outside the calibrated limits and probably self-contact.

## Isaac Sim
Not run (no GPU in the build environment). `urdf/alpha2_isaac.urdf` (relative mesh paths), `isaac/import_and_stand.py` and `isaac/README.md` are prepared; offline pre-flight checks passed (see isaac/README.md).

## Gazebo
- Tested only with libsdformat 14 (the Gazebo Harmonic parser, built from source), NOT simulated (no Gazebo runtime/GPU in the build environment).
- `urdf/alpha2.urdf` loads with 0 errors/warnings: 23 links, 22 joints (20 revolute), total mass 2.30002 kg, no invalid inertias, 160 collisions, joint limits/effort/damping carried over.
- Gazebo drops massless links, so `camera_link` and `accel_link` (sensor mounts) carry a negligible 10 mg inertial and are kept with `<gazebo reference=... preserveFixedJoint>`; the other frames (sole, hand tips, camera optical) become SDF `<frame>` elements. Foot friction mu1/mu2 = 1.0 on both ankle_roll links.
- `model.sdf` + `model.config` (generated with sdformat; mesh URIs `model://alpha2_description/...`, all 181 resolve) and `gazebo/alpha2_world.sdf` (DART, ground, the model via <include>, 20 JointPositionController plugins: kp 20, kv 0.5, torque limit = servo stall torque). Use: `export GZ_SIM_RESOURCE_PATH=<parent of alpha2_description>; gz sim -r gazebo/alpha2_world.sdf`.
- Controller gains are the MuJoCo-test values; Gazebo has no joint armature setting, so the very small link inertias may make the servos jitter - lower kp/kd or step size if so. Gazebo Classic needs the URDF directly (the generated SDF is version 1.11).

## Friction (simulation)
Foot/ground friction was set to mu = 0.5 (Gazebo ankle mu1/mu2 and ground, MuJoCo stand_test FRICTION) after the 202-action tests: with mu = 1.0 the required hip-roll torque reached 15-37 N*m, with mu = 0.5 it falls to ~1-4 N*m. The real floor/foot friction is unknown; measure it (e.g. incline test) and change it.
