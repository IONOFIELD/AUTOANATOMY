import type { LayerDef, PartInfo } from '../types';
import { prettifyMeshName } from '../lib/patterns';

interface Props {
  meshName: string;
  part: PartInfo | null;
  layer: LayerDef | null;
  onClose: () => void;
}

/** Part detail card — right panel on desktop, bottom sheet on phones. */
export default function InfoPanel({ meshName, part, layer, onClose }: Props) {
  return (
    <aside className="info-panel" aria-label="Part information">
      <button className="close-btn" onClick={onClose} aria-label="Close part info">
        ×
      </button>
      <h2>{part?.name ?? prettifyMeshName(meshName)}</h2>
      <div className="info-badges">
        {layer && <span className="badge badge-layer">{layer.name}</span>}
        {part && <span className="badge badge-system">{part.system}</span>}
      </div>
      {part ? (
        <>
          <h3>Function</h3>
          <p>{part.function}</p>
          <h3>Description</h3>
          <p>{part.description}</p>
        </>
      ) : (
        <p className="info-missing">
          No entry for this part yet. Add one to <code>public/data/parts.json</code> keyed by mesh
          name <code>{meshName}</code> (or a <code>prefix_*</code> pattern) — no code changes
          needed.
        </p>
      )}
      <p className="mesh-name">mesh: {meshName}</p>
    </aside>
  );
}
