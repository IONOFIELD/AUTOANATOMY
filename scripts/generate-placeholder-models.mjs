/**
 * Generates the placeholder GLB models the app ships with:
 *
 *   public/models/vehicle.glb  — exterior shell: body panels, chassis/suspension,
 *                                wiring harness, and a low-detail engine proxy.
 *   public/models/engine.glb   — standalone detailed M275 V12 biturbo placeholder:
 *                                externals (block, turbos, intake, ancillaries) and
 *                                internals (crank, pistons, rods, cams, valvetrain).
 *
 * Fidelity target is "PS2-era racing game": recognizable sedan silhouette with
 * wheel arches, real wheels, coil springs, driveline and exhaust; an engine with
 * turbo scrolls, serpentine belt, a crankshaft with proper throws, cam lobes and
 * a timing chain. Still fully procedural — no external assets.
 *
 * Every mesh gets a stable, prefixed name (Body_*, Chassis_*, Susp_*, Harness_*,
 * EngineProxy_*, Eng_*, Int_*) so public/config/models.json can map meshes to
 * layers without hardcoding names in app code. Real scanned/CAD models replace
 * these GLBs later; only the config needs to change.
 *
 * Run: npm run generate:models
 */

// Minimal FileReader shim: GLTFExporter's binary path only calls
// readAsArrayBuffer and reads .result inside onloadend.
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      });
    }
  };
}

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models');
const DEG = Math.PI / 180;

const MATERIALS = {
  paint: { color: 0xb6bac0, metalness: 0.75, roughness: 0.35 },
  glass: { color: 0x88aec6, metalness: 0.2, roughness: 0.12, opacity: 0.45 },
  trim: { color: 0x1b1d21, metalness: 0.3, roughness: 0.6 },
  lightLens: { color: 0xd8e4ee, metalness: 0.1, roughness: 0.25, opacity: 0.85 },
  tailLens: { color: 0x8c1f24, metalness: 0.1, roughness: 0.3 },
  frame: { color: 0x4a4f57, metalness: 0.55, roughness: 0.6 },
  suspension: { color: 0x30343b, metalness: 0.6, roughness: 0.5 },
  spring: { color: 0x3d566e, metalness: 0.7, roughness: 0.4 },
  tire: { color: 0x141518, metalness: 0.0, roughness: 0.95 },
  rim: { color: 0xcdd2d8, metalness: 0.9, roughness: 0.25 },
  rotor: { color: 0x9aa0a6, metalness: 0.85, roughness: 0.35 },
  caliper: { color: 0xc7452b, metalness: 0.4, roughness: 0.5 },
  exhaustPipe: { color: 0x6f6a63, metalness: 0.8, roughness: 0.45 },
  tank: { color: 0x3a3f47, metalness: 0.5, roughness: 0.6 },
  harness: { color: 0xc98a1b, metalness: 0.1, roughness: 0.8 },
  battery: { color: 0x24313f, metalness: 0.2, roughness: 0.7 },
  radiator: { color: 0x565d66, metalness: 0.7, roughness: 0.55 },
  block: { color: 0xb0b5bc, metalness: 0.75, roughness: 0.4 },
  cover: { color: 0x3a3e46, metalness: 0.5, roughness: 0.5 },
  intake: { color: 0x454a52, metalness: 0.55, roughness: 0.5 },
  turbo: { color: 0xc8cdd3, metalness: 0.9, roughness: 0.3 },
  manifold: { color: 0x9c8b76, metalness: 0.75, roughness: 0.5 },
  pulley: { color: 0x6a7078, metalness: 0.8, roughness: 0.4 },
  belt: { color: 0x191a1d, metalness: 0.0, roughness: 0.9 },
  crank: { color: 0xd5d9de, metalness: 0.9, roughness: 0.3 },
  piston: { color: 0xe2e5e9, metalness: 0.85, roughness: 0.35 },
  rod: { color: 0xaeb3b9, metalness: 0.85, roughness: 0.4 },
  cam: { color: 0xc4c8cd, metalness: 0.9, roughness: 0.3 },
  chain: { color: 0x707680, metalness: 0.85, roughness: 0.45 },
  oil: { color: 0x4a4e55, metalness: 0.7, roughness: 0.5 },
};

/** One material instance per mesh so per-mesh highlighting never bleeds across parts. */
function makeMesh(name, geometry, matKey, { pos = [0, 0, 0], rot = [0, 0, 0] } = {}) {
  const spec = MATERIALS[matKey];
  const material = new THREE.MeshStandardMaterial({
    color: spec.color,
    metalness: spec.metalness,
    roughness: spec.roughness,
    transparent: spec.opacity !== undefined,
    opacity: spec.opacity ?? 1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...pos);
  mesh.rotation.set(...rot);
  return mesh;
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rTop, rBot, h, seg = 20) => new THREE.CylinderGeometry(rTop, rBot, h, seg);

/** Boxes/cylinders pre-positioned in local space, for merging into one mesh. */
function placed(geometry, pos = [0, 0, 0], rot = [0, 0, 0]) {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot));
  m.setPosition(...pos);
  geometry.applyMatrix4(m);
  return geometry;
}

/** Cylinder whose axis runs from p1 to p2 (radii r1 at p1, r2 at p2). */
function cylinderBetween(p1, p2, r1, r2, seg = 12) {
  const a = new THREE.Vector3(...p1);
  const b = new THREE.Vector3(...p2);
  const dir = b.clone().sub(a);
  const len = dir.length();
  const geom = new THREE.CylinderGeometry(r2, r1, len, seg);
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  geom.applyQuaternion(quat);
  geom.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return geom;
}

function tubeAlong(points, radius, closed = false, segments = 64) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed);
  return new THREE.TubeGeometry(curve, segments, radius, 10, closed);
}

/**
 * Extrude a profile drawn in the (carZ, carY) plane across the car's width.
 * `shapeFn` receives a THREE.Shape whose x axis is car-Z and y axis is car-Y.
 * The result is centred on x = 0 with total width `width`.
 */
function extrudeProfile(shapeFn, width, { bevel = 0.012 } = {}) {
  const shape = new THREE.Shape();
  shapeFn(shape);
  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
  });
  geom.rotateY(-Math.PI / 2); // shape-x -> car-Z, extrusion -> car-X
  geom.translate(width / 2, 0, 0);
  return geom;
}

/** A strip panel following a polyline in (z, y), given a thickness below the line. */
function stripPanel(points, thickness, width, opts) {
  return extrudeProfile((s) => {
    s.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
    for (let i = points.length - 1; i >= 0; i--) s.lineTo(points[i][0], points[i][1] - thickness);
    s.closePath();
  }, width, opts);
}

/* ------------------------------------------------------------------ */
/* Vehicle model — X: width, Y: up, Z: length (front = +Z)             */
/* W221-ish: length 5.1 m, width 1.86 m, wheelbase 3.16 m              */
/* ------------------------------------------------------------------ */
const AXLE_F = 1.58;
const AXLE_R = -1.58;
const WHEEL_R = 0.37;
const WHEEL_Y = 0.37;
const ARCH_R = 0.45;
const SIDE_X = 0.90; // outer skin
const BELT_Y = 1.0; // beltline

/** Side panel between two z stations with optional wheel-arch cutouts. */
function sidePanelGeom({ zFront, zRear, yTopFront, yTopRear, yBottom = 0.27, arches = [] }) {
  return extrudeProfile((s) => {
    s.moveTo(zFront, yTopFront);
    s.lineTo(zRear, yTopRear);
    s.lineTo(zRear, yBottom);
    // bottom edge rear -> front (z increasing), carving arch notches over the top
    const sorted = [...arches].sort((a, b) => a - b);
    for (const zc of sorted) {
      const dy = WHEEL_Y - yBottom; // arch centre sits above the bottom edge
      const dx = Math.sqrt(ARCH_R * ARCH_R - dy * dy);
      const a0 = Math.atan2(yBottom - WHEEL_Y, -dx);
      const a1 = Math.atan2(yBottom - WHEEL_Y, dx);
      s.lineTo(zc - dx, yBottom);
      s.absarc(zc, WHEEL_Y, ARCH_R, a0, a1, true);
    }
    s.lineTo(zFront, yBottom);
    s.closePath();
  }, 0.06);
}

function buildVehicle() {
  const root = new THREE.Group();
  root.name = 'W221_Vehicle';
  const add = (...meshes) => meshes.forEach((m) => root.add(m));

  /* ---- Layer 1: body panels ---- */
  add(
    makeMesh('Body_Hood', stripPanel([[2.50, 0.78], [1.60, 0.88], [0.95, 0.96]], 0.05, 1.58), 'paint'),
    makeMesh('Body_Windshield_Front', stripPanel([[0.90, 0.97], [0.35, 1.41]], 0.04, 1.42, { bevel: 0 }), 'glass'),
    makeMesh('Body_Roof', stripPanel([[0.36, 1.42], [-0.92, 1.43]], 0.05, 1.46), 'paint'),
    makeMesh('Body_Windshield_Rear', stripPanel([[-0.94, 1.42], [-1.55, 1.09]], 0.04, 1.40, { bevel: 0 }), 'glass'),
    makeMesh('Body_TrunkLid', stripPanel([[-1.57, 1.08], [-2.44, 1.01]], 0.05, 1.58), 'paint'),
    makeMesh('Body_TailPanel', box(1.62, 0.28, 0.07), 'paint', { pos: [0, 0.85, -2.48] }),
    makeMesh('Body_NosePanel', box(1.66, 0.16, 0.07), 'paint', { pos: [0, 0.68, 2.50] }),
    makeMesh(
      'Body_Bumper_Front',
      extrudeProfile((s) => {
        s.moveTo(2.40, 0.34);
        s.lineTo(2.40, 0.62);
        s.lineTo(2.56, 0.62);
        s.quadraticCurveTo(2.64, 0.60, 2.64, 0.50);
        s.quadraticCurveTo(2.64, 0.36, 2.54, 0.34);
        s.closePath();
      }, 1.84),
      'paint',
    ),
    makeMesh(
      'Body_Bumper_Rear',
      extrudeProfile((s) => {
        s.moveTo(-2.40, 0.34);
        s.lineTo(-2.40, 0.62);
        s.lineTo(-2.56, 0.62);
        s.quadraticCurveTo(-2.64, 0.60, -2.64, 0.50);
        s.quadraticCurveTo(-2.64, 0.36, -2.54, 0.34);
        s.closePath();
      }, 1.84),
      'paint',
    ),
    makeMesh('Body_Grille', box(0.58, 0.17, 0.05), 'trim', { pos: [0, 0.69, 2.54], rot: [-0.10, 0, 0] }),
    makeMesh('Body_GrilleLouvres', mergeGeometries([
      placed(box(0.61, 0.018, 0.065), [0, 0.05, 0]),
      placed(box(0.61, 0.018, 0.065), [0, 0, 0]),
      placed(box(0.61, 0.018, 0.065), [0, -0.05, 0]),
    ]), 'rim', { pos: [0, 0.69, 2.545], rot: [-0.10, 0, 0] }),
    makeMesh('Body_BumperIntake_L', box(0.44, 0.15, 0.04), 'trim', { pos: [-0.55, 0.45, 2.625] }),
    makeMesh('Body_BumperIntake_R', box(0.44, 0.15, 0.04), 'trim', { pos: [0.55, 0.45, 2.625] }),
    makeMesh('Body_BumperIntake_Center', box(0.50, 0.12, 0.04), 'trim', { pos: [0, 0.43, 2.635] }),
    makeMesh('Body_Headlight_L', box(0.36, 0.11, 0.10), 'lightLens', { pos: [-0.58, 0.70, 2.52], rot: [0, 0.12, 0] }),
    makeMesh('Body_Headlight_R', box(0.36, 0.11, 0.10), 'lightLens', { pos: [0.58, 0.70, 2.52], rot: [0, -0.12, 0] }),
    makeMesh('Body_Taillight_L', box(0.44, 0.12, 0.08), 'tailLens', { pos: [-0.58, 0.93, -2.50], rot: [0, -0.10, 0] }),
    makeMesh('Body_Taillight_R', box(0.44, 0.12, 0.08), 'tailLens', { pos: [0.58, 0.93, -2.50], rot: [0, 0.10, 0] }),
  );

  // simple cabin so the greenhouse doesn't look hollow (Body_* -> body layer)
  const steeringWheel = new THREE.TorusGeometry(0.095, 0.016, 8, 20);
  add(
    makeMesh('Body_InteriorDash', mergeGeometries([
      placed(box(1.36, 0.16, 0.34), [0, 0.90, 0.60]),
      placed(box(0.22, 0.26, 0.90), [0, 0.62, 0.15]), // centre console
    ]), 'trim'),
    makeMesh('Body_InteriorSteeringWheel', steeringWheel, 'trim', {
      pos: [-0.36, 0.94, 0.38], rot: [Math.PI / 2 - 0.5, 0, 0],
    }),
    makeMesh('Body_InteriorSeat_FL', mergeGeometries([
      placed(box(0.46, 0.12, 0.50), [0, 0.62, 0]),
      placed(box(0.46, 0.55, 0.12), [0, 0.86, -0.28], [-0.18, 0, 0]),
    ]), 'trim', { pos: [-0.36, 0, -0.10] }),
    makeMesh('Body_InteriorSeat_FR', mergeGeometries([
      placed(box(0.46, 0.12, 0.50), [0, 0.62, 0]),
      placed(box(0.46, 0.55, 0.12), [0, 0.86, -0.28], [-0.18, 0, 0]),
    ]), 'trim', { pos: [0.36, 0, -0.10] }),
    makeMesh('Body_InteriorRearBench', mergeGeometries([
      placed(box(1.30, 0.14, 0.48), [0, 0.62, 0]),
      placed(box(1.30, 0.52, 0.12), [0, 0.86, -0.26], [-0.22, 0, 0]),
    ]), 'trim', { pos: [0, 0, -1.10] }),
  );

  for (const [side, sign] of [['L', -1], ['R', 1]]) {
    const x = sign * SIDE_X;
    const panel = (name, geom) => {
      const mesh = makeMesh(name, geom, 'paint');
      mesh.position.x = x - 0.03 * sign; // geometry is centred on x=0 with 0.06 thickness
      add(mesh);
    };
    panel(`Body_Fender_F${side}`, sidePanelGeom({
      zFront: 2.48, zRear: 0.95, yTopFront: 0.80, yTopRear: 0.98, arches: [AXLE_F],
    }));
    panel(`Body_Door_F${side}`, sidePanelGeom({
      zFront: 0.95, zRear: -0.05, yTopFront: BELT_Y, yTopRear: BELT_Y,
    }));
    panel(`Body_Door_R${side}`, sidePanelGeom({
      zFront: -0.05, zRear: -1.00, yTopFront: BELT_Y, yTopRear: BELT_Y,
    }));
    panel(`Body_QuarterPanel_${side}`, sidePanelGeom({
      zFront: -1.00, zRear: -2.48, yTopFront: BELT_Y, yTopRear: 0.98, arches: [AXLE_R],
    }));
    // greenhouse side glass
    const glass = makeMesh(`Body_Glass_Side_${side}`, extrudeProfile((s) => {
      s.moveTo(0.62, 1.01);
      s.lineTo(0.32, 1.38);
      s.lineTo(-0.90, 1.40);
      s.lineTo(-1.45, 1.02);
      s.closePath();
    }, 0.03, { bevel: 0 }), 'glass');
    glass.position.x = sign * 0.70;
    add(glass);
    add(
      makeMesh(`Body_Pillars_${side}`, mergeGeometries([
        cylinderBetween([sign * 0.86, 1.00, 0.88], [sign * 0.71, 1.40, 0.36], 0.035, 0.030), // A-pillar
        cylinderBetween([sign * 0.86, 1.00, -0.06], [sign * 0.72, 1.41, -0.16], 0.030, 0.028), // B-pillar
        cylinderBetween([sign * 0.86, 1.00, -1.46], [sign * 0.72, 1.42, -0.90], 0.062, 0.048), // C-pillar
      ]), 'paint'),
      makeMesh(`Body_Sill_${side}`, box(0.08, 0.13, 2.95), 'trim', { pos: [x, 0.225, -0.02] }),
      makeMesh(`Body_Mirror_${side}`, box(0.16, 0.09, 0.07), 'paint', { pos: [sign * 1.0, 1.08, 0.52] }),
    );
  }

  /* ---- Layer 2: frame / chassis + suspension ---- */
  add(
    makeMesh('Chassis_Floorpan', mergeGeometries([
      placed(box(1.70, 0.06, 4.40), [0, 0.30, -0.05]),
      placed(box(0.30, 0.16, 3.10), [0, 0.40, 0.10]), // transmission tunnel
    ]), 'frame'),
    makeMesh('Chassis_Rail_L', box(0.12, 0.16, 4.86), 'frame', { pos: [-0.64, 0.40, 0] }),
    makeMesh('Chassis_Rail_R', box(0.12, 0.16, 4.86), 'frame', { pos: [0.64, 0.40, 0] }),
    makeMesh('Chassis_Crossmember_Front', box(1.34, 0.10, 0.12), 'frame', { pos: [0, 0.38, 2.30] }),
    makeMesh('Chassis_Crossmember_Mid', box(1.34, 0.10, 0.12), 'frame', { pos: [0, 0.34, 0.0] }),
    makeMesh('Chassis_Crossmember_Rear', box(1.34, 0.10, 0.12), 'frame', { pos: [0, 0.38, -2.30] }),
    makeMesh('Chassis_Subframe_Front', box(1.24, 0.12, 0.70), 'suspension', { pos: [0, 0.34, AXLE_F] }),
    makeMesh('Chassis_Subframe_Rear', box(1.24, 0.12, 0.70), 'suspension', { pos: [0, 0.34, AXLE_R] }),
    makeMesh('Chassis_Firewall', box(1.52, 0.62, 0.06), 'frame', { pos: [0, 0.72, 0.95] }),
    makeMesh('Chassis_Radiator', box(0.92, 0.44, 0.07), 'radiator', { pos: [0, 0.62, 2.36] }),
    makeMesh('Chassis_Driveshaft', cyl(0.042, 0.042, 2.35, 14), 'suspension', {
      pos: [0, 0.42, -0.30], rot: [Math.PI / 2, 0, 0],
    }),
    makeMesh('Chassis_Differential', mergeGeometries([
      placed(box(0.32, 0.28, 0.30), [0, 0, 0]),
      placed(cyl(0.035, 0.035, 1.10, 12), [0, 0, 0], [0, 0, Math.PI / 2]), // axle shafts
    ]), 'suspension', { pos: [0, 0.40, AXLE_R] }),
    makeMesh('Chassis_FuelTank', box(1.10, 0.24, 0.52), 'tank', { pos: [0, 0.50, -2.02] }),
    makeMesh('Chassis_SteeringRack', cyl(0.035, 0.035, 1.24, 12), 'suspension', {
      pos: [0, 0.40, 1.86], rot: [0, 0, Math.PI / 2],
    }),
    makeMesh('Chassis_Exhaust_L', mergeGeometries([
      tubeAlong([[-0.28, 0.28, 1.05], [-0.34, 0.26, -0.4], [-0.36, 0.28, -1.6], [-0.38, 0.30, -2.30]], 0.038),
      placed(cyl(0.09, 0.09, 0.55, 14), [-0.37, 0.30, -1.95], [Math.PI / 2, 0, 0]), // muffler
    ]), 'exhaustPipe'),
    makeMesh('Chassis_Exhaust_R', mergeGeometries([
      tubeAlong([[0.28, 0.28, 1.05], [0.34, 0.26, -0.4], [0.36, 0.28, -1.6], [0.38, 0.30, -2.30]], 0.038),
      placed(cyl(0.09, 0.09, 0.55, 14), [0.37, 0.30, -1.95], [Math.PI / 2, 0, 0]),
    ]), 'exhaustPipe'),
    // S65 signature: chromed quad oval tips, two per side, poking past the bumper
    ...[-1, 1].map((sx) => {
      const ovalTip = () => {
        const g = cyl(0.042, 0.042, 0.16, 16);
        g.rotateX(Math.PI / 2);
        g.scale(1, 0.75, 1);
        return g;
      };
      return makeMesh(`Chassis_ExhaustTips_${sx < 0 ? 'L' : 'R'}`, mergeGeometries([
        placed(ovalTip(), [sx * 0.46, 0.36, -2.62]),
        placed(ovalTip(), [sx * 0.34, 0.36, -2.62]),
      ]), 'rim');
    }),
  );

  for (const [corner, sx, z] of [['FL', -1, AXLE_F], ['FR', 1, AXLE_F], ['RL', -1, AXLE_R], ['RR', 1, AXLE_R]]) {
    const wx = sx * 0.80;
    // tire: torus, axis along X
    const tire = new THREE.TorusGeometry(0.27, 0.10, 14, 28);
    tire.rotateY(Math.PI / 2);
    add(
      makeMesh(`Susp_Tire_${corner}`, tire, 'tire', { pos: [wx, WHEEL_Y, z] }),
      makeMesh(`Susp_Rim_${corner}`, mergeGeometries([
        placed(cyl(0.20, 0.20, 0.14, 22), [0, 0, 0], [0, 0, Math.PI / 2]), // barrel
        placed(cyl(0.070, 0.070, 0.21, 14), [0, 0, 0], [0, 0, Math.PI / 2]), // hub
        // five spokes on the outboard face
        ...Array.from({ length: 5 }, (_, s) => {
          const spoke = box(0.030, 0.045, 0.13); // axial x radial, fanned around the X axis
          spoke.translate(0, 0, 0.115);
          spoke.rotateX((s / 5) * Math.PI * 2);
          return placed(spoke, [sx * 0.075, 0, 0]);
        }),
      ]), 'rim', { pos: [wx, WHEEL_Y, z] }),
      makeMesh(`Susp_BrakeRotor_${corner}`, cyl(0.155, 0.155, 0.028, 24), 'rotor', {
        pos: [sx * 0.64, WHEEL_Y, z], rot: [0, 0, Math.PI / 2],
      }),
      makeMesh(`Susp_BrakeCaliper_${corner}`, box(0.06, 0.10, 0.16), 'caliper', {
        pos: [sx * 0.64, WHEEL_Y + 0.11, z + 0.06],
      }),
      makeMesh(`Susp_ControlArm_${corner}`, mergeGeometries([
        cylinderBetween([sx * 0.30, 0.34, z + 0.16], [sx * 0.68, WHEEL_Y - 0.04, z], 0.022, 0.022),
        cylinderBetween([sx * 0.30, 0.34, z - 0.16], [sx * 0.68, WHEEL_Y - 0.04, z], 0.022, 0.022),
      ]), 'suspension'),
      makeMesh(`Susp_ABCStrut_${corner}`, mergeGeometries([
        placed(cyl(0.032, 0.032, 0.34, 12), [0, 0.17, 0]),
        tubeAlong(
          Array.from({ length: 33 }, (_, i) => {
            const t = (i / 32) * Math.PI * 2 * 4.5;
            return [0.062 * Math.cos(t), 0.02 + (0.30 * i) / 32, 0.062 * Math.sin(t)];
          }),
          0.011, false, 96,
        ),
      ]), 'spring', { pos: [sx * 0.62, 0.42, z], rot: [0, 0, -sx * 0.12] }),
    );
  }

  /* ---- Layer 3: wiring harness (simplified) ---- */
  add(
    makeMesh('Harness_Main', tubeAlong([
      [0.58, 0.44, 2.1], [0.64, 0.42, 0.9], [0.66, 0.40, -0.5], [0.62, 0.42, -1.9], [0.2, 0.50, -2.2],
    ], 0.032), 'harness'),
    makeMesh('Harness_EngineBay', tubeAlong([
      [-0.55, 0.76, 1.2], [-0.3, 0.82, 1.7], [0.25, 0.82, 1.9], [0.55, 0.74, 1.4],
    ], 0.028), 'harness'),
    makeMesh('Harness_Dash', tubeAlong([
      [-0.65, 0.86, 0.68], [0, 0.90, 0.72], [0.65, 0.86, 0.68],
    ], 0.028), 'harness'),
    makeMesh('Harness_Battery', box(0.34, 0.20, 0.20), 'battery', { pos: [0.52, 0.56, -2.12] }),
    makeMesh('Harness_FuseBox_EngineBay', box(0.24, 0.10, 0.18), 'battery', { pos: [-0.58, 0.80, 1.15] }),
    makeMesh('Harness_ECU', box(0.20, 0.06, 0.26), 'battery', { pos: [0.58, 0.78, 1.05] }),
  );

  /* ---- Layer 4 (proxy): low-detail engine so the bay isn't empty ---- */
  const bank = Math.PI / 6;
  add(
    makeMesh('EngineProxy_Block', mergeGeometries([
      placed(box(0.40, 0.24, 0.85), [0, 0, 0]),
      placed(box(0.20, 0.26, 0.82), [-0.12, 0.17, 0], [0, 0, bank]),
      placed(box(0.20, 0.26, 0.82), [0.12, 0.17, 0], [0, 0, -bank]),
      placed(box(0.26, 0.07, 0.62), [0, 0.28, 0]), // intake hat
    ]), 'block', { pos: [0, 0.52, 1.62] }),
    makeMesh('EngineProxy_Turbo_L', cyl(0.075, 0.075, 0.18, 16), 'turbo', {
      pos: [-0.38, 0.45, 1.50], rot: [Math.PI / 2, 0, 0],
    }),
    makeMesh('EngineProxy_Turbo_R', cyl(0.075, 0.075, 0.18, 16), 'turbo', {
      pos: [0.38, 0.45, 1.50], rot: [Math.PI / 2, 0, 0],
    }),
    makeMesh('EngineProxy_Transmission', cyl(0.13, 0.18, 0.72, 16), 'cover', {
      pos: [0, 0.47, 0.72], rot: [Math.PI / 2, 0, 0],
    }),
  );

  return root;
}

/* ------------------------------------------------------------------ */
/* Engine model — M275 6.0L V12 biturbo placeholder                    */
/* X: width, Y: up, Z: crank axis (front of engine = +Z)               */
/* 60° V (banks ±30° from vertical), SOHC, one cam per bank            */
/* ------------------------------------------------------------------ */
const BANK_ANGLE = Math.PI / 6; // 30° from vertical per bank
const CYL_PER_BANK = 6;
const BORE_SPACING = 0.145;
const CRANK_Y = 0.35;
const THROW_R = 0.05; // crank throw radius
const ROD_L = 0.21; // connecting rod length
const BLOCK_LEN = CYL_PER_BANK * BORE_SPACING + 0.18;
// even-fire 60° V12: throws paired 0/120/240 degrees, mirrored back half
const THROW_ANGLES = [0, 120, 240, 240, 120, 0].map((d) => d * DEG);

/** Point `along` metres up a bank centreline from the crank axis (side: -1 L, +1 R). */
function bankPoint(side, along, z) {
  return [side * Math.sin(BANK_ANGLE) * along, CRANK_Y + Math.cos(BANK_ANGLE) * along, z];
}

const boreZ = (i) => (i - (CYL_PER_BANK - 1) / 2) * BORE_SPACING;

/** Crankpin centre for throw i (crank axis along Z at (0, CRANK_Y)). */
function pinCenter(i, z) {
  const a = THROW_ANGLES[i];
  return [THROW_R * Math.sin(a), CRANK_Y + THROW_R * Math.cos(a), z];
}

/** Piston pin distance along the bank axis for throw angle `a` (slider-crank). */
function pistonTravel(side, a) {
  const bankFromVertical = side * BANK_ANGLE;
  const rel = a - bankFromVertical;
  const s = THROW_R * Math.sin(rel);
  return THROW_R * Math.cos(rel) + Math.sqrt(ROD_L * ROD_L - s * s);
}

function buildEngine() {
  const root = new THREE.Group();
  root.name = 'M275_Engine';
  const add = (...meshes) => meshes.forEach((m) => root.add(m));
  const zFront = BLOCK_LEN / 2;

  /* ---- Layer 4: engine externals ---- */
  add(
    makeMesh('Eng_Block', mergeGeometries([
      placed(box(0.46, 0.30, BLOCK_LEN), [0, CRANK_Y + 0.04, 0]),
      placed(cyl(0.06, 0.06, 0.06, 16), [0, CRANK_Y, zFront + 0.02], [Math.PI / 2, 0, 0]), // crank nose boss
    ]), 'block'),
    makeMesh('Eng_OilPan', mergeGeometries([
      placed(box(0.42, 0.09, BLOCK_LEN - 0.10), [0, CRANK_Y - 0.155, 0]),
      placed(box(0.34, 0.13, 0.48), [0, - 0.24 + CRANK_Y, 0.18]), // deep sump forward
    ]), 'oil'),
    makeMesh('Eng_IntakeManifold', mergeGeometries([
      placed(box(0.36, 0.11, BLOCK_LEN - 0.28), [0, CRANK_Y + 0.56, 0]),
      ...Array.from({ length: CYL_PER_BANK * 2 }, (_, k) => {
        const side = k < CYL_PER_BANK ? -1 : 1;
        const z = boreZ(k % CYL_PER_BANK);
        return cylinderBetween(
          [side * 0.10, CRANK_Y + 0.52, z],
          bankPoint(side, 0.54, z),
          0.022, 0.022, 8,
        );
      }),
    ]), 'intake'),
    makeMesh('Eng_ThrottleBody_L', cyl(0.045, 0.045, 0.10, 14), 'turbo', {
      pos: [-0.10, CRANK_Y + 0.56, zFront - 0.10], rot: [Math.PI / 2, 0, 0],
    }),
    makeMesh('Eng_ThrottleBody_R', cyl(0.045, 0.045, 0.10, 14), 'turbo', {
      pos: [0.10, CRANK_Y + 0.56, zFront - 0.10], rot: [Math.PI / 2, 0, 0],
    }),
    makeMesh('Eng_FrontCover', box(0.50, 0.52, 0.045), 'cover', { pos: [0, CRANK_Y + 0.16, zFront + 0.05] }),
    makeMesh('Eng_CrankPulley', mergeGeometries([
      placed(cyl(0.085, 0.085, 0.030, 22), [0, 0, 0]),
      placed(cyl(0.055, 0.055, 0.060, 18), [0, 0.01, 0]),
    ]), 'pulley', { pos: [0, CRANK_Y, zFront + 0.10], rot: [Math.PI / 2, 0, 0] }),
    makeMesh('Eng_Alternator', mergeGeometries([
      placed(cyl(0.072, 0.072, 0.14, 18), [0, 0, 0]),
      placed(cyl(0.035, 0.035, 0.03, 12), [0, 0.085, 0]), // pulley
    ]), 'pulley', { pos: [-0.28, CRANK_Y - 0.02, zFront + 0.06], rot: [Math.PI / 2, 0, 0] }),
    makeMesh('Eng_ACCompressor', mergeGeometries([
      placed(cyl(0.065, 0.065, 0.15, 18), [0, 0, 0]),
      placed(cyl(0.045, 0.045, 0.03, 12), [0, 0.09, 0]),
    ]), 'pulley', { pos: [0.28, CRANK_Y - 0.06, zFront + 0.06], rot: [Math.PI / 2, 0, 0] }),
    makeMesh('Eng_ABCTandemPump', cyl(0.055, 0.055, 0.12, 16), 'pulley', {
      pos: [-0.20, CRANK_Y + 0.22, zFront + 0.06], rot: [Math.PI / 2, 0, 0],
    }),
    makeMesh('Eng_OilFilter', cyl(0.045, 0.045, 0.11, 14), 'trim', {
      pos: [0.26, CRANK_Y - 0.10, zFront - 0.20], rot: [0, 0, Math.PI / 2],
    }),
    // serpentine belt: closed loop threading the front pulleys
    makeMesh('Eng_SerpentineBelt', tubeAlong([
      [0, CRANK_Y - 0.095, 0], [0.10, CRANK_Y - 0.09, 0],
      [0.315, CRANK_Y - 0.10, 0], [0.36, CRANK_Y - 0.05, 0], [0.30, CRANK_Y + 0.01, 0],
      [0.12, CRANK_Y + 0.06, 0], [-0.14, CRANK_Y + 0.29, 0], [-0.245, CRANK_Y + 0.26, 0],
      [-0.30, CRANK_Y + 0.05, 0], [-0.345, CRANK_Y - 0.04, 0], [-0.28, CRANK_Y - 0.095, 0],
      [-0.10, CRANK_Y - 0.095, 0],
    ].map(([x, y]) => [x, y, zFront + 0.10]), 0.009, true, 128), 'belt'),
  );

  for (const [tag, side] of [['L', -1], ['R', 1]]) {
    const turboPos = [side * 0.50, CRANK_Y - 0.02, 0.10];
    add(
      makeMesh(`Eng_CylinderBank_${tag}`, mergeGeometries([
        placed(box(0.26, 0.30, BLOCK_LEN), bankPoint(side, 0.26, 0), [0, 0, side * -BANK_ANGLE]),
        placed(box(0.27, 0.10, BLOCK_LEN - 0.04), bankPoint(side, 0.45, 0), [0, 0, side * -BANK_ANGLE]), // head
      ]), 'block'),
      makeMesh(`Eng_HeadCover_${tag}`, mergeGeometries([
        placed(box(0.24, 0.07, BLOCK_LEN - 0.10), [0, 0, 0]),
        placed(box(0.20, 0.025, BLOCK_LEN - 0.30), [0, 0.045, 0]), // crown rib
      ]), 'cover', { pos: bankPoint(side, 0.55, 0), rot: [0, 0, side * -BANK_ANGLE] }),
      makeMesh(`Eng_ExhaustManifold_${tag}`, mergeGeometries([
        tubeAlong([
          bankPoint(side, 0.30, zFront - 0.15),
          [side * 0.40, CRANK_Y + 0.12, zFront - 0.32],
          [side * 0.42, CRANK_Y + 0.06, 0.24],
          [turboPos[0], turboPos[1] + 0.05, turboPos[2] + 0.04],
        ], 0.030),
        tubeAlong([
          bankPoint(side, 0.30, -zFront + 0.15),
          [side * 0.40, CRANK_Y + 0.12, -zFront + 0.32],
          [side * 0.42, CRANK_Y + 0.06, -0.04],
          [turboPos[0], turboPos[1] + 0.05, turboPos[2] - 0.02],
        ], 0.030),
      ]), 'manifold'),
      // turbo: volute scroll + compressor cone + centre housing
      makeMesh(`Eng_Turbo_${tag}`, mergeGeometries([
        placed(new THREE.TorusGeometry(0.055, 0.030, 12, 24, Math.PI * 1.7), [0, 0, 0.045], [0, 0, 0]),
        placed(cyl(0.062, 0.062, 0.07, 18), [0, 0, -0.01], [Math.PI / 2, 0, 0]),
        placed(cyl(0.030, 0.052, 0.05, 14), [0, 0, -0.065], [Math.PI / 2, 0, 0]), // compressor inlet
      ]), 'turbo', { pos: turboPos }),
      makeMesh(`Eng_Downpipe_${tag}`, tubeAlong([
        [turboPos[0], turboPos[1] - 0.03, turboPos[2]],
        [side * 0.48, CRANK_Y - 0.16, -0.15],
        [side * 0.42, CRANK_Y - 0.18, -0.55],
      ], 0.034), 'exhaustPipe'),
      makeMesh(`Eng_Intercooler_${tag}`, mergeGeometries([
        placed(box(0.15, 0.09, 0.42), [0, 0, 0]),
        placed(box(0.16, 0.012, 0.43), [0, 0.028, 0]),
        placed(box(0.16, 0.012, 0.43), [0, -0.028, 0]), // fin bands
      ]), 'turbo', { pos: [side * 0.13, CRANK_Y + 0.665, 0] }),
      makeMesh(`Eng_ChargePipe_${tag}`, tubeAlong([
        [turboPos[0], turboPos[1] + 0.02, turboPos[2] - 0.07],
        [side * 0.40, CRANK_Y + 0.38, 0.38],
        [side * 0.24, CRANK_Y + 0.58, 0.30],
        [side * 0.13, CRANK_Y + 0.645, 0.21],
      ], 0.026), 'turbo'),
    );
  }

  /* ---- Layer 5: engine internals ---- */
  // Crankshaft: nose + 7 main journals + 6 offset crankpins + webs, one mesh.
  const crankParts = [
    placed(cyl(0.030, 0.030, 0.14, 12), [0, CRANK_Y, zFront + 0.05], [Math.PI / 2, 0, 0]), // nose
  ];
  for (let j = 0; j <= CYL_PER_BANK; j++) {
    const z = j === 0 ? boreZ(0) + BORE_SPACING / 2 + 0.02 : boreZ(j - 1) - BORE_SPACING / 2 - 0.02;
    // main journals sit between throws
    crankParts.push(placed(cyl(0.045, 0.045, 0.045, 14), [0, CRANK_Y, z + (j === 0 ? 0.02 : 0.02)], [Math.PI / 2, 0, 0]));
  }
  for (let i = 0; i < CYL_PER_BANK; i++) {
    const z = boreZ(i);
    const [px, py] = pinCenter(i, z);
    crankParts.push(placed(cyl(0.040, 0.040, 0.075, 14), [px, py, z], [Math.PI / 2, 0, 0])); // crankpin
    const a = THROW_ANGLES[i];
    for (const dz of [-0.052, 0.052]) {
      const web = box(0.055, 0.155, 0.022);
      crankParts.push(placed(web, [px / 2, CRANK_Y + (py - CRANK_Y) / 2, z + dz], [0, 0, -a]));
    }
  }
  crankParts.push(placed(cyl(0.05, 0.05, 0.05, 14), [0, CRANK_Y, -zFront - 0.02], [Math.PI / 2, 0, 0])); // flange
  add(makeMesh('Int_Crankshaft', mergeGeometries(crankParts), 'crank'));

  add(makeMesh('Int_Flywheel', mergeGeometries([
    placed(cyl(0.165, 0.165, 0.030, 28), [0, 0, 0]),
    placed(new THREE.TorusGeometry(0.165, 0.012, 8, 36), [0, 0.015, 0], [Math.PI / 2, 0, 0]), // ring gear
  ]), 'crank', { pos: [0, CRANK_Y, -zFront - 0.065], rot: [Math.PI / 2, 0, 0] }));

  // Pistons + rods, phased off the shared crankpins (right bank = cyl 1–6).
  let cylNo = 1;
  for (const [, side] of [['R', 1], ['L', -1]]) {
    for (let i = 0; i < CYL_PER_BANK; i++) {
      const z = boreZ(i) + side * 0.028; // paired rods sit side by side on the pin
      const pin = pinCenter(i, z);
      const travel = pistonTravel(side, THROW_ANGLES[i]);
      const pp = bankPoint(side, travel, z); // piston pin position
      add(
        makeMesh(`Int_Piston_${cylNo}`, mergeGeometries([
          placed(cyl(0.047, 0.047, 0.050, 18), [0, 0.025, 0]), // crown+rings land
          placed(cyl(0.044, 0.044, 0.035, 18), [0, -0.017, 0]), // skirt
          placed(new THREE.TorusGeometry(0.047, 0.004, 6, 20), [0, 0.045, 0], [Math.PI / 2, 0, 0]),
        ]), 'piston', { pos: [pp[0], pp[1], pp[2]], rot: [0, 0, side * -BANK_ANGLE] }),
        makeMesh(`Int_ConnectingRod_${cylNo}`, mergeGeometries([
          cylinderBetween(pin, pp, 0.016, 0.011, 10),
          placed(new THREE.TorusGeometry(0.046, 0.013, 8, 18), [pin[0], pin[1], pin[2]]), // big end
        ]), 'rod'),
      );
      cylNo++;
    }
  }

  // SOHC valvetrain: one cam per bank with lobes, valves, sprockets + chain.
  for (const [tag, side] of [['R', 1], ['L', -1]]) {
    const camAlong = 0.52;
    const [cx, cy] = bankPoint(side, camAlong, 0);
    const camParts = [placed(cyl(0.022, 0.022, BLOCK_LEN - 0.12, 12), [0, 0, 0], [Math.PI / 2, 0, 0])];
    for (let i = 0; i < CYL_PER_BANK; i++) {
      for (const dz of [-0.03, 0.03]) {
        const lobeAngle = THROW_ANGLES[i] / 2 + dz * 20;
        camParts.push(placed(
          cyl(0.034, 0.034, 0.018, 12),
          [0.009 * Math.sin(lobeAngle), 0.009 * Math.cos(lobeAngle), boreZ(i) + dz],
          [Math.PI / 2, 0, 0],
        ));
      }
    }
    add(makeMesh(`Int_Camshaft_${tag}`, mergeGeometries(camParts), 'cam', { pos: [cx, cy, 0] }));

    // three valves per cylinder (2 intake in-board, 1 exhaust out-board)
    const valveParts = [];
    for (let i = 0; i < CYL_PER_BANK; i++) {
      const z = boreZ(i);
      for (const [dxAcross, dzOff] of [[-0.045, -0.03], [-0.045, 0.03], [0.055, 0]]) {
        const base = bankPoint(side, 0.40, z + dzOff);
        const tip = bankPoint(side, 0.49, z + dzOff);
        valveParts.push(mergeGeometries([
          cylinderBetween(
            [base[0] + side * dxAcross, base[1], base[2]],
            [tip[0] + side * dxAcross, tip[1], tip[2]],
            0.006, 0.006, 8,
          ),
          placed(cyl(0.016, 0.016, 0.006, 10), [base[0] + side * dxAcross, base[1], base[2]], [0, 0, side * -BANK_ANGLE]),
        ]));
      }
    }
    add(makeMesh(`Int_Valves_${tag}`, mergeGeometries(valveParts), 'rod'));

    add(makeMesh(`Int_CamSprocket_${tag}`, cyl(0.052, 0.052, 0.022, 20), 'chain', {
      pos: [cx, cy, zFront + 0.02], rot: [Math.PI / 2, 0, 0],
    }));
  }

  const [lx, ly] = bankPoint(-1, 0.52, 0);
  const [rx, ry] = bankPoint(1, 0.52, 0);
  add(
    makeMesh('Int_CrankSprocket', cyl(0.038, 0.038, 0.022, 18), 'chain', {
      pos: [0, CRANK_Y, zFront + 0.02], rot: [Math.PI / 2, 0, 0],
    }),
    // duplex timing chain looping crank + both cam sprockets
    makeMesh('Int_TimingChain', tubeAlong([
      [0.038, CRANK_Y - 0.01, 0], [rx + 0.052, ry - 0.02, 0], [rx + 0.01, ry + 0.052, 0],
      [rx - 0.045, ry + 0.02, 0], [0, CRANK_Y + 0.16, 0], [lx + 0.045, ly + 0.02, 0],
      [lx - 0.01, ly + 0.052, 0], [lx - 0.052, ly - 0.02, 0], [-0.038, CRANK_Y - 0.01, 0],
      [0, CRANK_Y - 0.045, 0],
    ].map(([x, y]) => [x, y, zFront + 0.02]), 0.008, true, 128), 'chain'),
  );

  return root;
}

/* ------------------------------------------------------------------ */
/* Extras that accompany the real Sketchfab W221 (public/models/       */
/* w221-sketchfab.glb): it ships without wheels or a wiring harness,   */
/* so we generate those to its measured hub positions.                 */
/* ------------------------------------------------------------------ */
function buildVehicleExtras() {
  const root = new THREE.Group();
  root.name = 'W221_Extras';
  const add = (...meshes) => meshes.forEach((m) => root.add(m));

  // real model: hub centres x ±0.735, y 0.33, front z 1.58 / rear z -1.61
  for (const [corner, sx, z] of [['FL', -1, 1.58], ['FR', 1, 1.58], ['RL', -1, -1.61], ['RR', 1, -1.61]]) {
    const wx = sx * 0.78;
    const tire = new THREE.TorusGeometry(0.255, 0.078, 14, 28);
    tire.rotateY(Math.PI / 2);
    add(
      makeMesh(`Susp_Tire_${corner}`, tire, 'tire', { pos: [wx, 0.33, z] }),
      makeMesh(`Susp_Rim_${corner}`, mergeGeometries([
        placed(cyl(0.185, 0.185, 0.13, 22), [0, 0, 0], [0, 0, Math.PI / 2]),
        placed(cyl(0.060, 0.060, 0.19, 14), [0, 0, 0], [0, 0, Math.PI / 2]),
        ...Array.from({ length: 5 }, (_, s) => {
          const spoke = box(0.028, 0.042, 0.125);
          spoke.translate(0, 0, 0.105);
          spoke.rotateX((s / 5) * Math.PI * 2);
          return placed(spoke, [sx * 0.065, 0, 0]);
        }),
      ]), 'rim', { pos: [wx, 0.33, z] }),
    );
  }

  add(
    makeMesh('Harness_Main', tubeAlong([
      [0.58, 0.42, 2.0], [0.66, 0.40, 0.9], [0.68, 0.38, -0.5], [0.64, 0.40, -1.9], [0.2, 0.48, -2.2],
    ], 0.032), 'harness'),
    makeMesh('Harness_EngineBay', tubeAlong([
      [-0.52, 0.74, 1.15], [-0.3, 0.84, 1.55], [0.25, 0.84, 1.75], [0.52, 0.72, 1.35],
    ], 0.028), 'harness'),
    makeMesh('Harness_Dash', tubeAlong([
      [-0.62, 0.84, 0.55], [0, 0.88, 0.60], [0.62, 0.84, 0.55],
    ], 0.028), 'harness'),
    makeMesh('Harness_Battery', box(0.34, 0.20, 0.20), 'battery', { pos: [0.50, 0.50, -2.05] }),
    makeMesh('Harness_FuseBox_EngineBay', box(0.24, 0.10, 0.18), 'battery', { pos: [-0.55, 0.86, 1.0] }),
    makeMesh('Harness_ECU', box(0.20, 0.06, 0.26), 'battery', { pos: [0.55, 0.84, 0.95] }),
  );

  return root;
}

/* ------------------------------------------------------------------ */
async function exportGLB(root, filename) {
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(root, { binary: true });
  await writeFile(join(OUT_DIR, filename), Buffer.from(result));
  console.log(`wrote ${filename} (${root.children.length} meshes, ${(result.byteLength / 1024).toFixed(1)} KiB)`);
}

await mkdir(OUT_DIR, { recursive: true });
await exportGLB(buildVehicle(), 'vehicle.glb');
await exportGLB(buildEngine(), 'engine.glb');
await exportGLB(buildVehicleExtras(), 'vehicle-extras.glb');
