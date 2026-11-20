import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import {
  CalibrationDetectionResultSchema,
  type CameraPose,
} from '@lumen3d/shared-schemas';
import {
  unprojectNormalizedPixelToRay,
  calibrateScaleFromDetection,
  computeManualRulerScale,
} from '../src/lib/geometry/raycastCalibration';
import { getGenAIClient } from '../src/lib/gemini/client';
import { POST as calibratePost } from '../src/app/api/calibrate/route';

function buildTestHouseSceneAndCamera(): {
  scene: THREE.Group;
  camera: CameraPose;
  groundTruthFeetPerUnit: number;
} {
  // Ground truth: 1 scene unit = 1.0 meter = 3.28084 feet
  const groundTruthFeetPerUnit = 3.28084;
  const doorHeightUnits = 6.67 / groundTruthFeetPerUnit; // 2.033016
  const garageHeightUnits = 7.0 / groundTruthFeetPerUnit; // 2.133600

  const group = new THREE.Group();

  // Front door box matching synthetic_backend.py: x in [-0.475, 0.475], y in [0.14, 2.173016], z in [3.00, 3.06]
  const doorGeom = new THREE.BoxGeometry(0.95, doorHeightUnits, 0.06);
  const doorMesh = new THREE.Mesh(doorGeom, new THREE.MeshBasicMaterial());
  doorMesh.name = 'front_door';
  doorMesh.position.set(0.0, 0.14 + doorHeightUnits / 2, 3.03);
  doorMesh.updateMatrixWorld(true);
  group.add(doorMesh);

  // Garage door box matching synthetic_backend.py: x in [5.00, 7.70], y in [0.02, 2.1536], z in [2.60, 2.66]
  const garageGeom = new THREE.BoxGeometry(2.7, garageHeightUnits, 0.06);
  const garageMesh = new THREE.Mesh(garageGeom, new THREE.MeshBasicMaterial());
  garageMesh.name = 'garage_door';
  garageMesh.position.set(6.35, 0.02 + garageHeightUnits / 2, 2.63);
  garageMesh.updateMatrixWorld(true);
  group.add(garageMesh);

  group.updateMatrixWorld(true);

  const camera: CameraPose = {
    id: 0,
    name: 'front',
    width: 1280,
    height: 720,
    intrinsics: [
      [960.0, 0.0, 640.0],
      [0.0, 960.0, 360.0],
      [0.0, 0.0, 1.0],
    ],
    extrinsics: [
      [1.0, 0.0, 0.0, 1.6],
      [0.0, -1.0, 0.0, 2.1],
      [0.0, 0.0, -1.0, 14.5],
      [0.0, 0.0, 0.0, 1.0],
    ],
  };

  return { scene: group, camera, groundTruthFeetPerUnit };
}

describe('Gate 2: Spatial Calibration & 3D Back-Projection', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('unprojects Camera 0 center pixel straight along optical axis', () => {
    const { camera } = buildTestHouseSceneAndCamera();
    const ray = unprojectNormalizedPixelToRay(500, 500, camera);
    expect(ray.origin.x).toBeCloseTo(1.6, 5);
    expect(ray.origin.y).toBeCloseTo(2.1, 5);
    expect(ray.origin.z).toBeCloseTo(14.5, 5);
    expect(ray.direction.x).toBeCloseTo(0.0, 5);
    expect(ray.direction.y).toBeCloseTo(0.0, 5);
    expect(ray.direction.z).toBeCloseTo(-1.0, 5);
  });

  it('computes feetPerSceneUnit within ±2% of ground truth via front_door raycast', () => {
    const { scene, camera, groundTruthFeetPerUnit } = buildTestHouseSceneAndCamera();
    const result = calibrateScaleFromDetection({
      detection: {
        front_door: [491.5, 364.0, 728.4, 426.2],
        garage_door: [494.0, 715.4, 734.2, 886.4],
        zones: [],
      },
      camera,
      targetObject: scene,
    });

    expect(result.calibrationSource).toBe('AUTO_DOOR');
    const relativeError =
      Math.abs(result.feetPerSceneUnit - groundTruthFeetPerUnit) / groundTruthFeetPerUnit;
    expect(relativeError).toBeLessThan(0.02);
  });

  it('falls back cleanly to garage_door (7.0 ft) within ±2% when front_door is absent', () => {
    const { scene, camera, groundTruthFeetPerUnit } = buildTestHouseSceneAndCamera();
    const result = calibrateScaleFromDetection({
      detection: {
        front_door: null,
        garage_door: [494.0, 715.4, 734.2, 886.4],
        zones: [],
      },
      camera,
      targetObject: scene,
    });

    expect(result.calibrationSource).toBe('AUTO_GARAGE');
    const relativeError =
      Math.abs(result.feetPerSceneUnit - groundTruthFeetPerUnit) / groundTruthFeetPerUnit;
    expect(relativeError).toBeLessThan(0.02);
  });

  it('computes manual 2-click distance ruler scale accurately', () => {
    const scale = computeManualRulerScale([0, 0, 3], [0, 2.5, 3], 10);
    expect(scale).toBeCloseTo(4.0, 5);
  });

  it('validates POST /api/calibrate schema response and end-to-end scale accuracy in mock mode', async () => {
    process.env.GEMINI_MOCK_MODE = 'true';
    const tinyPngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const req = new Request('http://localhost:3000/api/calibrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: tinyPngBase64 }),
    });

    const resp = await calibratePost(req);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    const parsed = CalibrationDetectionResultSchema.parse(body);
    expect(parsed.front_door).not.toBeNull();
    expect(parsed.zones.length).toBeGreaterThan(0);

    const { scene, camera, groundTruthFeetPerUnit } = buildTestHouseSceneAndCamera();
    const cal = calibrateScaleFromDetection({
      detection: parsed,
      camera,
      targetObject: scene,
    });
    const relErr =
      Math.abs(cal.feetPerSceneUnit - groundTruthFeetPerUnit) / groundTruthFeetPerUnit;
    expect(relErr).toBeLessThan(0.02);
  });

  it('enforces server-side GEMINI_API_KEY check in getGenAIClient', () => {
    delete process.env.GEMINI_API_KEY;
    expect(() => getGenAIClient()).toThrow(/GEMINI_API_KEY/);
  });

  it('blocks arbitrary external SSRF referenceImageUrl in POST /api/calibrate', async () => {
    process.env.GEMINI_MOCK_MODE = 'false';
    process.env.GEMINI_API_KEY = 'dummy-key-never-called';

    const req = new Request('http://localhost:3000/api/calibrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        referenceImageUrl: 'http://169.254.169.254/latest/meta-data/',
      }),
    });

    const resp = await calibratePost(req);
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toMatch(/Invalid or disallowed referenceImageUrl/i);
  });
});
