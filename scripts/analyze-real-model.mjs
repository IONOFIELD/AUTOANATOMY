/** One-off analysis of the Sketchfab W221 GLB: world-space bounds of key groups. */
import * as THREE from 'three';
import { readFileSync } from 'node:fs';

const buf = readFileSync(process.argv[2]);
const json = JSON.parse(buf.slice(20, 20 + buf.readUInt32LE(12)).toString());
const nodes = json.nodes;
const accessors = json.accessors;

function localMatrix(n) {
  const m = new THREE.Matrix4();
  if (n.matrix) return m.fromArray(n.matrix);
  const t = n.translation ?? [0, 0, 0];
  const r = n.rotation ?? [0, 0, 0, 1];
  const s = n.scale ?? [1, 1, 1];
  return m.compose(new THREE.Vector3(...t), new THREE.Quaternion(...r), new THREE.Vector3(...s));
}

const results = new Map(); // group name -> Box3
function walk(idx, parentMat, groupName) {
  const n = nodes[idx];
  const mat = parentMat.clone().multiply(localMatrix(n));
  const name = n.name && !/^Object_/.test(n.name) ? n.name : groupName;
  if (n.mesh !== undefined) {
    for (const p of json.meshes[n.mesh].primitives) {
      const a = accessors[p.attributes.POSITION];
      if (!a.min || !a.max) continue;
      const box = new THREE.Box3(new THREE.Vector3(...a.min), new THREE.Vector3(...a.max)).applyMatrix4(mat);
      const key = name ?? '?';
      if (!results.has(key)) results.set(key, new THREE.Box3());
      results.get(key).union(box);
    }
  }
  (n.children || []).forEach((c) => walk(c, mat, name));
}
json.scenes[json.scene ?? 0].nodes.forEach((r) => walk(r, new THREE.Matrix4(), null));

const all = new THREE.Box3();
for (const box of results.values()) all.union(box);
const fmt = (b) => {
  const s = new THREE.Vector3(); b.getSize(s);
  const c = new THREE.Vector3(); b.getCenter(c);
  return `size(${s.x.toFixed(2)}, ${s.y.toFixed(2)}, ${s.z.toFixed(2)}) center(${c.x.toFixed(2)}, ${c.y.toFixed(2)}, ${c.z.toFixed(2)})`;
};
console.log('WHOLE SCENE:', fmt(all));
for (const key of ['sw221_body_sedan_23', 'sw221_chassis', 'sw221_engine_v12_amg', 'sw221_transmission', 'sw221_hub_F', 'sw221_hub_R', 'sw221_brakedisc_FL_sport_24', 'sw221_dash', 'sw221_fueltank', 'sw221_windshield']) {
  const match = [...results.keys()].filter((k) => k === key || k.startsWith(key));
  for (const k of match) console.log(k.padEnd(34), fmt(results.get(k)));
}
