import * as THREE from 'three';
import type {
  BoundingBox2D,
  CalibrationDetectionResult,
  CalibrationSource,
  CameraPose,
  Vec3,
} from '@lumen3d/shared-schemas';

export const STANDARD_FRONT_DOOR_FEET = 6.67;
export const STANDARD_GARAGE_DOOR_FEET = 7.0;
export const DEFAULT_FEET_PER_SCENE_UNIT = 3.28084;

const MIN_SANITY_FEET_PER_UNIT = 0.05;
const MAX_SANITY_FEET_PER_UNIT = 100.0;

/**
 * Unproject normalized 0..1000 `[normY, normX]` pixel coordinates into a Three.js world-space Ray
 * using `CameraPose` intrinsics `K` and 4x4 OpenCV `camera_to_world` extrinsics.
 */
export function unprojectNormalizedPixelToRay(
  normY: number,
  normX: number,
  camera: CameraPose
): THREE.Ray {
  const u = (normX / 1000.0) * camera.width;
  const v = (normY / 1000.0) * camera.height;

  const fx = camera.intrinsics[0][0];
  const fy = camera.intrinsics[1][1];
  const cx = camera.intrinsics[0][2];
  const cy = camera.intrinsics[1][2];

  // OpenCV camera space: +X right, +Y down, +Z forward
  const dirCam = new THREE.Vector3((u - cx) / fx, (v - cy) / fy, 1.0).normalize();

  const e = camera.extrinsics;
  const originWorld = new THREE.Vector3(e[0][3], e[1][3], e[2][3]);
  const dirWorld = new THREE.Vector3(
    e[0][0] * dirCam.x + e[0][1] * dirCam.y + e[0][2] * dirCam.z,
    e[1][0] * dirCam.x + e[1][1] * dirCam.y + e[1][2] * dirCam.z,
    e[2][0] * dirCam.x + e[2][1] * dirCam.y + e[2][2] * dirCam.z
  ).normalize();

  return new THREE.Ray(originWorld, dirWorld);
}

function measureBoxVerticalSpanOnMesh(
  box: BoundingBox2D,
  camera: CameraPose,
  targetObject: THREE.Object3D
): {
  distanceSceneUnits: number;
  topHit: Vec3;
  bottomHit: Vec3;
} | null {
  const [ymin, xmin, ymax, xmax] = box;
  const boxHeight = ymax - ymin;
  if (boxHeight <= 1) return null;

  const xCenter = 0.5 * (xmin + xmax);
  // Inset 1% from top/bottom edges so rays intersect cleanly inside the door leaf,
  // then analytically compensate by (1 - 2 * insetFraction).
  const insetFraction = 0.01;
  const yTopSample = ymin + boxHeight * insetFraction;
  const yBottomSample = ymax - boxHeight * insetFraction;

  targetObject.updateMatrixWorld(true);

  const raycasterTop = new THREE.Raycaster();
  const rayTop = unprojectNormalizedPixelToRay(yTopSample, xCenter, camera);
  raycasterTop.ray.copy(rayTop);

  const raycasterBot = new THREE.Raycaster();
  const rayBot = unprojectNormalizedPixelToRay(yBottomSample, xCenter, camera);
  raycasterBot.ray.copy(rayBot);

  const hitsTop = raycasterTop.intersectObject(targetObject, true);
  const hitsBot = raycasterBot.intersectObject(targetObject, true);

  if (hitsTop.length === 0 || hitsBot.length === 0) {
    return null;
  }

  const pTop = hitsTop[0].point;
  const pBot = hitsBot[0].point;
  const rawDist = pTop.distanceTo(pBot);
  const fullSpanDist = rawDist / (1.0 - 2.0 * insetFraction);

  if (!Number.isFinite(fullSpanDist) || fullSpanDist <= 0.05) {
    return null;
  }

  return {
    distanceSceneUnits: fullSpanDist,
    topHit: [pTop.x, pTop.y, pTop.z],
    bottomHit: [pBot.x, pBot.y, pBot.z],
  };
}

export interface SpatialCalibrationOutcome {
  feetPerSceneUnit: number;
  calibrationSource: CalibrationSource;
  measuredSceneDistance: number | null;
  referenceFeet: number | null;
  topHitPoint?: Vec3;
  bottomHitPoint?: Vec3;
}

export function calibrateScaleFromDetection(params: {
  detection: CalibrationDetectionResult;
  camera: CameraPose;
  targetObject: THREE.Object3D;
}): SpatialCalibrationOutcome {
  const { detection, camera, targetObject } = params;

  if (detection.front_door) {
    const measured = measureBoxVerticalSpanOnMesh(
      detection.front_door,
      camera,
      targetObject
    );
    if (measured) {
      const scale = STANDARD_FRONT_DOOR_FEET / measured.distanceSceneUnits;
      if (scale >= MIN_SANITY_FEET_PER_UNIT && scale <= MAX_SANITY_FEET_PER_UNIT) {
        return {
          feetPerSceneUnit: scale,
          calibrationSource: 'AUTO_DOOR',
          measuredSceneDistance: measured.distanceSceneUnits,
          referenceFeet: STANDARD_FRONT_DOOR_FEET,
          topHitPoint: measured.topHit,
          bottomHitPoint: measured.bottomHit,
        };
      }
    }
  }

  if (detection.garage_door) {
    const measured = measureBoxVerticalSpanOnMesh(
      detection.garage_door,
      camera,
      targetObject
    );
    if (measured) {
      const scale = STANDARD_GARAGE_DOOR_FEET / measured.distanceSceneUnits;
      if (scale >= MIN_SANITY_FEET_PER_UNIT && scale <= MAX_SANITY_FEET_PER_UNIT) {
        return {
          feetPerSceneUnit: scale,
          calibrationSource: 'AUTO_GARAGE',
          measuredSceneDistance: measured.distanceSceneUnits,
          referenceFeet: STANDARD_GARAGE_DOOR_FEET,
          topHitPoint: measured.topHit,
          bottomHitPoint: measured.bottomHit,
        };
      }
    }
  }

  return {
    feetPerSceneUnit: DEFAULT_FEET_PER_SCENE_UNIT,
    calibrationSource: 'DEFAULT',
    measuredSceneDistance: null,
    referenceFeet: null,
  };
}

export function computeManualRulerScale(
  pointA: Vec3,
  pointB: Vec3,
  realDistanceFeet: number
): number {
  if (!Number.isFinite(realDistanceFeet) || realDistanceFeet <= 0) {
    throw new Error('Real-world distance must be greater than 0 feet');
  }
  const dx = pointB[0] - pointA[0];
  const dy = pointB[1] - pointA[1];
  const dz = pointB[2] - pointA[2];
  const sceneDist = Math.hypot(dx, dy, dz);
  if (sceneDist < 1e-5) {
    throw new Error('Selected 3D points are identical; click two distinct points');
  }
  return realDistanceFeet / sceneDist;
}
