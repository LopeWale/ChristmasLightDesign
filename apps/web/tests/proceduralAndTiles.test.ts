import { describe, expect, it, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  buildClientProceduralBuilding,
  classifyHitSurfaceMaterial,
} from '../src/lib/geometry/proceduralBuilding';
import { useStudioStore } from '../src/store/useStudioStore';

describe('Task 3: Client Procedural Fallback, 3D Tile Surface Classifier & Scene Source Store', () => {
  beforeEach(() => {
    useStudioStore.getState().resetToLauncher?.();
  });

  it('builds instant client-side 3-story condo (2 balconies) and 1-story house Three.js groups with valid normals', () => {
    const t0 = performance.now();
    const condo = buildClientProceduralBuilding('condo');
    const house = buildClientProceduralBuilding('house');
    const elapsed = performance.now() - t0;

    expect(elapsed).toBeLessThan(200);
    expect(condo.spec.floors).toBe(3);
    expect(condo.spec.balconies).toHaveLength(2);
    expect(Math.abs(condo.minY)).toBeLessThan(1e-3);
    expect(condo.cameras.length).toBeGreaterThanOrEqual(1);

    const condoNames: string[] = [];
    condo.group.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        condoNames.push(obj.name);
        const normAttr = (obj as THREE.Mesh).geometry.getAttribute('normal');
        expect(normAttr).toBeDefined();
      }
    });
    expect(condoNames.some((n) => n.includes('balcony_railing'))).toBe(true);
    expect(condoNames.some((n) => n.includes('balcony_soffit'))).toBe(true);
    expect(condoNames.some((n) => n.includes('front_door'))).toBe(true);

    const houseNames: string[] = [];
    house.group.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) houseNames.push(obj.name);
    });
    expect(houseNames.some((n) => n.includes('column'))).toBe(true);
    expect(houseNames.some((n) => n.includes('roof'))).toBe(true);
  });

  it('classifies both named glTF meshes and unnamed Google Photorealistic 3D Tile geometry accurately', () => {
    expect(
      classifyHitSurfaceMaterial(
        'balcony_railing_0',
        new THREE.Vector3(0, 4.2, 5.5),
        new THREE.Vector3(0, 0, 1)
      )
    ).toBe('balcony_railing');

    expect(
      classifyHitSurfaceMaterial(
        'tile_8821_primitive_0',
        new THREE.Vector3(2.0, 0.15, 6.0),
        new THREE.Vector3(0, 0.98, 0.1)
      )
    ).toBe('ground_turf');

    expect(
      classifyHitSurfaceMaterial(
        'tile_8821_primitive_0',
        new THREE.Vector3(0, 9.2, 0),
        new THREE.Vector3(0, 0.91, 0.41)
      )
    ).toBe('asphalt_shingle');

    expect(
      classifyHitSurfaceMaterial(
        'tile_8821_primitive_0',
        new THREE.Vector3(-1.5, 4.4, 5.2),
        new THREE.Vector3(0, -0.96, 0.1)
      )
    ).toBe('balcony_soffit');

    expect(
      classifyHitSurfaceMaterial(
        'tile_8821_primitive_0',
        new THREE.Vector3(1.0, 5.0, 4.8),
        new THREE.Vector3(0, 0.05, 0.99)
      )
    ).toBe('brick_masonry');
  });

  it('transitions useStudioStore cleanly across NONE, MAPS_3D_TILES, and MESH_RECON procedural fallback', () => {
    const s0 = useStudioStore.getState();
    expect(s0.sceneSource).toBe('NONE');
    expect(s0.activeDrawer).toBe('NONE');

    s0.setTilesScene('1007 N Shartel Ave, Oklahoma City, OK', {
      lat: 35.4785,
      lng: -97.5256,
      height: 368.4,
    });
    const sTiles = useStudioStore.getState();
    expect(sTiles.sceneSource).toBe('MAPS_3D_TILES');
    expect(sTiles.calibrationSource).toBe('MAPS_3D_TILES');
    expect(sTiles.feetPerSceneUnit).toBeCloseTo(3.28084, 4);
    expect(sTiles.tilesAnchor?.lat).toBeCloseTo(35.4785, 4);

    sTiles.setProceduralScene('condo');
    const sProc = useStudioStore.getState();
    expect(sProc.sceneSource).toBe('MESH_RECON');
    expect(sProc.proceduralPreset).toBe('condo');
    expect(sProc.calibrationSource).toBe('AUTO_DOOR');

    sProc.setActiveDrawer('BOM');
    expect(useStudioStore.getState().activeDrawer).toBe('BOM');

    useStudioStore.getState().resetToLauncher();
    expect(useStudioStore.getState().sceneSource).toBe('NONE');
    expect(useStudioStore.getState().activeDrawer).toBe('NONE');
  });
});
