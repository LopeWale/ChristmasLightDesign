import type {
  BulbPreset,
  HelixParams,
  LightRun,
  Vec3,
} from '@lumen3d/shared-schemas';

export const SURFACE_NORMAL_OFFSET = 0.02;

const ICICLE_DROP_COUNTS = [4, 6, 3, 5] as const;
const ICICLE_VERTICAL_BULB_STEP_INCHES = 3.5;

export interface SurfaceTriangle {
  a: Vec3;
  b: Vec3;
  c: Vec3;
  normal?: Vec3;
}

export function offsetPointAlongNormal(
  point: Vec3,
  normal: Vec3,
  offset: number = SURFACE_NORMAL_OFFSET
): Vec3 {
  const len = Math.hypot(normal[0], normal[1], normal[2]);
  if (len < 1e-8) {
    return [point[0], point[1] + offset, point[2]];
  }
  const s = offset / len;
  return [
    point[0] + normal[0] * s,
    point[1] + normal[1] * s,
    point[2] + normal[2] * s,
  ];
}

function inchesToSceneUnits(spacingInches: number, feetPerSceneUnit: number): number {
  const safeFeetPerUnit = Math.max(1e-4, feetPerSceneUnit);
  const safeInches = Math.max(0.5, spacingInches);
  return safeInches / 12.0 / safeFeetPerUnit;
}

export function computePolylineArcLengthSceneUnits(points: Vec3[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(
      points[i][0] - points[i - 1][0],
      points[i][1] - points[i - 1][1],
      points[i][2] - points[i - 1][2]
    );
  }
  return total;
}

function sampleAlongPolyline(points: Vec3[], stepSceneUnits: number): Vec3[] {
  if (points.length === 0) return [];
  if (points.length === 1) return [[...points[0]]];

  const sampled: Vec3[] = [[...points[0]]];
  let distToNextSample = stepSceneUnits;

  for (let segIdx = 0; segIdx < points.length - 1; segIdx++) {
    const p0 = points[segIdx];
    const p1 = points[segIdx + 1];
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const dz = p1[2] - p0[2];
    const segLen = Math.hypot(dx, dy, dz);
    if (segLen < 1e-8) continue;

    let cursor = distToNextSample;
    while (cursor <= segLen + 1e-7) {
      const t = Math.min(1.0, cursor / segLen);
      sampled.push([p0[0] + dx * t, p0[1] + dy * t, p0[2] + dz * t]);
      cursor += stepSceneUnits;
    }
    distToNextSample = cursor - segLen;
  }

  return sampled;
}

/**
 * 1. Linear / Eave generator (`LINEAR_EAVE`):
 * Supports standard linear bulbs (`C9_LED`, `C7_LED`, `MINI_5MM_LED`, `RGB_SOFFIT_PUCK`)
 * and `ICICLE_DROP_LED` (generating vertical hanging sub-drops every 6" along the eave).
 */
export function generateLinearEaveBulbs(params: {
  controlPoints: Vec3[];
  spacingInches: number;
  feetPerSceneUnit: number;
  bulbPreset: BulbPreset;
}): Vec3[] {
  const { controlPoints, spacingInches, feetPerSceneUnit, bulbPreset } = params;
  if (controlPoints.length === 0) return [];

  if (bulbPreset === 'ICICLE_DROP_LED') {
    const dropIntervalInches = spacingInches > 0 ? spacingInches : 6.0;
    const horizontalStep = inchesToSceneUnits(dropIntervalInches, feetPerSceneUnit);
    const verticalStep = inchesToSceneUnits(
      ICICLE_VERTICAL_BULB_STEP_INCHES,
      feetPerSceneUnit
    );
    const anchors = sampleAlongPolyline(controlPoints, horizontalStep);
    const icicleBulbs: Vec3[] = [];

    anchors.forEach((anchor, dropIdx) => {
      const dropCount = ICICLE_DROP_COUNTS[dropIdx % ICICLE_DROP_COUNTS.length];
      for (let k = 0; k < dropCount; k++) {
        icicleBulbs.push([
          anchor[0],
          anchor[1] - k * verticalStep,
          anchor[2],
        ]);
      }
    });

    return icicleBulbs;
  }

  const stepSceneUnits = inchesToSceneUnits(spacingInches, feetPerSceneUnit);
  return sampleAlongPolyline(controlPoints, stepSceneUnits);
}

/**
 * 2. Helical Column / Trunk Wrap generator (`HELICAL_WRAP`):
 * Generates a 3D parametric helix `P(t)` around cylinder axis `topCenter - baseCenter`
 * offset outward by `normalOffset` (+0.02 scene units) at exact arc-length bulb spacing.
 */
export function computeHelixArcLengthSceneUnits(
  helixParams: HelixParams,
  normalOffset: number = SURFACE_NORMAL_OFFSET
): number {
  const { baseCenter, topCenter, radius, turns } = helixParams;
  const height = Math.hypot(
    topCenter[0] - baseCenter[0],
    topCenter[1] - baseCenter[1],
    topCenter[2] - baseCenter[2]
  );
  const effRadius = Math.max(0.01, radius + normalOffset);
  return Math.hypot(height, 2 * Math.PI * Math.max(0.25, turns) * effRadius);
}

export function generateHelicalWrapBulbs(params: {
  helixParams: HelixParams;
  spacingInches: number;
  feetPerSceneUnit: number;
  normalOffset?: number;
}): Vec3[] {
  const {
    helixParams,
    spacingInches,
    feetPerSceneUnit,
    normalOffset = SURFACE_NORMAL_OFFSET,
  } = params;
  const { baseCenter, topCenter, radius, turns } = helixParams;

  const ax = topCenter[0] - baseCenter[0];
  const ay = topCenter[1] - baseCenter[1];
  const az = topCenter[2] - baseCenter[2];
  const height = Math.hypot(ax, ay, az);
  if (height < 1e-6) {
    return [[...baseCenter]];
  }

  const ux = ax / height;
  const uy = ay / height;
  const uz = az / height;

  // Build orthonormal basis (e1, e2) perpendicular to axis u
  const ref: Vec3 = Math.abs(uy) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let e1x = uy * ref[2] - uz * ref[1];
  let e1y = uz * ref[0] - ux * ref[2];
  let e1z = ux * ref[1] - uy * ref[0];
  const e1Len = Math.hypot(e1x, e1y, e1z);
  e1x /= e1Len;
  e1y /= e1Len;
  e1z /= e1Len;

  const e2x = uy * e1z - uz * e1y;
  const e2y = uz * e1x - ux * e1z;
  const e2z = ux * e1y - uy * e1x;

  const effRadius = Math.max(0.01, radius + normalOffset);
  const effTurns = Math.max(0.25, turns);
  const totalArcScene = Math.hypot(height, 2 * Math.PI * effTurns * effRadius);
  const stepScene = inchesToSceneUnits(spacingInches, feetPerSceneUnit);

  const intervals = Math.max(1, Math.floor(totalArcScene / stepScene));
  const bulbs: Vec3[] = [];

  for (let i = 0; i <= intervals; i++) {
    const s = Math.min(totalArcScene, i * stepScene);
    const t = s / totalArcScene;
    const theta = 2 * Math.PI * effTurns * t;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);

    bulbs.push([
      baseCenter[0] + ax * t + effRadius * (cosT * e1x + sinT * e2x),
      baseCenter[1] + ay * t + effRadius * (cosT * e1y + sinT * e2y),
      baseCenter[2] + az * t + effRadius * (cosT * e1z + sinT * e2z),
    ]);
  }

  return bulbs;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function computeTriangleNormalAndArea(tri: SurfaceTriangle): {
  normal: Vec3;
  area: number;
} {
  const abx = tri.b[0] - tri.a[0];
  const aby = tri.b[1] - tri.a[1];
  const abz = tri.b[2] - tri.a[2];
  const acx = tri.c[0] - tri.a[0];
  const acy = tri.c[1] - tri.a[1];
  const acz = tri.c[2] - tri.a[2];
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  const crossLen = Math.hypot(nx, ny, nz);
  if (tri.normal) {
    return { normal: tri.normal, area: 0.5 * crossLen };
  }
  if (crossLen < 1e-8) {
    return { normal: [0, 1, 0], area: 0 };
  }
  return {
    normal: [nx / crossLen, ny / crossLen, nz / crossLen],
    area: 0.5 * crossLen,
  };
}

/**
 * 3. Surface Net / Foliage Scatter generator (`SURFACE_SCATTER`):
 * Poisson minimum-distance dart-throwing over painted shrub/tree triangles,
 * offsetting each point by +0.02 scene units along its triangle normal.
 */
export function generateSurfaceScatterBulbs(params: {
  strokeCenters: Vec3[];
  triangles?: SurfaceTriangle[];
  brushRadiusSceneUnits?: number;
  spacingInches: number;
  feetPerSceneUnit: number;
  seed?: number;
}): Vec3[] {
  const {
    strokeCenters,
    triangles = [],
    brushRadiusSceneUnits = 0.45,
    spacingInches,
    feetPerSceneUnit,
    seed = 20251225,
  } = params;

  if (strokeCenters.length === 0) return [];

  const minDist = inchesToSceneUnits(spacingInches, feetPerSceneUnit);
  const minDistSq = minDist * minDist;
  const brushSq = brushRadiusSceneUnits * brushRadiusSceneUnits;
  const rand = mulberry32(seed);
  const accepted: Vec3[] = [];

  const canAccept = (candidate: Vec3): boolean => {
    for (let i = 0; i < accepted.length; i++) {
      const dx = candidate[0] - accepted[i][0];
      const dy = candidate[1] - accepted[i][1];
      const dz = candidate[2] - accepted[i][2];
      if (dx * dx + dy * dy + dz * dz < minDistSq) {
        return false;
      }
    }
    return true;
  };

  if (triangles.length > 0) {
    // Filter triangles near stroke centers using triangle centroid or vertices
    const activeTris = triangles
      .map((tri) => {
        const meta = computeTriangleNormalAndArea(tri);
        const cx = (tri.a[0] + tri.b[0] + tri.c[0]) / 3;
        const cy = (tri.a[1] + tri.b[1] + tri.c[1]) / 3;
        const cz = (tri.a[2] + tri.b[2] + tri.c[2]) / 3;
        return { tri, ...meta, centroid: [cx, cy, cz] as Vec3 };
      })
      .filter((item) => item.area > 1e-6);

    const totalArea = activeTris.reduce((acc, t) => acc + t.area, 0);
    if (totalArea > 1e-6) {
      const targetAttempts = Math.min(
        4000,
        Math.max(300, Math.ceil((totalArea / minDistSq) * 28))
      );

      // Build cumulative area table for uniform surface sampling
      const cdf: number[] = [];
      let running = 0;
      for (const item of activeTris) {
        running += item.area / totalArea;
        cdf.push(running);
      }

      for (let attempt = 0; attempt < targetAttempts; attempt++) {
        const uPick = rand();
        let triIdx = cdf.findIndex((val) => uPick <= val);
        if (triIdx < 0) triIdx = activeTris.length - 1;
        const chosen = activeTris[triIdx];

        let r1 = rand();
        let r2 = rand();
        if (r1 + r2 > 1) {
          r1 = 1 - r1;
          r2 = 1 - r2;
        }
        const r0 = 1 - r1 - r2;
        const px =
          r0 * chosen.tri.a[0] + r1 * chosen.tri.b[0] + r2 * chosen.tri.c[0];
        const py =
          r0 * chosen.tri.a[1] + r1 * chosen.tri.b[1] + r2 * chosen.tri.c[1];
        const pz =
          r0 * chosen.tri.a[2] + r1 * chosen.tri.b[2] + r2 * chosen.tri.c[2];

        // Keep points within brush radius of at least one stroke center
        let insideBrush = false;
        for (let s = 0; s < strokeCenters.length; s++) {
          const dx = px - strokeCenters[s][0];
          const dy = py - strokeCenters[s][1];
          const dz = pz - strokeCenters[s][2];
          if (dx * dx + dy * dy + dz * dz <= brushSq) {
            insideBrush = true;
            break;
          }
        }
        if (!insideBrush) continue;

        const offsetPt = offsetPointAlongNormal([px, py, pz], chosen.normal);
        if (canAccept(offsetPt)) {
          accepted.push(offsetPt);
        }
      }
      return accepted;
    }
  }

  // Fallback when stroke centers are already normal-offset surface hits
  for (const center of strokeCenters) {
    if (canAccept(center)) {
      accepted.push([...center]);
    }
    for (let k = 0; k < 18; k++) {
      const r = brushRadiusSceneUnits * Math.sqrt(rand());
      const theta = 2 * Math.PI * rand();
      const phi = (rand() - 0.5) * 0.4;
      const cand: Vec3 = [
        center[0] + r * Math.cos(theta),
        center[1] + r * Math.sin(theta) * Math.cos(phi),
        center[2] + r * Math.sin(phi),
      ];
      if (canAccept(cand)) {
        accepted.push(cand);
      }
    }
  }

  return accepted;
}

export interface PathwayStakeSegment {
  base: Vec3;
  top: Vec3;
}

export function generatePathwayStakePosts(params: {
  controlPoints: Vec3[];
  spacingInches: number;
  feetPerSceneUnit: number;
  stakeHeightInches?: number;
}): PathwayStakeSegment[] {
  const {
    controlPoints,
    spacingInches,
    feetPerSceneUnit,
    stakeHeightInches = 10.0,
  } = params;
  if (controlPoints.length === 0) return [];

  const stepScene = inchesToSceneUnits(spacingInches, feetPerSceneUnit);
  const stakeHeightScene = inchesToSceneUnits(stakeHeightInches, feetPerSceneUnit);
  const bases = sampleAlongPolyline(controlPoints, stepScene);

  return bases.map((base) => ({
    base,
    top: [base[0], base[1] + stakeHeightScene, base[2]],
  }));
}

/**
 * 4. Pathway Stakes generator (`PATHWAY_STAKE`):
 * Ground-snapped polyline placing vertical stakes + glowing C9 bulbs at 24"–36" spacing.
 */
export function generatePathwayStakeBulbs(params: {
  controlPoints: Vec3[];
  spacingInches: number;
  feetPerSceneUnit: number;
  stakeHeightInches?: number;
}): Vec3[] {
  return generatePathwayStakePosts(params).map((seg) => seg.top);
}

/**
 * Unified helper to recompute `bulbPositions` for any `LightRun` when scale,
 * spacing, preset, or helix parameters change.
 */
export function recomputeRunBulbPositions(
  run: Omit<LightRun, 'bulbPositions'> & { bulbPositions?: Vec3[] },
  feetPerSceneUnit: number,
  scatterTriangles?: SurfaceTriangle[]
): Vec3[] {
  switch (run.toolMode) {
    case 'LINEAR_EAVE':
      return generateLinearEaveBulbs({
        controlPoints: run.controlPoints,
        spacingInches: run.spacingInches,
        feetPerSceneUnit,
        bulbPreset: run.bulbPreset,
      });
    case 'HELICAL_WRAP':
      if (run.helixParams) {
        return generateHelicalWrapBulbs({
          helixParams: run.helixParams,
          spacingInches: run.spacingInches,
          feetPerSceneUnit,
        });
      }
      return generateLinearEaveBulbs({
        controlPoints: run.controlPoints,
        spacingInches: run.spacingInches,
        feetPerSceneUnit,
        bulbPreset: run.bulbPreset,
      });
    case 'SURFACE_SCATTER':
      return generateSurfaceScatterBulbs({
        strokeCenters: run.controlPoints,
        triangles: scatterTriangles,
        spacingInches: run.spacingInches,
        feetPerSceneUnit,
      });
    case 'PATHWAY_STAKE':
      return generatePathwayStakeBulbs({
        controlPoints: run.controlPoints,
        spacingInches: run.spacingInches,
        feetPerSceneUnit,
      });
    default:
      return run.bulbPositions ? [...run.bulbPositions] : [];
  }
}
