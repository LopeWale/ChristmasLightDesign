'use client';

import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { SparkRenderer, SplatFileType, SplatMesh } from '@sparkjsdev/spark';
import type { LightingMode } from '@/store/useStudioStore';

export interface SparkSplatLayerProps {
  splatUrl: string;
  lightingMode: LightingMode;
}

function applySplatLighting(mesh: SplatMesh, lightingMode: LightingMode): void {
  if (lightingMode === 'NIGHT') {
    mesh.opacity = 0.28;
    mesh.recolor.set('#8ca8dc');
  } else if (lightingMode === 'DUSK') {
    mesh.opacity = 0.36;
    mesh.recolor.set('#dfbaa8');
  } else {
    mesh.opacity = 0.44;
    mesh.recolor.set('#ffffff');
  }
}

/**
 * World Labs `@sparkjsdev/spark` 2.4 WebGL2 3D Gaussian Splatting layer.
 * Keeps the previous revision's SplatMesh visible while the next live-scan revision
 * initializes, then swaps atomically with zero frame flicker and raycastable=false
 * so holiday light spline placement hits the deterministic metric GLB collider underneath.
 */
export function SparkSplatLayer({
  splatUrl,
  lightingMode,
}: SparkSplatLayerProps) {
  const { gl, scene } = useThree();
  const sparkRef = useRef<SparkRenderer | null>(null);
  const activeMeshRef = useRef<SplatMesh | null>(null);
  const lightingModeRef = useRef<LightingMode>(lightingMode);
  lightingModeRef.current = lightingMode;

  // 1. Mount single SparkRenderer bound to R3F's WebGL2 renderer
  useEffect(() => {
    let spark: SparkRenderer | null = null;
    try {
      spark = new SparkRenderer({ renderer: gl });
      scene.add(spark);
      sparkRef.current = spark;
    } catch {
      sparkRef.current = null;
    }

    return () => {
      if (activeMeshRef.current) {
        scene.remove(activeMeshRef.current);
        try {
          activeMeshRef.current.dispose();
        } catch {
          // ignore disposal errors on context loss
        }
        activeMeshRef.current = null;
      }
      if (spark) {
        scene.remove(spark);
        try {
          spark.dispose();
        } catch {
          // ignore disposal errors on context loss
        }
      }
      sparkRef.current = null;
    };
  }, [gl, scene]);

  // 2. Atomically stream & swap SplatMesh revisions (`scene_r001.splat` -> `scene_r002.splat`)
  useEffect(() => {
    if (!splatUrl || !sparkRef.current) return;
    let cancelled = false;
    let candidate: SplatMesh | null = null;

    try {
      candidate = new SplatMesh({
        url: splatUrl,
        fileType: SplatFileType.SPLAT,
        raycastable: false,
      });
      // Standard 32-byte .splat stores OpenCV (+X right, +Y down, +Z forward) -> rotate 180 deg around X
      candidate.quaternion.set(1, 0, 0, 0);
      applySplatLighting(candidate, lightingModeRef.current);

      candidate.initialized
        .then(() => {
          if (cancelled || !candidate) {
            try {
              candidate?.dispose();
            } catch {
              // ignore
            }
            return;
          }
          applySplatLighting(candidate, lightingModeRef.current);
          scene.add(candidate);

          const prev = activeMeshRef.current;
          activeMeshRef.current = candidate;
          if (prev && prev !== candidate) {
            scene.remove(prev);
            try {
              prev.dispose();
            } catch {
              // ignore
            }
          }
        })
        .catch(() => {
          try {
            candidate?.dispose();
          } catch {
            // ignore
          }
        });
    } catch {
      // Fallback cleanly to underlying PBR GLB mesh if WebGL context rejects splat shaders
    }

    return () => {
      cancelled = true;
    };
  }, [splatUrl, scene]);

  // 3. Live Day / Dusk / Night tinting on the active SplatMesh
  useEffect(() => {
    if (activeMeshRef.current) {
      applySplatLighting(activeMeshRef.current, lightingMode);
    }
  }, [lightingMode]);

  return null;
}
