import { useEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { Color, Mesh, MeshStandardMaterial, Object3D } from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import type { LayerDef, ModelDef, Selection } from '../types';
import { modelFiles } from '../types';
import { resolvePattern } from '../lib/patterns';
import { assetUrl } from '../lib/assets';

const HIGHLIGHT = new Color('#3b82f6');

/** Mesh nodes in exported GLBs are often named "Object_53" / "mesh_0" — the
 * semantic name lives on an ancestor group. */
const GENERIC_NAME = /^(Object_\d+|mesh[_ ]?\d*|)$|^(Scene|root|GLTF_SceneRootNode|Sketchfab_model)$/i;

/** Nearest self-or-ancestor whose name is semantic; falls back to the mesh. */
export function semanticNode(obj: Object3D): Object3D {
  for (let cur: Object3D | null = obj; cur; cur = cur.parent) {
    if (cur.name && !GENERIC_NAME.test(cur.name)) return cur;
  }
  return obj;
}

/** Resolve a pattern map against a node's own name, then its ancestors'. */
function resolveUpwards<T>(map: Record<string, T>, obj: Object3D): T | undefined {
  for (let cur: Object3D | null = obj; cur; cur = cur.parent) {
    if (cur.name) {
      const hit = resolvePattern(map, cur.name);
      if (hit !== undefined) return hit;
    }
  }
  return undefined;
}

interface PartProps {
  model: ModelDef;
  url: string;
  layerOrder: Map<string, number>;
  peelDepth: number;
  selection: Selection | null;
  onSelect: (selection: Selection) => void;
}

const warnedMeshes = new Set<string>();

function GLTFPart({ model, url, layerOrder, peelDepth, selection, onSelect }: PartProps) {
  const gltf = useGLTF(assetUrl(url));

  // Real-world GLBs often share one material across meshes; clone so that
  // highlighting one part never tints its siblings. Also force glass-mapped
  // meshes transparent — imported models often ship glass as opaque. Runs
  // once per model.
  useEffect(() => {
    const glassMap = Object.fromEntries((model.glassMeshes ?? []).map((p) => [p, true]));
    const seen = new Set<MeshStandardMaterial>();
    gltf.scene.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      let mat = mesh.material as MeshStandardMaterial;
      if (seen.has(mat)) {
        mat = mat.clone();
        mesh.material = mat;
      } else {
        seen.add(mat);
      }
      if (resolveUpwards(glassMap, mesh) && !mat.userData.glassApplied) {
        // shared glass material may reach here pre-clone; clone to be safe
        if (seen.has(mat)) {
          mat = mat.clone();
          mesh.material = mat;
        }
        mat.transparent = true;
        mat.opacity = 0.42;
        mat.roughness = Math.min(mat.roughness, 0.15);
        mat.depthWrite = false;
        mat.userData.glassApplied = true;
      }
    });
  }, [gltf.scene, model]);

  // Apply the peel: hide every mesh whose layer is at or outboard of peelDepth.
  // Visibility is set on the mesh itself so raycast filtering stays simple.
  useEffect(() => {
    gltf.scene.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh) return;
      const layerId = resolveUpwards(model.meshLayerMap, mesh);
      if (layerId === undefined) {
        const key = `${model.id}:${semanticNode(mesh).name || mesh.uuid}`;
        if (!warnedMeshes.has(key)) {
          warnedMeshes.add(key);
          console.warn(
            `[auto-anatomy] "${semanticNode(mesh).name || mesh.name}" in model "${model.id}" has no entry in meshLayerMap (models.json) — leaving it always visible`,
          );
        }
        return;
      }
      const order = layerOrder.get(layerId);
      mesh.visible = order === undefined ? true : order > peelDepth;
    });
  }, [gltf.scene, model, layerOrder, peelDepth]);

  // Highlight the selected part (a semantic group: tint all meshes beneath it).
  useEffect(() => {
    if (!selection || selection.modelId !== model.id) return;
    let target: Object3D | undefined;
    gltf.scene.traverse((obj) => {
      if (!target && obj.name === selection.meshName) target = obj;
    });
    if (!target) return;
    const restores: (() => void)[] = [];
    target.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      const mat = mesh.material as MeshStandardMaterial;
      if (!mat.emissive) return;
      const prevEmissive = mat.emissive.clone();
      const prevIntensity = mat.emissiveIntensity;
      mat.emissive.copy(HIGHLIGHT);
      mat.emissiveIntensity = 0.45;
      restores.push(() => {
        mat.emissive.copy(prevEmissive);
        mat.emissiveIntensity = prevIntensity;
      });
    });
    return () => restores.forEach((r) => r());
  }, [gltf.scene, model.id, selection]);

  // The raycaster still hits invisible meshes, so pick the first VISIBLE hit —
  // otherwise peeled-away panels would swallow clicks meant for what's beneath.
  function firstVisibleHit(e: ThreeEvent<MouseEvent> | ThreeEvent<PointerEvent>) {
    return e.intersections.find((i) => i.object.visible && (i.object as Mesh).isMesh);
  }

  function handleClick(e: ThreeEvent<MouseEvent>) {
    e.stopPropagation();
    const hit = firstVisibleHit(e);
    if (hit) onSelect({ modelId: model.id, meshName: semanticNode(hit.object).name || hit.object.name });
  }

  function handleOver(e: ThreeEvent<PointerEvent>) {
    document.body.style.cursor = firstVisibleHit(e) ? 'pointer' : 'auto';
  }

  return (
    <primitive
      object={gltf.scene}
      onClick={handleClick}
      onPointerOver={handleOver}
      onPointerOut={() => (document.body.style.cursor = 'auto')}
    />
  );
}

interface Props {
  model: ModelDef;
  layers: LayerDef[];
  /** Layers with order <= peelDepth are hidden. */
  peelDepth: number;
  selection: Selection | null;
  onSelect: (selection: Selection) => void;
}

export default function ModelView({ model, layers, peelDepth, selection, onSelect }: Props) {
  const layerOrder = useMemo(
    () => new Map(layers.map((l) => [l.id, l.order])),
    [layers],
  );
  return (
    <>
      {modelFiles(model).map((url) => (
        <GLTFPart
          key={url}
          model={model}
          url={url}
          layerOrder={layerOrder}
          peelDepth={peelDepth}
          selection={selection}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}
