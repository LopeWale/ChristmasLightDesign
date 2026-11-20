'use client';

import React, { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import {
  BULB_PRESET_SPECS,
  type LightPattern,
  type LightRun,
  type Vec3,
} from '@lumen3d/shared-schemas';
import {
  generatePathwayStakePosts,
  recomputeRunBulbPositions,
} from '@/lib/geometry/splineGenerators';
import { useStudioStore, type LightingMode } from '@/store/useStudioStore';

const MAX_POOLED_POINT_LIGHTS = 20;
const BULB_CAPACITY_STEP = 4096;

interface FlattenedBulb {
  position: Vec3;
  baseColor: THREE.Color;
  radiusSceneUnits: number;
  twinklePhase: number | null;
  selected: boolean;
}

function pickPatternHex(
  colorsHex: string[],
  pattern: LightPattern,
  bulbIndex: number
): string {
  if (colorsHex.length === 0) return '#ffd996';
  if (pattern === 'SOLID') return colorsHex[0];
  if (pattern === 'CANDY_CANE') {
    const stripeIdx = Math.floor(bulbIndex / 3) % colorsHex.length;
    return colorsHex[stripeIdx];
  }
  return colorsHex[bulbIndex % colorsHex.length];
}

export function InstancedBulbsLayer({
  lightingMode,
}: {
  lightingMode: LightingMode;
}) {
  const runs = useStudioStore((s) => s.runs);
  const selectedRunId = useStudioStore((s) => s.selectedRunId);
  const feetPerSceneUnit = useStudioStore((s) => s.feetPerSceneUnit);
  const toolMode = useStudioStore((s) => s.toolMode);
  const draftPoints = useStudioStore((s) => s.draftPoints);
  const draftScatterTriangles = useStudioStore((s) => s.draftScatterTriangles);
  const activeBulbPreset = useStudioStore((s) => s.activeBulbPreset);
  const activeSpacingInches = useStudioStore((s) => s.activeSpacingInches);
  const activeColorsHex = useStudioStore((s) => s.activeColorsHex);
  const activePattern = useStudioStore((s) => s.activePattern);
  const activeHelixRadius = useStudioStore((s) => s.activeHelixRadius);
  const activeHelixTurns = useStudioStore((s) => s.activeHelixTurns);
  const activeBrushRadius = useStudioStore((s) => s.activeBrushRadius);

  const instancedMeshRef = useRef<THREE.InstancedMesh>(null);
  const stakesMeshRef = useRef<THREE.InstancedMesh>(null);
  const pointLightRefs = useRef<Array<THREE.PointLight | null>>([]);

  // Build live preview run while user is actively clicking/dragging
  const previewBulbs = useMemo<Vec3[]>(() => {
    if (draftPoints.length === 0) return [];
    if (
      (toolMode === 'LINEAR_EAVE' || toolMode === 'PATHWAY_STAKE') &&
      draftPoints.length >= 2
    ) {
      return recomputeRunBulbPositions(
        {
          id: 'draft',
          name: 'Draft',
          toolMode,
          bulbPreset:
            toolMode === 'PATHWAY_STAKE' ? 'PATHWAY_C9_STAKE' : activeBulbPreset,
          spacingInches: activeSpacingInches,
          colorsHex: activeColorsHex,
          pattern: activePattern,
          controlPoints: draftPoints,
          surfaceMaterial: 'unknown',
        },
        feetPerSceneUnit
      );
    }
    if (toolMode === 'SURFACE_SCATTER' && draftPoints.length >= 1) {
      return recomputeRunBulbPositions(
        {
          id: 'draft',
          name: 'Draft',
          toolMode,
          bulbPreset: activeBulbPreset,
          spacingInches: activeSpacingInches,
          colorsHex: activeColorsHex,
          pattern: activePattern,
          controlPoints: draftPoints,
          surfaceMaterial: 'foliage_shrub',
        },
        feetPerSceneUnit,
        draftScatterTriangles,
        activeBrushRadius
      );
    }
    if (toolMode === 'HELICAL_WRAP' && draftPoints.length === 1) {
      return [draftPoints[0]];
    }
    return draftPoints;
  }, [
    draftPoints,
    draftScatterTriangles,
    toolMode,
    activeBulbPreset,
    activeSpacingInches,
    activeColorsHex,
    activePattern,
    feetPerSceneUnit,
    activeBrushRadius,
  ]);

  const { flatBulbs, stakeSegments, wirePolylines } = useMemo(() => {
    const bulbs: FlattenedBulb[] = [];
    const stakes: Array<{ base: Vec3; top: Vec3 }> = [];
    const wires: Vec3[][] = [];

    const appendRunBulbs = (run: LightRun, isSelected: boolean) => {
      const spec = BULB_PRESET_SPECS[run.bulbPreset];
      const radiusScene = Math.max(
        0.018,
        spec.bulbRadiusInches / 12.0 / Math.max(0.2, feetPerSceneUnit)
      );

      run.bulbPositions.forEach((pos, idx) => {
        const hex = pickPatternHex(run.colorsHex, run.pattern, idx);
        bulbs.push({
          position: pos,
          baseColor: new THREE.Color(hex),
          radiusSceneUnits: isSelected ? radiusScene * 1.2 : radiusScene,
          twinklePhase: run.pattern === 'TWINKLE' ? idx * 1.37 : null,
          selected: isSelected,
        });
      });

      if (run.toolMode === 'PATHWAY_STAKE') {
        const segs = generatePathwayStakePosts({
          controlPoints: run.controlPoints,
          spacingInches: run.spacingInches,
          feetPerSceneUnit,
        });
        stakes.push(...segs);
      } else if (
        (run.toolMode === 'LINEAR_EAVE' && run.bulbPreset !== 'ICICLE_DROP_LED') ||
        run.toolMode === 'HELICAL_WRAP'
      ) {
        if (run.bulbPositions.length >= 2) {
          wires.push(run.bulbPositions);
        }
      } else if (run.controlPoints.length >= 2 && run.toolMode === 'LINEAR_EAVE') {
        wires.push(run.controlPoints);
      }
    };

    for (const run of runs) {
      appendRunBulbs(run, run.id === selectedRunId);
    }

    if (previewBulbs.length > 0) {
      const previewSpec = BULB_PRESET_SPECS[activeBulbPreset];
      const rScene = Math.max(
        0.018,
        previewSpec.bulbRadiusInches / 12.0 / Math.max(0.2, feetPerSceneUnit)
      );
      previewBulbs.forEach((pos, idx) => {
        const hex = pickPatternHex(activeColorsHex, activePattern, idx);
        bulbs.push({
          position: pos,
          baseColor: new THREE.Color(hex),
          radiusSceneUnits: rScene,
          twinklePhase: activePattern === 'TWINKLE' ? idx * 1.37 : null,
          selected: false,
        });
      });
      if (draftPoints.length >= 2) {
        wires.push(draftPoints);
      }
    }

    // Include activeHelixRadius/Turns dependency awareness
    void activeHelixRadius;
    void activeHelixTurns;

    return {
      flatBulbs: bulbs,
      stakeSegments: stakes,
      wirePolylines: wires,
    };
  }, [
    runs,
    selectedRunId,
    feetPerSceneUnit,
    previewBulbs,
    activeBulbPreset,
    activeColorsHex,
    activePattern,
    draftPoints,
    activeHelixRadius,
    activeHelixTurns,
  ]);

  const capacity = Math.max(
    BULB_CAPACITY_STEP,
    Math.ceil((flatBulbs.length + 128) / BULB_CAPACITY_STEP) * BULB_CAPACITY_STEP
  );

  const stakesCapacity = Math.max(256, stakeSegments.length + 64);

  const emissiveBoost =
    lightingMode === 'NIGHT' ? 2.75 : lightingMode === 'DUSK' ? 2.15 : 1.25;

  // Populate batched InstancedMesh transforms & HDR colors
  useLayoutEffect(() => {
    const mesh = instancedMeshRef.current;
    if (!mesh) return;

    mesh.count = flatBulbs.length;
    const dummy = new THREE.Object3D();
    const hdrColor = new THREE.Color();

    for (let i = 0; i < flatBulbs.length; i++) {
      const b = flatBulbs[i];
      dummy.position.set(b.position[0], b.position[1], b.position[2]);
      dummy.scale.setScalar(b.radiusSceneUnits);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      const selBoost = b.selected ? 1.25 : 1.0;
      hdrColor.setRGB(
        b.baseColor.r * emissiveBoost * selBoost,
        b.baseColor.g * emissiveBoost * selBoost,
        b.baseColor.b * emissiveBoost * selBoost
      );
      mesh.setColorAt(i, hdrColor);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
  }, [flatBulbs, emissiveBoost, capacity]);

  // Populate batched pathway stakes InstancedMesh
  useLayoutEffect(() => {
    const sMesh = stakesMeshRef.current;
    if (!sMesh) return;

    sMesh.count = stakeSegments.length;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < stakeSegments.length; i++) {
      const seg = stakeSegments[i];
      const h = Math.max(0.02, seg.top[1] - seg.base[1]);
      dummy.position.set(seg.base[0], seg.base[1] + h * 0.5, seg.base[2]);
      dummy.scale.set(1, h, 1);
      dummy.updateMatrix();
      sMesh.setMatrixAt(i, dummy.matrix);
    }
    sMesh.instanceMatrix.needsUpdate = true;
  }, [stakeSegments, stakesCapacity]);

  // Distribute up to 20 pooled PointLights evenly across active bulbs (no shader recompilation!)
  useLayoutEffect(() => {
    const total = flatBulbs.length;
    const activeLightCount = Math.min(MAX_POOLED_POINT_LIGHTS, total);
    const perLightIntensity =
      lightingMode === 'NIGHT'
        ? 1.15
        : lightingMode === 'DUSK'
          ? 0.65
          : 0.08;

    for (let slot = 0; slot < MAX_POOLED_POINT_LIGHTS; slot++) {
      const light = pointLightRefs.current[slot];
      if (!light) continue;

      if (slot < activeLightCount && total > 0) {
        const sampleIdx = Math.min(
          total - 1,
          Math.floor(((slot + 0.5) / activeLightCount) * total)
        );
        const bulb = flatBulbs[sampleIdx];
        light.position.set(bulb.position[0], bulb.position[1], bulb.position[2]);
        light.color.copy(bulb.baseColor);
        light.intensity = perLightIntensity;
        light.distance = 4.2;
        light.decay = 2.0;
      } else {
        light.intensity = 0;
      }
    }
  }, [flatBulbs, lightingMode]);

  // Subtle twinkle animation in useFrame when any TWINKLE run is present
  const hasTwinkle = useMemo(
    () => flatBulbs.some((b) => b.twinklePhase !== null),
    [flatBulbs]
  );

  useFrame(({ clock }) => {
    if (!hasTwinkle) return;
    const mesh = instancedMeshRef.current;
    if (!mesh || !mesh.instanceColor) return;

    const t = clock.getElapsedTime();
    const hdrColor = new THREE.Color();

    for (let i = 0; i < flatBulbs.length; i++) {
      const b = flatBulbs[i];
      if (b.twinklePhase === null) continue;
      const pulse = 0.45 + 0.65 * (0.5 + 0.5 * Math.sin(t * 4.2 + b.twinklePhase));
      hdrColor.setRGB(
        b.baseColor.r * emissiveBoost * pulse,
        b.baseColor.g * emissiveBoost * pulse,
        b.baseColor.b * emissiveBoost * pulse
      );
      mesh.setColorAt(i, hdrColor);
    }
    mesh.instanceColor.needsUpdate = true;
  });

  return (
    <group name="lumen3d-bulbs-layer">
      {/* Single-draw-call batched InstancedMesh for all glowing bulbs */}
      <instancedMesh
        key={`bulbs-${capacity}`}
        ref={instancedMeshRef}
        args={[undefined, undefined, capacity]}
        frustumCulled={false}
      >
        <sphereGeometry args={[1, 10, 10]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>

      {/* Batched ground stakes for PATHWAY_STAKE runs */}
      <instancedMesh
        key={`stakes-${stakesCapacity}`}
        ref={stakesMeshRef}
        args={[undefined, undefined, stakesCapacity]}
        frustumCulled={false}
      >
        <cylinderGeometry args={[0.012, 0.012, 1, 8]} />
        <meshStandardMaterial color="#1f2937" roughness={0.8} />
      </instancedMesh>

      {/* Subtle dark green cord lines along runs */}
      {wirePolylines.map((pts, idx) => (
        <Line
          key={`wire-${idx}-${pts.length}`}
          points={pts}
          color="#1a3324"
          lineWidth={1.2}
        />
      ))}

      {/* Fixed pool of 20 PointLights to illuminate walls/eaves/snow without shader stalls */}
      {Array.from({ length: MAX_POOLED_POINT_LIGHTS }).map((_, idx) => (
        <pointLight
          key={`pooled-light-${idx}`}
          ref={(el) => {
            pointLightRefs.current[idx] = el;
          }}
          intensity={0}
          distance={4.2}
          decay={2}
        />
      ))}
    </group>
  );
}
