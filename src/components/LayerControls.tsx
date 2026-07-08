import type { LayerDef } from '../types';

interface Props {
  layers: LayerDef[];
  /** Layers with order <= peelDepth are peeled away (hidden). */
  peelDepth: number;
  onSelectLayer: (layer: LayerDef) => void;
  onReset: () => void;
}

/**
 * The peel stack, outermost layer first — the skin/muscle/bone control.
 * Tapping a visible layer peels it (and everything outboard) away;
 * tapping a peeled layer restores down to it.
 */
export default function LayerControls({ layers, peelDepth, onSelectLayer, onReset }: Props) {
  const ordered = [...layers].sort((a, b) => a.order - b.order);
  return (
    <nav className="layer-controls" aria-label="System layers">
      <div className="layer-controls-header">
        <span>Layers</span>
        <button className="reset-btn" onClick={onReset} disabled={peelDepth === 0}>
          Show all
        </button>
      </div>
      <ul>
        {ordered.map((layer) => {
          const peeled = layer.order <= peelDepth;
          return (
            <li key={layer.id}>
              <button
                className={`layer-btn${peeled ? ' peeled' : ''}`}
                onClick={() => onSelectLayer(layer)}
                aria-pressed={peeled}
                title={peeled ? 'Restore this layer' : 'Peel this layer away'}
              >
                <span className="layer-num">{layer.order}</span>
                <span className="layer-name">{layer.name}</span>
                <span className="layer-state">{peeled ? 'peeled' : 'visible'}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
