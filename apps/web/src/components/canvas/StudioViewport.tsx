'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { HouseMesh, type HoverHitInfo } from './HouseMesh';
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
    // preserveDrawingBuffer: true retains EffectComposer's composited Bloom frame
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
    const dist = Math.max(18.5, height * 2.15, horizSpan * 1.65);
    camera.position.set(
      orbitTarget[0] + 0.5,
      Math.max(4.0, height * 0.54),
      orbitTarget[2] + dist
    );
    camera.lookAt(orbitTarget[0], orbitTarget[1], orbitTarget[2]);
    camera.updateProjectionMatrix();
  }, [fitBounds, orbitTarget, camera]);

  return null;
}

function SceneLightingRig({ lightingMode }: { lightingMode: LightingMode }) {
  if (lightingMode === 'DAY') {
    return (
      <>
        <color attach="background" args={['#9ec5e8']} />
        <hemisphereLight args={['#dceeff', '#5c7052', 1.15]} />
        <directionalLight position={[12, 18, 14]} intensity={1.45} color="#fff7eb" />
        <directionalLight position={[-14, 14, -12]} intensity={0.65} color="#d6e8ff" />
      </>
    );
  }
  if (lightingMode === 'DUSK') {
    return (
      <>
        <color attach="background" args={['#1a1b38']} />
        <hemisphereLight args={['#7d7bb8', '#2a2c48', 0.85]} />
        <directionalLight position={[-14, 10, 12]} intensity={0.85} color="#ff9d6c" />
        <directionalLight position={[15, 12, -12]} intensity={0.55} color="#8ba8e8" />
      </>
    );
  }
  return (
    <>
      <color attach="background" args={['#050814']} />
      <hemisphereLight args={['#334e82', '#10182d', 0.55]} />
      <directionalLight position={[-10, 16, 12]} intensity={0.52} color="#7aa2e8" />
      <directionalLight position={[14, 12, -12]} intensity={0.32} color="#5c82c8" />
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
        opacity={0.85}
        toneMapped={false}
      />
    </mesh>
  );
}

export interface StudioViewportProps {
  onSceneReady?: (group: THREE.Group) => void;
  onRegisterScreenshot?: (captureFn: () => string) => void;
}

export function StudioViewport({
  onSceneReady,
  onRegisterScreenshot,
}: StudioViewportProps) {
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
    1.6, 2.0, 1.5,
  ]);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keyboard shortcuts: Ctrl+Z / Cmd+Z undo, Ctrl+Y / Cmd+Shift+Z redo, Enter finish run, Esc cancel, Delete remove run
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

  // Ensure releasing pointer outside mesh/canvas while painting scatter never locks OrbitControls
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

  const cursorRadius =
    toolMode === 'SURFACE_SCATTER' ? activeBrushRadius : 0.11;

  return (
    <div
      ref={containerRef}
      data-testid="studio-viewport"
      className="relative h-full w-full select-none overflow-hidden bg-studio-bg"
    >
      <Canvas
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        camera={{ position: [1.8, 3.8, 14.2], fov: 45, near: 0.1, far: 250 }}
      >
        <CanvasScreenshotRegistrar onRegisterCapture={onRegisterScreenshot} />
        <CameraBoundsFitter fitBounds={fitBounds} orbitTarget={orbitTarget} />
        <SceneLightingRig lightingMode={lightingMode} />

        {job?.glbUrl && (
          <HouseMesh
            glbUrl={job.glbUrl}
            lightingMode={lightingMode}
            onSceneLoaded={(group, minY, bounds) => {
              setGroundMinY(minY);
              // Compute core building box (excluding wide ground_turf pad) for crisp 360° orbit framing
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
            }}
            onHoverHit={setHoverHit}
          />
        )}

        <InstancedBulbsLayer lightingMode={lightingMode} />

        <HoverSurfaceRing hoverHit={hoverHit} radius={cursorRadius} />

        {/* Visual markers for 2-click calibration ruler */}
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
          target={orbitTarget}
          maxPolarAngle={Math.PI * 0.495}
          minDistance={2.5}
          maxDistance={65}
        />

        <EffectComposer>
          <Bloom
            mipmapBlur
            luminanceThreshold={0.8}
            intensity={lightingMode === 'DAY' ? 0.35 : 1.5}
          />
        </EffectComposer>
      </Canvas>

      {/* Subtle hover surface material pill at bottom-left */}
      {hoverHit && (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-slate-800 bg-slate-950/80 px-2.5 py-1 text-[11px] text-slate-300 backdrop-blur">
          Surface: <span className="font-semibold text-sky-300">{hoverHit.surfaceMaterial}</span>
        </div>
      )}
    </div>
  );
}
