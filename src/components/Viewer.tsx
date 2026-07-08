import { Suspense, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { ContactShadows, Environment, Grid, Lightformer, Loader, OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { CameraSpec, LayerDef, ModelDef, Selection } from '../types';
import ModelView from './ModelView';

/** Snap camera + orbit target when the focused model changes. */
function CameraRig({ spec }: { spec: CameraSpec }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  useEffect(() => {
    camera.position.set(...spec.position);
    if (controls) {
      controls.target.set(...spec.target);
      controls.update();
    } else {
      camera.lookAt(...spec.target);
    }
  }, [camera, controls, spec]);
  return null;
}

interface Props {
  model: ModelDef;
  layers: LayerDef[];
  peelDepth: number;
  selection: Selection | null;
  onSelect: (selection: Selection) => void;
  onClearSelection: () => void;
}

export default function Viewer({ model, layers, peelDepth, selection, onSelect, onClearSelection }: Props) {
  return (
    <div className="viewer">
      <Canvas
        dpr={[1, 2]}
        camera={{ fov: 45, near: 0.05, far: 200 }}
        onPointerMissed={onClearSelection}
      >
        <color attach="background" args={['#0e1116']} />
        <hemisphereLight intensity={0.35} color="#dfe7f2" groundColor="#1a1e26" />
        <directionalLight position={[6, 9, 5]} intensity={1.6} />
        <directionalLight position={[-7, 4, -6]} intensity={0.45} />
        {/* Local studio environment (no network): gives the metals something to reflect */}
        <Environment resolution={128} frames={1}>
          <Lightformer form="rect" intensity={2.2} position={[0, 6, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[9, 9, 1]} />
          <Lightformer form="rect" intensity={1.1} position={[-6, 2, 3]} rotation={[0, Math.PI / 2, 0]} scale={[5, 2.5, 1]} />
          <Lightformer form="rect" intensity={0.9} position={[6, 2, -3]} rotation={[0, -Math.PI / 2, 0]} scale={[5, 2.5, 1]} />
          <Lightformer form="rect" intensity={0.5} color="#aac4e8" position={[0, 2, -7]} scale={[7, 3, 1]} />
        </Environment>
        <ContactShadows position={[0, 0, 0]} opacity={0.55} scale={14} blur={2.2} far={3} resolution={512} />
        <Suspense fallback={null}>
          <ModelView
            model={model}
            layers={layers}
            peelDepth={peelDepth}
            selection={selection}
            onSelect={onSelect}
          />
        </Suspense>
        <Grid
          position={[0, -0.01, 0]}
          args={[20, 20]}
          cellColor="#232833"
          sectionColor="#2f3542"
          fadeDistance={18}
          infiniteGrid
        />
        {/* Touch defaults: 1 finger orbit, 2 finger pinch-zoom + pan */}
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          minDistance={0.4}
          maxDistance={30}
          maxPolarAngle={Math.PI * 0.55}
        />
        <CameraRig spec={model.camera} />
      </Canvas>
      <Loader />
    </div>
  );
}
