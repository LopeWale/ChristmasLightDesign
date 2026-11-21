'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import {
  TilesRenderer,
  TilesPlugin,
  TilesAttributionOverlay,
} from '3d-tiles-renderer/r3f';
import { GoogleCloudAuthPlugin } from '3d-tiles-renderer/core/plugins';
import {
  GLTFExtensionsPlugin,
  ReorientationPlugin,
} from '3d-tiles-renderer/three/plugins';
import { computeTilesGroundLevelOffset } from '@/lib/geometry/proceduralBuilding';
import {
  useStudioStore,
  type LightingMode,
  type TilesAnchor,
} from '@/store/useStudioStore';
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
  const leveledOnceRef = useRef<boolean>(false);
  const [levelOffsetY, setLevelOffsetY] = useState<number>(0);

  const setMapsStatus = useStudioStore((s) => s.setMapsStatus);
  const handlers = useSurfacePointerHandlers(onHoverHit);

  useEffect(() => {
    leveledOnceRef.current = false;
    setLevelOffsetY(0);
  }, [anchor.lat, anchor.lng, anchor.height]);

  const dracoLoader = useMemo(() => {
    const loader = new DRACOLoader();
    loader.setDecoderPath('/draco/');
    return loader;
  }, []);

  useEffect(() => {
    return () => {
      dracoLoader.dispose();
    };
  }, [dracoLoader]);

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

  const gltfExtArgs = useMemo(
    () => [
      {
        dracoLoader,
        autoDispose: false,
      },
    ],
    [dracoLoader]
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

      const rootGroup = tilesRef.current?.group as THREE.Group | undefined;
      if (rootGroup) {
        if (!leveledOnceRef.current) {
          rootGroup.updateMatrixWorld(true);
          const deltaY = computeTilesGroundLevelOffset(rootGroup);
          if (deltaY !== null && Math.abs(deltaY) < 900) {
            leveledOnceRef.current = true;
            setLevelOffsetY(deltaY);
          }
        }
        onSceneReady?.(rootGroup);
      }
    },
    [applyTintToMaterial, lightingMode, onSceneReady]
  );

  const handleDisposeModel = useCallback(
    ({ scene }: { scene: THREE.Object3D }) => {
      scene.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const rawMat = (obj as THREE.Mesh).material;
          const mats = Array.isArray(rawMat) ? rawMat : [rawMat];
          for (const mat of mats) {
            if (mat) loadedMaterialsRef.current.delete(mat);
          }
        }
      });
    },
    []
  );

  const handleLoadError = useCallback(
    ({ error }: { error?: Error }) => {
      setMapsStatus('Map data © Google', [
        error?.message ||
          'Photorealistic 3D Tiles failed to stream—verify Map Tiles API is enabled on GOOGLE_MAPS_API_KEY.',
      ]);
    },
    [setMapsStatus]
  );

  useEffect(() => {
    loadedMaterialsRef.current.forEach((mat) => {
      applyTintToMaterial(mat, lightingMode);
    });
  }, [lightingMode, applyTintToMaterial]);

  return (
    <group position={[0, levelOffsetY, 0]} {...handlers}>
      <TilesRenderer
        ref={tilesRef}
        url={rootUrl}
        accelerateRaycast={false}
        onLoadModel={handleLoadModel}
        onDisposeModel={handleDisposeModel}
        onLoadError={handleLoadError}
      >
        <TilesPlugin plugin={GoogleCloudAuthPlugin} args={authArgs} />
        <TilesPlugin plugin={GLTFExtensionsPlugin} args={gltfExtArgs} />
        <TilesPlugin plugin={ReorientationPlugin} args={reorientArgs} />
        <TilesAttributionOverlay
          style={{
            left: '108px',
            right: 'auto',
            bottom: '10px',
            maxWidth: '280px',
            background: 'rgba(5, 8, 20, 0.9)',
            borderRadius: '8px',
            padding: '4px 10px',
            backdropFilter: 'blur(8px)',
            zIndex: 15,
          }}
        />
      </TilesRenderer>
    </group>
  );
}
