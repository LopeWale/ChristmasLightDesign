'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { ThreeEvent } from '@react-three/fiber';
import type { SurfaceMaterial, Vec3 } from '@lumen3d/shared-schemas';
import { useStudioStore, type LightingMode } from '@/store/useStudioStore';
import {
  offsetPointAlongNormal,
  type SurfaceTriangle,
} from '@/lib/geometry/splineGenerators';

export interface HoverHitInfo {
  point: Vec3;
  normal: Vec3;
  surfaceMaterial: SurfaceMaterial;
}

export interface HouseMeshProps {
  glbUrl: string;
  lightingMode: LightingMode;
  onSceneLoaded: (group: THREE.Group, minY: number) => void;
  onHoverHit: (info: HoverHitInfo | null) => void;
}

export function inferSurfaceMaterialFromName(rawName: string): SurfaceMaterial {
  const n = rawName.toLowerCase();
  if (n.includes('roof') || n.includes('shingle')) return 'asphalt_shingle';
  if (n.includes('eave') || n.includes('gutter')) return 'metal_gutter';
  if (n.includes('door') && !n.includes('garage')) return 'wood_fascia';
  if (n.includes('window') || n.includes('fascia')) return 'wood_fascia';
  if (n.includes('garage')) return 'vinyl_siding';
  if (n.includes('column') || n.includes('pillar') || n.includes('post'))
    return 'column_post';
  if (n.includes('shrub') || n.includes('bush') || n.includes('tree') || n.includes('foliage'))
    return 'foliage_shrub';
  if (n.includes('ground') || n.includes('turf') || n.includes('walkway'))
    return 'ground_turf';
  if (n.includes('stucco')) return 'stucco';
  if (n.includes('wall') || n.includes('brick')) return 'brick_masonry';
  return 'unknown';
}

function getLightingTint(mode: LightingMode): THREE.Color {
  switch (mode) {
    case 'DAY':
      return new THREE.Color('#ffffff');
    case 'DUSK':
      return new THREE.Color('#9ea2c8');
    case 'NIGHT':
    default:
      // Cool-blue darkened moonlight material tint for Night mode
      return new THREE.Color('#425982');
  }
}

function extractNearbyMeshTriangles(
  mesh: THREE.Mesh,
  worldCenter: THREE.Vector3,
  radius: number
): SurfaceTriangle[] {
  const geom = mesh.geometry;
  const posAttr = geom.getAttribute('position');
  if (!posAttr) return [];

  mesh.updateMatrixWorld(true);
  const matWorld = mesh.matrixWorld;
  const normalMat = new THREE.Matrix3().getNormalMatrix(matWorld);
  const indexAttr = geom.getIndex();
  const triCount = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;
  const maxRadiusSq = Math.pow(radius * 1.6, 2);

  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const nVec = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const out: SurfaceTriangle[] = [];

  for (let t = 0; t < triCount && out.length < 600; t++) {
    const i0 = indexAttr ? indexAttr.getX(t * 3) : t * 3;
    const i1 = indexAttr ? indexAttr.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = indexAttr ? indexAttr.getX(t * 3 + 2) : t * 3 + 2;

    vA.fromBufferAttribute(posAttr, i0).applyMatrix4(matWorld);
    vB.fromBufferAttribute(posAttr, i1).applyMatrix4(matWorld);
    vC.fromBufferAttribute(posAttr, i2).applyMatrix4(matWorld);

    const cx = (vA.x + vB.x + vC.x) / 3;
    const cy = (vA.y + vB.y + vC.y) / 3;
    const cz = (vA.z + vB.z + vC.z) / 3;
    const dx = cx - worldCenter.x;
    const dy = cy - worldCenter.y;
    const dz = cz - worldCenter.z;

    if (dx * dx + dy * dy + dz * dz > maxRadiusSq) continue;

    e1.subVectors(vB, vA);
    e2.subVectors(vC, vA);
    nVec.crossVectors(e1, e2);
    if (nVec.lengthSq() > 1e-10) {
      nVec.normalize();
    } else {
      nVec.set(0, 1, 0).applyMatrix3(normalMat).normalize();
    }

    out.push({
      a: [vA.x, vA.y, vA.z],
      b: [vB.x, vB.y, vB.z],
      c: [vC.x, vC.y, vC.z],
      normal: [nVec.x, nVec.y, nVec.z],
    });
  }

  return out;
}

export function HouseMesh({
  glbUrl,
  lightingMode,
  onSceneLoaded,
  onHoverHit,
}: HouseMeshProps) {
  const [loadedGroup, setLoadedGroup] = useState<THREE.Group | null>(null);
  const materialsRef = useRef<THREE.MeshStandardMaterial[]>([]);
  const lastScatterSampleRef = useRef<THREE.Vector3 | null>(null);

  const toolMode = useStudioStore((s) => s.toolMode);
  const activeBrushRadius = useStudioStore((s) => s.activeBrushRadius);
  const isPaintingScatter = useStudioStore((s) => s.isPaintingScatter);
  const appendDraftPoint = useStudioStore((s) => s.appendDraftPoint);
  const commitDraftRun = useStudioStore((s) => s.commitDraftRun);
  const setPaintingScatter = useStudioStore((s) => s.setPaintingScatter);
  const setActiveHelixRadius = useStudioStore((s) => s.setActiveHelixRadius);
  const addRulerPoint = useStudioStore((s) => s.addRulerPoint);
  const runs = useStudioStore((s) => s.runs);
  const selectRun = useStudioStore((s) => s.selectRun);

  useEffect(() => {
    let cancelled = false;
    const loader = new GLTFLoader();

    loader.load(
      glbUrl,
      (gltf) => {
        if (cancelled) return;
        const root = gltf.scene;
        const mats: THREE.MeshStandardMaterial[] = [];

        root.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) {
            const mesh = obj as THREE.Mesh;
            if (!mesh.geometry.getAttribute('normal')) {
              mesh.geometry.computeVertexNormals();
            }
            const hasVertexColors = Boolean(mesh.geometry.getAttribute('color'));
            const stdMat = new THREE.MeshStandardMaterial({
              color: getLightingTint(lightingMode),
              vertexColors: hasVertexColors,
              roughness: 0.82,
              metalness: 0.06,
            });
            mesh.material = stdMat;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mats.push(stdMat);
          }
        });

        root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(root);
        const minY = Number.isFinite(box.min.y) ? box.min.y : 0;

        materialsRef.current = mats;
        setLoadedGroup(root);
        onSceneLoaded(root, minY);
      },
      undefined,
      (err) => {
        console.error('Failed to load scene.glb:', err);
      }
    );

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glbUrl]);

  useEffect(() => {
    const tint = getLightingTint(lightingMode);
    for (const mat of materialsRef.current) {
      mat.color.copy(tint);
      mat.needsUpdate = true;
    }
  }, [lightingMode]);

  const computeHitWorldNormal = (e: ThreeEvent<PointerEvent | MouseEvent>): Vec3 => {
    if (e.face && e.object) {
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(e.object.matrixWorld);
      const worldNormal = e.face.normal.clone().applyMatrix3(normalMatrix).normalize();
      return [worldNormal.x, worldNormal.y, worldNormal.z];
    }
    return [0, 1, 0];
  };

  const resolveMeshHierarchyName = (obj: THREE.Object3D | null): string => {
    const parts: string[] = [];
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      if (cur.name) parts.push(cur.name);
      cur = cur.parent;
    }
    return parts.join(' ');
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const worldNormal = computeHitWorldNormal(e);
    const meshName = resolveMeshHierarchyName(e.object);
    const surfaceMaterial = inferSurfaceMaterialFromName(meshName);
    const hitPt: Vec3 = [e.point.x, e.point.y, e.point.z];

    onHoverHit({
      point: hitPt,
      normal: worldNormal,
      surfaceMaterial,
    });

    if (toolMode === 'SURFACE_SCATTER' && isPaintingScatter && (e.object as THREE.Mesh).isMesh) {
      if (
        !lastScatterSampleRef.current ||
        lastScatterSampleRef.current.distanceTo(e.point) >= activeBrushRadius * 0.35
      ) {
        lastScatterSampleRef.current = e.point.clone();
        const tris = extractNearbyMeshTriangles(
          e.object as THREE.Mesh,
          e.point,
          activeBrushRadius
        );
        const offsetPt = offsetPointAlongNormal(hitPt, worldNormal);
        appendDraftPoint(offsetPt, surfaceMaterial, tris);
      }
    }
  };

  const handlePointerOut = () => {
    onHoverHit(null);
  };

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();

    const worldNormal = computeHitWorldNormal(e);
    const meshName = resolveMeshHierarchyName(e.object);
    const surfaceMaterial = inferSurfaceMaterialFromName(meshName);
    const rawPt: Vec3 = [e.point.x, e.point.y, e.point.z];
    const offsetPt = offsetPointAlongNormal(rawPt, worldNormal);

    if (toolMode === 'CALIBRATE_RULER') {
      addRulerPoint(rawPt);
      return;
    }

    if (toolMode === 'SELECT') {
      // Find closest bulb within 0.45 scene units to select its LightRun
      let bestId: string | null = null;
      let bestDist = 0.45;
      for (const run of runs) {
        for (const bp of run.bulbPositions) {
          const d = Math.hypot(bp[0] - rawPt[0], bp[1] - rawPt[1], bp[2] - rawPt[2]);
          if (d < bestDist) {
            bestDist = d;
            bestId = run.id;
          }
        }
      }
      selectRun(bestId);
      return;
    }

    if (toolMode === 'LINEAR_EAVE' || toolMode === 'PATHWAY_STAKE') {
      const targetPt: Vec3 =
        toolMode === 'PATHWAY_STAKE'
          ? offsetPointAlongNormal(rawPt, [0, 1, 0])
          : offsetPt;
      appendDraftPoint(targetPt, surfaceMaterial);
      return;
    }

    if (toolMode === 'HELICAL_WRAP') {
      // Snap X/Z center to column bounding box center if clicking a column/pillar mesh
      let axisPt: Vec3 = [...rawPt];
      if ((e.object as THREE.Mesh).isMesh && surfaceMaterial === 'column_post') {
        const box = new THREE.Box3().setFromObject(e.object);
        const center = new THREE.Vector3();
        const size = new THREE.Vector3();
        box.getCenter(center);
        box.getSize(size);
        axisPt = [center.x, rawPt[1], center.z];
        const estRadius = 0.25 * (size.x + size.z);
        if (estRadius > 0.04 && estRadius < 1.5) {
          setActiveHelixRadius(Number(estRadius.toFixed(3)));
        }
      }

      const prevCount = useStudioStore.getState().draftPoints.length;
      appendDraftPoint(axisPt, 'column_post');
      if (prevCount >= 1) {
        commitDraftRun();
      }
      return;
    }

    if (toolMode === 'SURFACE_SCATTER' && (e.object as THREE.Mesh).isMesh) {
      setPaintingScatter(true);
      lastScatterSampleRef.current = e.point.clone();
      const tris = extractNearbyMeshTriangles(
        e.object as THREE.Mesh,
        e.point,
        activeBrushRadius
      );
      appendDraftPoint(offsetPt, surfaceMaterial, tris);
    }
  };

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    if (toolMode === 'SURFACE_SCATTER' && isPaintingScatter) {
      e.stopPropagation();
      setPaintingScatter(false);
      lastScatterSampleRef.current = null;
      commitDraftRun();
    }
  };

  const handleDoubleClick = (e: ThreeEvent<MouseEvent>) => {
    if (toolMode === 'LINEAR_EAVE' || toolMode === 'PATHWAY_STAKE') {
      e.stopPropagation();
      commitDraftRun();
    }
  };

  if (!loadedGroup) return null;

  return (
    <primitive
      object={loadedGroup}
      onPointerMove={handlePointerMove}
      onPointerOut={handlePointerOut}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onDoubleClick={handleDoubleClick}
    />
  );
}
