'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import {
  OrbitControls,
  Line,
  Sky,
  Stars,
  Grid,
  ContactShadows,
  GizmoHelper,
  GizmoViewport,
  Splat,
} from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import {
  HouseMesh,
  ProceduralBuildingMesh,
  type HoverHitInfo,
} from './HouseMesh';
import { PhotorealisticTilesScene } from './PhotorealisticTilesScene';
import { InstancedBulbsLayer } from './InstancedBulbsLayer';
import { useStudioStore, type LightingMode } from '@/store/useStudioStore';

function CanvasScreenshotRegistrar({
  onRegisterCapture,
}: {
  onRegisterCapture?: (captureFn: () => string) => void;
}) {
  const { gl } = useThree();

  useEffect(() => {
    if (!onRegisterCapture) return;
    onRegisterCapture(() => gl.domElement.toDataURL('image/png'));
  }, [gl, onRegisterCapture]);

  return null;
}

function CameraBoundsFitter({
  fitBounds,
  orbitTarget,
}: {
  fitBounds: THREE.Box3 | null;
  orbitTarget: [number, number, number];
}) {
  const { camera } = useThree();

  useEffect(() => {
    if (!fitBounds) return;
    const size = new THREE.Vector3();
    fitBounds.getSize(size);
    const height = Math.max(4.5, size.y);
    const horizSpan = Math.max(8.0, size.x, size.z);
    const dist = Math.max(18.5, height * 2.1, horizSpan * 1.6);
    camera.position.set(
      orbitTarget[0] + 1.8,
      Math.max(4.2, height * 0.54),
      orbitTarget[2] + dist
    );
    camera.lookAt(orbitTarget[0], orbitTarget[1], orbitTarget[2]);
    camera.updateProjectionMatrix();
  }, [fitBounds, orbitTarget, camera]);

  return null;
}

function SceneAtmosphereAndSky({ lightingMode }: { lightingMode: LightingMode }) {
  if (lightingMode === 'DAY') {
    return (
      <>
        <color attach="background" args={['#cfe4f7']} />
        <Sky
          distance={450000}
          sunPosition={[85, 62, 55]}
          turbidity={4.2}
          rayleigh={1.35}
          mieCoefficient={0.004}
          mieDirectionalG={0.78}
        />
        <hemisphereLight args={['#eef6ff', '#54684d', 1.2]} />
        <directionalLight position={[18, 26, 20]} intensity={1.55} color="#fff9ee" />
        <directionalLight position={[-16, 16, -14]} intensity={0.6} color="#d6e8ff" />
      </>
    );
  }
  if (lightingMode === 'DUSK') {
    return (
      <>
        <color attach="background" args={['#121631']} />
        <Sky
          distance={450000}
          sunPosition={[-95, 2.2, -45]}
          turbidity={8.5}
          rayleigh={2.8}
          mieCoefficient={0.008}
          mieDirectionalG={0.86}
        />
        <hemisphereLight args={['#7d7ab8', '#22263f', 0.88]} />
        <directionalLight position={[-16, 10, 14]} intensity={0.92} color="#ff9b6a" />
        <directionalLight position={[15, 14, -12]} intensity={0.52} color="#8ba8e8" />
      </>
    );
  }
  return (
    <>
      <color attach="background" args={['#040712']} />
      <fog attach="fog" args={['#040712', 45, 260]} />
      <Stars
        radius={120}
        depth={50}
        count={1600}
        factor={3.2}
        saturation={0.15}
        fade
        speed={0.25}
      />
      <hemisphereLight args={['#4666a3', '#162038', 0.85]} />
      <directionalLight position={[-12, 18, 16]} intensity={0.78} color="#92b4f4" />
      <directionalLight position={[14, 12, 12]} intensity={0.48} color="#799be0" />
    </>
  );
}

function HoverSurfaceRing({
  hoverHit,
  radius,
}: {
  hoverHit: HoverHitInfo | null;
  radius: number;
}) {
  const quaternion = useMemo(() => {
    const q = new THREE.Quaternion();
    if (!hoverHit) return q;
    const zAxis = new THREE.Vector3(0, 0, 1);
    const n = new THREE.Vector3(
      hoverHit.normal[0],
      hoverHit.normal[1],
      hoverHit.normal[2]
    ).normalize();
    q.setFromUnitVectors(zAxis, n);
    return q;
  }, [hoverHit]);

  if (!hoverHit) return null;

  const pos: [number, number, number] = [
    hoverHit.point[0] + hoverHit.normal[0] * 0.015,
    hoverHit.point[1] + hoverHit.normal[1] * 0.015,
    hoverHit.point[2] + hoverHit.normal[2] * 0.015,
  ];

  return (
    <mesh position={pos} quaternion={quaternion}>
      <ringGeometry args={[Math.max(0.05, radius * 0.72), Math.max(0.08, radius), 32]} />
      <meshBasicMaterial
        color="#38bdf8"
        side={THREE.DoubleSide}
        transparent
        opacity={0.9}
        toneMapped={false}
      />
    </mesh>
  );
}

export interface StudioViewportProps {
  onSceneReady?: (group: THREE.Group) => void;
  onRegisterScreenshot?: (captureFn: () => string) => void;
}

const SURFACE_LABELS: Record<string, string> = {
  balcony_railing: 'Balcony Railing (HOA No-Drill)',
  balcony_soffit: 'Balcony Ceiling Soffit',
  asphalt_shingle: 'Roof / Shingle Edge',
  metal_gutter: 'Eave / Metal Gutter',
  brick_masonry: 'Facade Masonry / Wall',
  stucco: 'Stucco / Deck Slab',
  wood_fascia: 'Trim / Door Fascia',
  vinyl_siding: 'Siding / Garage',
  column_post: 'Porch Column / Pillar',
  foliage_shrub: 'Shrub / Bush Canopy',
  ground_turf: 'Walkway / Ground Turf',
  unknown: 'Exterior Surface',
};

class SplatErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

export function StudioViewport({
  onSceneReady,
  onRegisterScreenshot,
}: StudioViewportProps) {
  const sceneSource = useStudioStore((s) => s.sceneSource);
  const tilesAnchor = useStudioStore((s) => s.tilesAnchor);
  const proceduralPreset = useStudioStore((s) => s.proceduralPreset);
  const proceduralSpec = useStudioStore((s) => s.proceduralSpec);
  const job = useStudioStore((s) => s.job);
  const lightingMode = useStudioStore((s) => s.lightingMode);
  const toolMode = useStudioStore((s) => s.toolMode);
  const activeBrushRadius = useStudioStore((s) => s.activeBrushRadius);
  const isPaintingScatter = useStudioStore((s) => s.isPaintingScatter);
  const rulerPoints = useStudioStore((s) => s.rulerPoints);
  const setGroundMinY = useStudioStore((s) => s.setGroundMinY);

  const [hoverHit, setHoverHit] = useState<HoverHitInfo | null>(null);
  const [fitBounds, setFitBounds] = useState<THREE.Box3 | null>(null);
  const [orbitTarget, setOrbitTarget] = useState<[number, number, number]>([
    0, 3.2, 0,
  ]);

  // Frame Photorealistic 3D Tiles at a comfortable street/oblique 3D angle when entering tiles mode
  useEffect(() => {
    if (sceneSource === 'MAPS_3D_TILES' && tilesAnchor) {
      setOrbitTarget([0, 4.5, 0]);
      setFitBounds(
        new THREE.Box3(
          new THREE.Vector3(-9, 0, -9),
          new THREE.Vector3(9, 12, 9)
        )
      );
    }
  }, [sceneSource, tilesAnchor]);

  // Keyboard shortcuts: 1-5 tools, Cmd/Ctrl+Z undo, Cmd+Shift+Z/Ctrl+Y redo, Enter finish, Esc cancel, Delete remove
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }

      const state = useStudioStore.getState();
      const isMod = e.metaKey || e.ctrlKey;

      if (!isMod && state.sceneSource !== 'NONE') {
        if (e.key === '1') state.setToolMode('SELECT');
        else if (e.key === '2') state.setToolMode('LINEAR_EAVE');
        else if (e.key === '3') state.setToolMode('HELICAL_WRAP');
        else if (e.key === '4') state.setToolMode('SURFACE_SCATTER');
        else if (e.key === '5') state.setToolMode('PATHWAY_STAKE');
      }

      if (isMod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        state.undo();
        return;
      }
      if (
        (isMod && e.key.toLowerCase() === 'y') ||
        (isMod && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        e.preventDefault();
        state.redo();
        return;
      }
      if (e.key === 'Enter') {
        if (state.draftPoints.length >= 2) {
          e.preventDefault();
          state.commitDraftRun();
        }
        return;
      }
      if (e.key === 'Escape') {
        state.cancelDraft();
        state.clearRulerPoints();
        state.setActiveDrawer('NONE');
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedRunId) {
        e.preventDefault();
        state.deleteRun(state.selectedRunId);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!isPaintingScatter) return;
    const finishScatterOffMesh = () => {
      const state = useStudioStore.getState();
      if (state.isPaintingScatter) {
        state.setPaintingScatter(false);
        state.commitDraftRun();
      }
    };
    window.addEventListener('pointerup', finishScatterOffMesh);
    window.addEventListener('pointercancel', finishScatterOffMesh);
    return () => {
      window.removeEventListener('pointerup', finishScatterOffMesh);
      window.removeEventListener('pointercancel', finishScatterOffMesh);
    };
  }, [isPaintingScatter]);

  const handleMeshLoaded = (
    group: THREE.Group,
    minY: number,
    bounds: THREE.Box3
  ) => {
    setGroundMinY(minY);
    const coreBox = new THREE.Box3();
    group.traverse((obj) => {
      if (
        (obj as THREE.Mesh).isMesh &&
        !obj.name.includes('ground_turf') &&
        !obj.name.includes('walkway')
      ) {
        coreBox.expandByObject(obj);
      }
    });
    const activeBox = coreBox.isEmpty() ? bounds : coreBox;
    const center = new THREE.Vector3();
    activeBox.getCenter(center);
    setOrbitTarget([center.x, Math.max(1.8, center.y * 0.92), center.z]);
    setFitBounds(activeBox.clone());
    onSceneReady?.(group);
  };

  const cursorRadius =
    toolMode === 'SURFACE_SCATTER' ? activeBrushRadius : 0.11;

  return (
    <div
      data-testid="studio-viewport"
      className="relative h-full w-full select-none overflow-hidden bg-slate-950"
    >
      <Canvas
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        camera={{ position: [4.5, 6.2, 22.0], fov: 45, near: 0.2, far: 2500 }}
      >
        <CanvasScreenshotRegistrar onRegisterCapture={onRegisterScreenshot} />
        <CameraBoundsFitter fitBounds={fitBounds} orbitTarget={orbitTarget} />
        <SceneAtmosphereAndSky lightingMode={lightingMode} />

        {/* Architectural ground reference grid when not streaming full-earth 3D Tiles */}
        {sceneSource !== 'MAPS_3D_TILES' && (
          <Grid
            position={[0, -0.01, 0]}
            args={[90, 90]}
            cellSize={1.0}
            cellThickness={0.5}
            cellColor={lightingMode === 'DAY' ? '#7b93ad' : '#1e293b'}
            sectionSize={5.0}
            sectionThickness={1.0}
            sectionColor={lightingMode === 'DAY' ? '#526d8c' : '#334155'}
            fadeDistance={55}
            fadeStrength={1.2}
            infiniteGrid
          />
        )}

        {sceneSource === 'MAPS_3D_TILES' && tilesAnchor && (
          <PhotorealisticTilesScene
            anchor={tilesAnchor}
            lightingMode={lightingMode}
            onSceneReady={onSceneReady}
            onHoverHit={setHoverHit}
          />
        )}

        {sceneSource === 'MESH_RECON' && job?.glbUrl && (
          <>
            <HouseMesh
              glbUrl={job.glbUrl}
              lightingMode={lightingMode}
              onSceneLoaded={handleMeshLoaded}
              onHoverHit={setHoverHit}
            />
            {job.splatUrl && (
              <SplatErrorBoundary>
                <React.Suspense fallback={null}>
                  <Splat src={job.splatUrl} />
                </React.Suspense>
              </SplatErrorBoundary>
            )}
            <ContactShadows
              position={[0, 0.01, 0]}
              opacity={lightingMode === 'NIGHT' ? 0.35 : 0.5}
              scale={32}
              blur={2.2}
              far={12}
            />
          </>
        )}

        {sceneSource === 'MESH_RECON' &&
          !job?.glbUrl &&
          (proceduralSpec || proceduralPreset) && (
            <>
              <ProceduralBuildingMesh
                presetOrSpec={(proceduralSpec || proceduralPreset)!}
                lightingMode={lightingMode}
                onSceneLoaded={handleMeshLoaded}
                onHoverHit={setHoverHit}
              />
            <ContactShadows
              position={[0, 0.01, 0]}
              opacity={lightingMode === 'NIGHT' ? 0.35 : 0.5}
              scale={32}
              blur={2.2}
              far={12}
            />
          </>
        )}

        <InstancedBulbsLayer lightingMode={lightingMode} />

        <HoverSurfaceRing hoverHit={hoverHit} radius={cursorRadius} />

        {rulerPoints.map((pt, idx) => (
          <mesh key={`ruler-pt-${idx}`} position={pt}>
            <sphereGeometry args={[0.06, 14, 14]} />
            <meshBasicMaterial color="#38bdf8" toneMapped={false} />
          </mesh>
        ))}
        {rulerPoints.length === 2 && (
          <Line
            points={[rulerPoints[0], rulerPoints[1]]}
            color="#38bdf8"
            lineWidth={2.5}
          />
        )}

        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          enabled={!isPaintingScatter}
          autoRotate={sceneSource === 'NONE'}
          autoRotateSpeed={0.35}
          target={orbitTarget}
          maxPolarAngle={Math.PI * 0.492}
          minDistance={2.5}
          maxDistance={sceneSource === 'MAPS_3D_TILES' ? 350 : 120}
        />

        {sceneSource !== 'NONE' && (
          <GizmoHelper alignment="bottom-left" margin={[54, 118]}>
            <GizmoViewport
              axisColors={['#f87171', '#4ade80', '#38bdf8']}
              labelColor="#f8fafc"
            />
          </GizmoHelper>
        )}

        <EffectComposer>
          <Bloom
            mipmapBlur
            luminanceThreshold={0.82}
            intensity={lightingMode === 'DAY' ? 0.3 : 1.45}
          />
        </EffectComposer>
      </Canvas>

      {/* High-contrast surface hover chip */}
      {hoverHit && sceneSource !== 'NONE' && (
        <div className="pointer-events-none absolute left-4 top-20 z-10 rounded-full border border-white/15 bg-slate-950/90 px-3 py-1 text-[11px] font-medium text-slate-200 shadow-lg backdrop-blur-md">
          Surface:{' '}
          <span className="font-semibold text-amber-300">
            {SURFACE_LABELS[hoverHit.surfaceMaterial] || hoverHit.surfaceMaterial}
          </span>
        </div>
      )}
    </div>
  );
}
