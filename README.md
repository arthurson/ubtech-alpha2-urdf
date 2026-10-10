# alpha2_description

Standard URDF of the UBTech Alpha 2 (20 revolute joints, 21 links), built from
`alpha2_21parts.zip` (OBJ parts) and the PC software's `alpha2.FBX` / `alpha2.xml`.

- Frame: REP-103 (x forward, y left, z up), metres, `base_link` = body (bady1) pivot.
- Zero pose = PC-software model pose (standing, arms down). All link frames are axis-aligned with `base_link` at q=0 and sit on the servo pivot.
- Part placement: the OBJ parts are not in the assembled pose; each object was matched to its FBX mesh (same name / vertex order) and mapped exactly (residual 0.001 mm). Only two small foot sub-parts per foot needed an affine fit.
- Joint axes: from `alpha2.xml` `<Axis>`; the PC software (UBXRobot3DView.dll) encodes it as an Euler channel (1x+2y+3z) and applies it on the FBX node, which reproduces the axes used here (head_yaw is about the parent vertical axis).
- Servo angle <-> q (from UBXRobot3DView.dll): rotation_deg = servo_angle_deg + Offset (alpha2.xml). So q_rad = radians(servo + Offset); q = 0 at servo = -Offset. EXCEPTION: head pitch (servo 20) uses q = servo - 120 (urdf_offset -120 in servo_map.yaml) because on the real robot servo 19/20 at 120 = head level/centred; the PC software Offset (-135) would tilt the model head up 15 deg at 120. Joint limits = measured servo min/max (ubtech-open-alpha2 `SERVO_CALIBRATION` (identical to ubtech-open-lynx)): lower = min+Offset, upper = max+Offset. PC default stance (servo = InitAngle) = q_init in `config/servo_map.yaml`: arms out to the sides (+-90 deg shoulder roll), hips/knees slightly flexed, feet flat.
- Still placeholders: inertials (2.3 kg total (user-stated). Explicit masses: 20 servos as point masses at their joint pivots in the child link (IDs 1-6 and 17-20: 40.3 g each; IDs 7-16: 52.8 g each) and 3 x 50 g 18650 cells in base_link. The remaining 1.219 kg (shell, mainboards, wiring) is distributed by hull volume. Servo bodies are placed at the pivot, not at their real centre; mainboards are not modelled separately), effort 1.5 N*m, velocity 5 rad/s. Direction: the PC software stores it only as the sign of `<Axis>` in alpha2.xml (no separate direction field anywhere in the PC software files); positive = right-hand rotation of (servo + Offset) about that axis (LibFBX uses the Autodesk FBX SDK). Consistent with a flat-foot / forward-knee check on the default stance; not yet measured on hardware.
- Visual meshes: full-resolution OBJ + original vertex colours baked into per-colour mtl materials (source geometry, only moved into link frames, no decimation); collision = convex hull (<= ~128 faces, a few more on hip rolls).
- View: `ros2 launch urdf_launch display.launch.py urdf_path_or_xacro:=<path>/urdf/alpha2.urdf` (needs package on the path for package:// URIs).

## Added frames / files
- `base_footprint` (root; ground point below base_link at the zero pose), `r_sole_frame`/`l_sole_frame` (sole-plane centre of each foot), `r_hand_tip`/`l_hand_tip` (lowest point of the hand link at the zero pose). Fixed joints, no mass.
- `config/alpha2.srdf`: planning groups (right_arm, left_arm, right_leg, left_leg, head, arms, legs, whole_body), group states (`zero`, `default_stance` = PC-software default stance) and a collision-disable table from convex hulls: 20 adjacent, 5 default-overlapping, 83 never colliding in 10,000 random samples within the joint limits. No virtual joint is defined.
- `launch/display.launch.py` + `rviz/alpha2.rviz`: robot_state_publisher + joint_state_publisher_gui + RViz2. NOT run in real ROS/RViz (no ROS install in the build environment); the URDF was instead checked with an offscreen renderer that resolves package:// URIs, mesh colours and TF frames the same way (zero pose, default stance, six official actions, soles from below).
- Tested with the 202 official .ubx actions (limits, directions, self-collision, ground contact): results in the chat; scripts are not included.
- `camera_link` / `camera_optical_frame`: lens centre of the small circle on the front face of the head (x=0.053, z=0.04937 in head_pitch_link); intrinsics unknown. The robot has no IMU, only an accelerometer on the head mainboard lying flat: `accel_link` (fixed to head_pitch_link, axes aligned with the head frame, position assumed at the head link centre of mass).
- Battery model (base_link inertial): 3 upright 18650 cells (18.3 x 65 mm, 50 g each) in a row across the back of the body, centres at x=-0.026, y=-0.0183/0/+0.0183, z=0.062 in base_link. The positions are assumed, not measured; change them in the base_link inertial comment/values if you know better.

## License
GPL-3.0-only (see `LICENSE`; `package.xml` license field). This covers the files generated here (URDF, SRDF, config, launch, scripts of this package). The mesh geometry is derived from the UBTECH Alpha 2 PC-software model / part exports supplied by the maintainer; this package does not grant any rights to that third-party material.

## Joint-limit decision
Limits are kept exactly at the measured servo min/max (SERVO_CALIBRATION) + Offset; they are intentionally NOT widened. About 10% of the frames in the 202 official .ubx actions (95 files) exceed them by up to 15 deg, mainly shoulder roll (servo 2/5); a controller that clamps to these limits will therefore play those frames slightly reduced.
