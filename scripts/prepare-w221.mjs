/**
 * Prepares the Sketchfab W221 GLB for the app:
 *
 *   node scripts/prepare-w221.mjs <input.glb>  ->  public/models/w221-sketchfab.glb
 *
 * The source ("Mersedes-Benz S-class W221" by Black Snow, CC-BY,
 * sketchfab.com/3d-models/mersedes-benz-s-class-w221-6b1c0ad55406406a8cf8177dc0a4f2b9)
 * is a modular game-style kit containing every trim variant (base/AMG/Brabus/
 * Wald bumpers, V6/V8/V12 engines, S500..S65 letterings, damaged glass, ...).
 * This script edits ONLY the JSON chunk (geometry/textures untouched):
 *
 *   1. prunes every group that isn't part of an S65 AMG facelift build
 *   2. re-seats the facelift head/taillight groups, which the kit stores
 *      floating beside the car (game-engine attachment convention)
 *   3. recenters the car on the origin
 */
import * as THREE from 'three';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const IN = process.argv[2];
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models', 'w221-sketchfab.glb');
if (!IN) {
  console.error('usage: node scripts/prepare-w221.mjs <downloaded.glb>');
  process.exit(1);
}

const buf = readFileSync(IN);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString());
const binChunk = buf.slice(20 + jsonLen); // includes its own chunk header

/* ---- 1. prune non-S65 variants ---------------------------------- */
// Patterns are matched against node names (prefix match, case-sensitive).
const PRUNE = [
  // other trims / body kits
  'sw221_bumper_F_31', 'sw221_bumper_F_brabus', 'sw221_bumper_F_fl_33', 'sw221_bumper_F_fl_amg_us',
  'sw221_bumper_F_fl_us', 'sw221_bumper_F_wald', 'sw221_bumper_R_38', 'sw221_bumper_R_brabus',
  'sw221_bumper_R_fl_40', 'sw221_bumper_R_wald',
  'sw221_fender_L_104', 'sw221_fender_L_brabus', 'sw221_fender_L_wald',
  'sw221_fender_R_108', 'sw221_fender_R_brabus', 'sw221_fender_R_wald',
  'sw221_sideskirts_169', 'sw221_sideskirts_brabus', 'sw221_sideskirts_wald',
  'sw221_spoiler_', 'sw221_hood_126', 'sw221_hood_fl_alt',
  'sw221_lettering_brabus', 'sw221_lettering_wald', 'sw221_lettering_R_s500',
  'sw221_lettering_R_s550', 'sw221_lettering_R_s600', 'sw221_lettering_R_s63',
  'sw221_badge_hood_12', 'sw221_badge_hood_fl_brabus', 'sw221_badge_R_fl_brabus',
  'sw221_badge_v8biturbo', 'sw221_badge_v12_', 'sw221_badge_be_',
  'sw221_door_FL_badge_brabus', 'sw221_door_FR_badge_brabus',
  // other engines / drivetrains (S65 = V12 biturbo, RWD)
  'sw221_engine_v6', 'sw221_engine_v8', 'sw221_engine_v12_82',
  'sw221_header_i6', 'sw221_icpipe_', 'sw221_radtube_',
  'sw221_diff_F', 'sw221_driveshaft_F', 'sw221_halfshaft_F_113', 'sw221_transfercase',
  'sw221_badge_dash_4matic',
  // pre-facelift / duplicate lights (keep *_fl, prune bases and numbered dupes)
  'sw221_headlight_L_117', 'sw221_headlight_R_118', 'sw221_headlight_L.001', 'sw221_headlight_R.001',
  'sw221_headlight_R_fl.001', 'sw221_headlight_R_fl.002',
  'sw221_headlightglass_L_122', 'sw221_headlightglass_R_123',
  'sw221_taillight_L_190', 'sw221_taillight_R_195', 'sw221_taillight_L.', 'sw221_taillight_R.',
  'sw221_taillightglass_L_200', 'sw221_taillightglass_R_202',
  'sw221_zap_rest_',
  // damaged / decal / alternate-trim variants
  'sw221_windshield_dmg', 'sw221_doorglass_FL_sticker', 'sw221_doorglass_FR_sticker',
  'sw221_doorglass_RL_sticker', 'sw221_doorglass_RR_sticker',
  'sw221_doorpanel_FL_b', 'sw221_doorpanel_FR_b', 'sw221_doorpanel_RL_sedan_b', 'sw221_doorpanel_RR_sedan_b',
  'sw221_seat_FL_b', 'sw221_seat_FR_b', 'sw221_seats_R_b', 'sw221_steer_b', 'sw221_sunvisor_b',
  'sw221_intmirror_b', 'sw221_roof_panoramic_glass',
  // base brakes (keep the sport/AMG discs+calipers)
  'sw221_brakedisc_FR_25', 'sw221_brakedisc_RL_27', 'sw221_brakedisc_RR_29',
  'sw221_caliper_F_44', 'sw221_caliper_R_46',
  // exhaust tip variants b..f (keep _a)
  ...'bcdef'.split('').flatMap((v) => [`sw221_exhausttip_L_${v}`, `sw221_exhausttip_R_${v}`]),
];

const nodes = json.nodes;

/* ---- 0. flatten the mega-parent ----------------------------------
 * The kit parents nearly every car group under "sw221_backlight_sedan",
 * which breaks ancestor-based name resolution (every mesh would inherit
 * the backlight's mapping). Reparent its non-backlight children to its
 * own parent, composing the transform so nothing moves. */
{
  const megaIdx = nodes.findIndex((n) => n.name?.startsWith('sw221_backlight_sedan_'));
  const parentIdx = nodes.findIndex((n) => n.children?.includes(megaIdx));
  if (megaIdx >= 0 && parentIdx >= 0) {
    const mega = nodes[megaIdx];
    const megaMat = (() => {
      const m = new THREE.Matrix4();
      if (mega.matrix) return m.fromArray(mega.matrix);
      return m.compose(
        new THREE.Vector3(...(mega.translation ?? [0, 0, 0])),
        new THREE.Quaternion(...(mega.rotation ?? [0, 0, 0, 1])),
        new THREE.Vector3(...(mega.scale ?? [1, 1, 1])),
      );
    })();
    const keep = [], move = [];
    for (const c of mega.children ?? []) {
      (nodes[c].name?.startsWith('sw221_backlight') || nodes[c].name?.startsWith('Object_') ? keep : move).push(c);
    }
    for (const c of move) {
      const child = nodes[c];
      const childMat = (() => {
        const m = new THREE.Matrix4();
        if (child.matrix) return m.fromArray(child.matrix);
        return m.compose(
          new THREE.Vector3(...(child.translation ?? [0, 0, 0])),
          new THREE.Quaternion(...(child.rotation ?? [0, 0, 0, 1])),
          new THREE.Vector3(...(child.scale ?? [1, 1, 1])),
        );
      })();
      delete child.translation; delete child.rotation; delete child.scale;
      child.matrix = childMat.premultiply(megaMat.clone()).toArray();
      nodes[parentIdx].children.push(c);
    }
    mega.children = keep;
    console.log(`flattened mega-parent "${mega.name}": moved ${move.length} groups up, kept ${keep.length}`);
  }
}

const pruned = new Set(
  nodes.map((n, i) => [n.name ?? '', i]).filter(([name]) => PRUNE.some((p) => name.startsWith(p))).map(([, i]) => i),
);
for (const n of nodes) if (n.children) n.children = n.children.filter((c) => !pruned.has(c));
for (const s of json.scenes) s.nodes = s.nodes.filter((r) => !pruned.has(r));
console.log(`pruned ${pruned.size} variant groups`);

/* ---- 2. re-seat floating light groups ---------------------------- */
function localMatrix(n) {
  const m = new THREE.Matrix4();
  if (n.matrix) return m.fromArray(n.matrix);
  return m.compose(
    new THREE.Vector3(...(n.translation ?? [0, 0, 0])),
    new THREE.Quaternion(...(n.rotation ?? [0, 0, 0, 1])),
    new THREE.Vector3(...(n.scale ?? [1, 1, 1])),
  );
}
// Pass 1: parent world matrix for every reachable node.
const parentMats = new Map();
(function index() {
  function walk(idx, parentMat) {
    parentMats.set(idx, parentMat.clone());
    const n = nodes[idx];
    const mat = parentMat.clone().multiply(localMatrix(n));
    (n.children || []).forEach((c) => walk(c, mat));
  }
  json.scenes[json.scene ?? 0].nodes.forEach((r) => walk(r, new THREE.Matrix4()));
})();

function groupWorld(prefix) {
  const idx = nodes.findIndex((n, i) => n.name?.startsWith(prefix) && parentMats.has(i));
  if (idx < 0) return null;
  const parentMat = parentMats.get(idx);
  const box = new THREE.Box3();
  (function walk(i, parent) {
    const n = nodes[i];
    const mat = parent.clone().multiply(localMatrix(n));
    if (n.mesh !== undefined) {
      for (const p of json.meshes[n.mesh].primitives) {
        const a = json.accessors[p.attributes.POSITION];
        if (a.min && a.max) {
          box.union(new THREE.Box3(new THREE.Vector3(...a.min), new THREE.Vector3(...a.max)).applyMatrix4(mat));
        }
      }
    }
    (n.children || []).forEach((c) => walk(c, mat));
  })(idx, parentMat);
  return { idx, node: nodes[idx], parentMat, box };
}

const CAR_X = -2.33; // car centreline before recentering
// targets measured against the real car: front corners / rear corners
const RESEAT = [
  ['sw221_headlight_L_fl', [CAR_X + 0.60, 0.80, 2.03]],
  ['sw221_headlight_R_fl_119', [CAR_X - 0.60, 0.80, 2.03]],
  ['sw221_headlightglass_L_fl', [CAR_X + 0.60, 0.80, 2.06]],
  ['sw221_headlightglass_R_fl', [CAR_X - 0.60, 0.80, 2.06]],
  ['sw221_taillight_L_fl', [CAR_X + 0.66, 0.88, -2.42]],
  ['sw221_taillight_R_fl', [CAR_X - 0.66, 0.88, -2.42]],
  ['sw221_taillightglass_L_fl', [CAR_X + 0.66, 0.88, -2.44]],
  ['sw221_taillightglass_R_fl', [CAR_X - 0.66, 0.88, -2.44]],
];
for (const [prefix, target] of RESEAT) {
  const g = groupWorld(prefix);
  if (!g || g.box.isEmpty()) {
    console.warn('re-seat: group not found:', prefix);
    continue;
  }
  const center = new THREE.Vector3();
  g.box.getCenter(center);
  const worldDelta = new THREE.Vector3(...target).sub(center);
  // convert world-space delta into the node's parent space
  const parentRotInv = new THREE.Matrix4().extractRotation(g.parentMat).invert();
  const parentScale = new THREE.Vector3().setFromMatrixScale(g.parentMat);
  const localDelta = worldDelta.clone().applyMatrix4(parentRotInv).divide(parentScale);
  const m = localMatrix(g.node);
  const t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  m.decompose(t, q, s);
  t.add(localDelta);
  delete g.node.matrix;
  g.node.translation = t.toArray();
  g.node.rotation = q.toArray();
  g.node.scale = s.toArray();
  console.log(`re-seated ${prefix} by (${worldDelta.toArray().map((v) => v.toFixed(2)).join(', ')})`);
}

/* ---- 3. recenter the car on the origin --------------------------- */
for (const rootIdx of json.scenes[json.scene ?? 0].nodes) {
  const n = nodes[rootIdx];
  const m = localMatrix(n);
  m.premultiply(new THREE.Matrix4().makeTranslation(-CAR_X, 0, 0.15));
  delete n.translation; delete n.rotation; delete n.scale;
  n.matrix = m.toArray();
}

/* ---- write GLB ---------------------------------------------------- */
let jsonOut = Buffer.from(JSON.stringify(json));
const pad = (4 - (jsonOut.length % 4)) % 4;
if (pad) jsonOut = Buffer.concat([jsonOut, Buffer.alloc(pad, 0x20)]);
const header = Buffer.alloc(12);
header.write('glTF', 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonOut.length + binChunk.length, 8);
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(jsonOut.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'
writeFileSync(OUT, Buffer.concat([header, jsonHeader, jsonOut, binChunk]));
console.log(`wrote ${OUT} (${((12 + 8 + jsonOut.length + binChunk.length) / 1024 / 1024).toFixed(1)} MB)`);
