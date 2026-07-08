import { useEffect, useMemo, useState } from 'react';
import { useGLTF } from '@react-three/drei';
import type { AppConfig, LayerDef, PartsDb, Selection } from './types';
import { modelFiles } from './types';
import { assetUrl } from './lib/assets';
import { resolvePattern } from './lib/patterns';
import Viewer from './components/Viewer';
import LayerControls from './components/LayerControls';
import InfoPanel from './components/InfoPanel';

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [parts, setParts] = useState<PartsDb>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [peelDepth, setPeelDepth] = useState(0);
  const [selection, setSelection] = useState<Selection | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [configRes, partsRes] = await Promise.all([
          fetch(assetUrl('config/models.json')),
          fetch(assetUrl('data/parts.json')),
        ]);
        if (!configRes.ok) throw new Error(`config/models.json → HTTP ${configRes.status}`);
        if (!partsRes.ok) throw new Error(`data/parts.json → HTTP ${partsRes.status}`);
        const cfg = (await configRes.json()) as AppConfig;
        const db = (await partsRes.json()) as PartsDb;
        delete (db as Record<string, unknown>)['$comment'];
        if (cancelled) return;
        setConfig(cfg);
        setParts(db);
        setActiveModelId(cfg.models[0]?.id ?? null);
        // Warm all GLBs so the focus-engine swap is instant.
        cfg.models.forEach((m) => modelFiles(m).forEach((f) => useGLTF.preload(assetUrl(f))));
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const layers = useMemo(
    () => (config ? [...config.layers].sort((a, b) => a.order - b.order) : []),
    [config],
  );
  const activeModel = config?.models.find((m) => m.id === activeModelId) ?? null;

  function switchModel(modelId: string) {
    if (!config || modelId === activeModelId) return;
    const model = config.models.find((m) => m.id === modelId);
    if (!model) return;
    // Keep at least the model's innermost layer visible after the swap.
    const maxOrder = Math.max(
      ...model.focusLayerIds.map((id) => layers.find((l) => l.id === id)?.order ?? 0),
    );
    if (peelDepth >= maxOrder) setPeelDepth(maxOrder - 1);
    setSelection(null);
    setActiveModelId(modelId);
  }

  /**
   * Core peel behavior: selecting a visible layer hides it and everything
   * outboard; selecting a peeled layer restores down to it. If the outermost
   * still-visible layer lives in a different model (e.g. engine internals),
   * focus swaps to that model automatically.
   */
  function handleSelectLayer(layer: LayerDef) {
    const nextDepth = layer.order <= peelDepth ? layer.order - 1 : layer.order;
    applyPeelDepth(nextDepth);
  }

  function applyPeelDepth(nextDepth: number) {
    if (!config || !activeModel) return;
    setPeelDepth(nextDepth);
    setSelection(null);
    // If the outermost still-visible layer lives in another model, focus it.
    const outermostVisible = layers.find((l) => l.order > nextDepth);
    if (outermostVisible && !activeModel.focusLayerIds.includes(outermostVisible.id)) {
      const owner = config.models.find((m) => m.focusLayerIds.includes(outermostVisible.id));
      if (owner && owner.id !== activeModel.id) {
        setActiveModelId(owner.id);
      }
    }
  }

  const selectionDetail = useMemo(() => {
    if (!selection || !config) return null;
    const model = config.models.find((m) => m.id === selection.modelId);
    if (!model) return null;
    const layerId = resolvePattern(model.meshLayerMap, selection.meshName);
    return {
      part: resolvePattern(parts, selection.meshName) ?? null,
      layer: layers.find((l) => l.id === layerId) ?? null,
    };
  }, [selection, config, parts, layers]);

  if (loadError) {
    return (
      <div className="app-message error">
        <h1>Failed to load app data</h1>
        <p>{loadError}</p>
        <p>
          Check <code>public/config/models.json</code> and <code>public/data/parts.json</code> for
          JSON syntax errors.
        </p>
      </div>
    );
  }
  if (!config || !activeModel) {
    return <div className="app-message">Loading configuration…</div>;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="titles">
          <h1>Auto Anatomy</h1>
          <p>Mercedes-Benz W221 S65 AMG · M275 V12 biturbo</p>
        </div>
        <div className="model-switch" role="group" aria-label="Focused model">
          {config.models.map((m) => (
            <button
              key={m.id}
              className={m.id === activeModelId ? 'active' : ''}
              onClick={() => switchModel(m.id)}
            >
              {m.id === activeModelId ? m.name : `Focus ${m.name}`}
            </button>
          ))}
        </div>
      </header>

      <main className="stage">
        <Viewer
          model={activeModel}
          layers={layers}
          peelDepth={peelDepth}
          selection={selection}
          onSelect={setSelection}
          onClearSelection={() => setSelection(null)}
        />
        <LayerControls
          layers={layers}
          peelDepth={peelDepth}
          onSelectLayer={handleSelectLayer}
          onReset={() => applyPeelDepth(0)}
        />
        {selection && selectionDetail && (
          <InfoPanel
            meshName={selection.meshName}
            part={selectionDetail.part}
            layer={selectionDetail.layer}
            onClose={() => setSelection(null)}
          />
        )}
        {!selection && (
          <p className="hint">Tap a part for details · drag to orbit · pinch or scroll to zoom</p>
        )}
      </main>
    </div>
  );
}
