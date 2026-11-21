'use client';

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import {
  TilesRenderer,
  TilesPlugin,
  TilesAttributionOverlay,
} from '3d-tiles-renderer/r3f';
import {
  GoogleCloudAuthPlugin,
  ReorientationPlugin,
} from '3d-tiles-renderer/plugins';
import type { LightingMode, TilesAnchor } from '@/store/useStudioStore';
import {
  useSurfacePointerHandlers,
  type HoverHitInfo,
} from './HouseMesh';

export interface PhotorealisticTilesSceneProps {
  anchor: TilesAnchor;
  lightingMode: LightingMode;
  onSceneReady?: (group: THREE.Group) => void;
  onHoverHit: (info: HoverHitInfo | null) => void;
}

function getTileBrightnessScalar(mode: LightingMode): number {
  switch (mode) {
    case 'DAY':
      return 1.0;
    case 'DUSK':
      return 0.56;
    case 'NIGHT':
    default:
      return 0.25;
  }
}

export function PhotorealisticTilesScene({
  anchor,
  lightingMode,
  onSceneReady,
  onHoverHit,
}: PhotorealisticTilesSceneProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tilesRef = useRef<any>(null);
  const originalTileColorsRef = useRef<WeakMap<THREE.Material, THREE.Color>>(
    new WeakMap()
  );
  const loadedMaterialsRef = useRef<Set<THREE.Material>>(new Set());
  const handlers = useSurfacePointerHandlers(onHoverHit);

  const rootUrl = useMemo(() => {
    const origin =
      typeof window !== 'undefined'
        ? window.location.origin
        : 'http://localhost:3000';
    return `${origin}/api/maps/tiles/v1/3dtiles/root.json`;
  }, []);

  const authArgs = useMemo(
    () => [
      {
        apiToken: 'proxy',
        autoRefreshToken: true,
        useRecommendedSettings: true,
      },
    ],
    []
  );

  const reorientArgs = useMemo(
    () => [
      {
        lat: THREE.MathUtils.degToRad(anchor.lat),
        lon: THREE.MathUtils.degToRad(anchor.lng),
        height: anchor.height,
        recenter: true,
      },
    ],
    [anchor.lat, anchor.lng, anchor.height]
  );

  const applyTintToMaterial = useCallback(
    (mat: THREE.Material, mode: LightingMode) => {
      const m = mat as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
      if (!m || !('color' in m) || !m.color) return;
      let base = originalTileColorsRef.current.get(mat);
      if (!base) {
        base = m.color.clone();
        originalTileColorsRef.current.set(mat, base);
      }
      const scalar = getTileBrightnessScalar(mode);
      m.color.copy(base).multiplyScalar(scalar);
      if (mode === 'NIGHT') {
        m.color.b = Math.min(1.0, m.color.b * 1.28 + 0.02);
      }
      m.needsUpdate = true;
    },
    []
  );

  const handleLoadModel = useCallback(
    ({ scene }: { scene: THREE.Object3D }) => {
      scene.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mesh = obj as THREE.Mesh;
          if (!mesh.geometry.getAttribute('normal')) {
            mesh.geometry.computeVertexNormals();
          }
          const mats = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material];
          for (const mat of mats) {
            if (mat) {
              loadedMaterialsRef.current.add(mat);
              applyTintToMaterial(mat, lightingMode);
            }
          }
        }
      });
      if (tilesRef.current?.group && onSceneReady) {
        onSceneReady(tilesRef.current.group as THREE.Group);
      }
    },
    [applyTintToMaterial, lightingMode, onSceneReady]
  );

  useEffect(() => {
    loadedMaterialsRef.current.forEach((mat) => {
      applyTintToMaterial(mat, lightingMode);
    });
  }, [lightingMode, applyTintToMaterial]);

  return (
    <group {...handlers}>
      <TilesRenderer
        ref={tilesRef}
        url={rootUrl}
        onLoadModel={handleLoadModel}
      >
        <TilesPlugin plugin={GoogleCloudAuthPlugin} args={authArgs} />
        <TilesPlugin plugin={ReorientationPlugin} args={reorientArgs} />
        <TilesAttributionOverlay
          style={{
            left: 'auto',
            right: '16px',
            bottom: '12px',
            background: 'rgba(2, 6, 23, 0.82)',
            borderRadius: '8px',
            padding: '4px 10px',
            backdropFilter: 'blur(8px)',
          }}
        />
      </TilesRenderer>
    </group>
  );
}
