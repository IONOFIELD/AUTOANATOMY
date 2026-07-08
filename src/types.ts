/** Shapes of the two runtime-editable data files in public/. */

export interface LayerDef {
  id: string;
  name: string;
  /** 1 = outermost. Peeling to depth k hides every layer with order <= k. */
  order: number;
}

export interface CameraSpec {
  position: [number, number, number];
  target: [number, number, number];
}

export interface ModelDef {
  id: string;
  name: string;
  /** GLB path relative to the app base (usually under models/). */
  url?: string;
  /** Alternative to url: several GLBs shown together as one model. */
  files?: string[];
  /** Selecting one of these layers in the UI focuses this model. */
  focusLayerIds: string[];
  camera: CameraSpec;
  /**
   * Mesh/group-name pattern -> layer id. Patterns are exact names or prefixes
   * ending in '*'. The longest matching pattern wins. Names are resolved by
   * walking each mesh's ancestor groups, so semantic group names work even
   * when the mesh nodes themselves are named e.g. "Object_53".
   */
  meshLayerMap: Record<string, string>;
  /**
   * Patterns (same rules as meshLayerMap) for meshes that should render as
   * glass. Useful for imported models whose glass ships as opaque materials.
   */
  glassMeshes?: string[];
}

/** All GLB urls of a model (single-url and multi-file models alike). */
export function modelFiles(model: ModelDef): string[] {
  return model.files ?? (model.url ? [model.url] : []);
}

export interface AppConfig {
  layers: LayerDef[];
  models: ModelDef[];
}

export interface PartInfo {
  name: string;
  system: string;
  function: string;
  description: string;
}

/** parts.json: mesh-name pattern -> part info (same pattern rules as meshLayerMap). */
export type PartsDb = Record<string, PartInfo>;

export interface Selection {
  modelId: string;
  meshName: string;
}
