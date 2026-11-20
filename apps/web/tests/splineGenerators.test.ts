import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@lumen3d/shared-schemas';
import {
  SURFACE_NORMAL_OFFSET,
  offsetPointAlongNormal,
  generateLinearEaveBulbs,
  generateHelicalWrapBulbs,
  generateSurfaceScatterBulbs,
  generatePathwayStakeBulbs,
} from '../src/lib/geometry/splineGenerators';
import { useStudioStore } from '../src/store/useStudioStore';

describe('Gate 3: Parametric Multi-Orientation Spline Generators', () => {
  const feetPerSceneUnit = 3.28084; // 1 scene unit = 1 meter

  it('offsets surface hit points by +0.02 scene units along hit normal', () => {
    const hit: Vec3 = [1.5, 3.5, 3.0];
    const normal: Vec3 = [0, 0, 2]; // non-unit +Z normal
    const offset = offsetPointAlongNormal(hit, normal);
    expect(SURFACE_NORMAL_OFFSET).toBe(0.02);
    expect(offset[0]).toBeCloseTo(1.5, 6);
    expect(offset[1]).toBeCloseTo(3.5, 6);
    expect(offset[2]).toBeCloseTo(3.02, 6);
  });

  it('generates exact bulb spacing along multi-segment LINEAR_EAVE polylines', () => {
    // Use feetPerSceneUnit = 1.0 for clean exact arithmetic:
    // L-shaped eave of 6 ft along X + 4 ft along Z = 10 ft total at 12" (1 ft) spacing -> 11 bulbs
    const bulbs = generateLinearEaveBulbs({
      controlPoints: [
        [0, 10, 0],
        [6, 10, 0],
        [6, 10, 4],
      ],
      spacingInches: 12,
      feetPerSceneUnit: 1.0,
      bulbPreset: 'C9_LED',
    });

    expect(bulbs).toHaveLength(11);
    expect(bulbs[0]).toEqual([0, 10, 0]);
    expect(bulbs[6][0]).toBeCloseTo(6, 5);
    expect(bulbs[6][2]).toBeCloseTo(0, 5);
    expect(bulbs[10][0]).toBeCloseTo(6, 5);
    expect(bulbs[10][2]).toBeCloseTo(4, 5);

    // Consecutive straight-segment bulbs have exact 1.0 ft spacing
    const d01 = Math.hypot(
      bulbs[1][0] - bulbs[0][0],
      bulbs[1][1] - bulbs[0][1],
      bulbs[1][2] - bulbs[0][2]
    );
    expect(d01).toBeCloseTo(1.0, 5);
  });

  it('generates vertical hanging sub-drops every 6 inches for ICICLE_DROP_LED', () => {
    // 2 feet along X at 6" drop spacing -> 5 vertical drops (x = 0, 0.5, 1.0, 1.5, 2.0)
    // Repeating drop pattern [4, 6, 3, 5, 4] -> 22 total bulbs, extending strictly downward (-Y)
    const bulbs = generateLinearEaveBulbs({
      controlPoints: [
        [0, 12, 3],
        [2, 12, 3],
      ],
      spacingInches: 6,
      feetPerSceneUnit: 1.0,
      bulbPreset: 'ICICLE_DROP_LED',
    });

    expect(bulbs.length).toBe(22);
    const belowEave = bulbs.filter((b) => b[1] < 12.0 - 0.1);
    expect(belowEave.length).toBeGreaterThan(15);

    // Distinct X anchor columns at 0, 0.5, 1.0, 1.5, 2.0
    const uniqueX = new Set(bulbs.map((b) => b[0].toFixed(2)));
    expect(uniqueX.size).toBe(5);
  });

  it('generates parametric 3D HELICAL_WRAP with exact arc-length bulb count and radial offset', () => {
    const baseCenter: Vec3 = [-1.85, 0.14, 3.68];
    const topCenter: Vec3 = [-1.85, 3.05, 3.68];
    const radius = 0.14;
    const turns = 6;
    const spacingInches = 4;

    const bulbs = generateHelicalWrapBulbs({
      helixParams: { baseCenter, topCenter, radius, turns },
      spacingInches,
      feetPerSceneUnit,
    });

    const effR = radius + SURFACE_NORMAL_OFFSET; // 0.16 m
    const height = 3.05 - 0.14; // 2.91 m
    const totalArcScene = Math.hypot(height, 2 * Math.PI * turns * effR);
    const stepScene = spacingInches / 12 / feetPerSceneUnit;
    const expectedCount = Math.floor(totalArcScene / stepScene) + 1;

    expect(bulbs).toHaveLength(expectedCount);

    // Every bulb lies at exact effective radius (0.16m) from column axis (-1.85, y, 3.68)
    for (const b of bulbs) {
      const radialDist = Math.hypot(b[0] - baseCenter[0], b[2] - baseCenter[2]);
      expect(radialDist).toBeCloseTo(effR, 5);
      expect(b[1]).toBeGreaterThanOrEqual(baseCenter[1] - 1e-6);
      expect(b[1]).toBeLessThanOrEqual(topCenter[1] + 1e-6);
    }
  });

  it('samples SURFACE_SCATTER across mesh triangles respecting minimum Poisson spacing and +0.02 normal offset', () => {
    // 2m x 2m shrub face patch on z = 4.0 with +Z normal -> offset points should sit at z = 4.02
    const triangles = [
      {
        a: [-1, 0, 4] as Vec3,
        b: [1, 0, 4] as Vec3,
        c: [1, 2, 4] as Vec3,
        normal: [0, 0, 1] as Vec3,
      },
      {
        a: [-1, 0, 4] as Vec3,
        b: [1, 2, 4] as Vec3,
        c: [-1, 2, 4] as Vec3,
        normal: [0, 0, 1] as Vec3,
      },
    ];

    const spacingInches = 6; // 0.5 ft = ~0.1524 m
    const minDistScene = spacingInches / 12 / feetPerSceneUnit;

    const bulbs = generateSurfaceScatterBulbs({
      strokeCenters: [[0, 1, 4]],
      triangles,
      brushRadiusSceneUnits: 0.85,
      spacingInches,
      feetPerSceneUnit,
      seed: 12345,
    });

    expect(bulbs.length).toBeGreaterThan(15);

    for (let i = 0; i < bulbs.length; i++) {
      expect(bulbs[i][2]).toBeCloseTo(4.02, 5);
      for (let j = i + 1; j < bulbs.length; j++) {
        const dist = Math.hypot(
          bulbs[i][0] - bulbs[j][0],
          bulbs[i][1] - bulbs[j][1],
          bulbs[i][2] - bulbs[j][2]
        );
        expect(dist).toBeGreaterThanOrEqual(minDistScene * 0.99);
      }
    }
  });

  it('generates ground-snapped PATHWAY_STAKE bulbs at 24"-36" spacing elevated on stakes', () => {
    // 12 ft walkway at 24" (2 ft) spacing -> 7 stakes (0, 2, 4, 6, 8, 10, 12 ft)
    const bulbs = generatePathwayStakeBulbs({
      controlPoints: [
        [-2.5, 0.02, 4],
        [-2.5, 0.02, 16],
      ],
      spacingInches: 24,
      feetPerSceneUnit: 1.0,
      stakeHeightInches: 10,
    });

    expect(bulbs).toHaveLength(7);
    const expectedBulbY = 0.02 + 10 / 12;
    for (let i = 0; i < bulbs.length; i++) {
      expect(bulbs[i][1]).toBeCloseTo(expectedBulbY, 5);
      expect(bulbs[i][2]).toBeCloseTo(4 + i * 2, 5);
    }
  });

  it('supports undo/redo, reactive calibration rescaling, and JSON save/load in useStudioStore', () => {
    const store = useStudioStore.getState();
    store.clearRuns();
    store.setCalibration(1.0, 'MANUAL_RULER');

    const added = store.addRunDirect({
      name: 'Test Eave',
      toolMode: 'LINEAR_EAVE',
      bulbPreset: 'C9_LED',
      spacingInches: 12,
      colorsHex: ['#ffd996'],
      pattern: 'SOLID',
      controlPoints: [
        [0, 10, 3],
        [10, 10, 3],
      ],
      surfaceMaterial: 'metal_gutter',
    });
    expect(added.bulbPositions).toHaveLength(11);

    // Doubling feetPerSceneUnit doubles real-world length -> 21 bulbs at 12" spacing
    useStudioStore.getState().setCalibration(2.0, 'MANUAL_RULER');
    expect(useStudioStore.getState().runs[0].bulbPositions).toHaveLength(21);

    // Undo removes the added run; Redo restores it
    useStudioStore.getState().undo();
    expect(useStudioStore.getState().runs).toHaveLength(0);
    useStudioStore.getState().redo();
    expect(useStudioStore.getState().runs).toHaveLength(1);

    // Export and re-import project JSON
    const json = useStudioStore.getState().exportProjectJson();
    useStudioStore.getState().clearRuns();
    expect(useStudioStore.getState().runs).toHaveLength(0);
    useStudioStore.getState().importProjectJson(json);
    expect(useStudioStore.getState().runs).toHaveLength(1);
  });
});
