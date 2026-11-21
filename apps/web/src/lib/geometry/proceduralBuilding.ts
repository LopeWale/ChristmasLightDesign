import * as THREE from 'three';
import type {
  ArchitecturalBuildingSpec,
  CameraPose,
  SurfaceMaterial,
} from '@lumen3d/shared-schemas';

export function inferSurfaceMaterialFromName(rawName: string): SurfaceMaterial {
  const n = rawName.toLowerCase();
  if (
    n.includes('balcony_railing') ||
    n.includes('railing') ||
    n.includes('guardrail')
  ) {
    return 'balcony_railing';
  }
  if (n.includes('balcony_soffit') || n.includes('soffit')) {
    return 'balcony_soffit';
  }
  if (n.includes('balcony_slab')) return 'stucco';
  if (n.includes('roof') || n.includes('shingle')) return 'asphalt_shingle';
  if (n.includes('eave') || n.includes('gutter')) return 'metal_gutter';
  if (n.includes('door') && !n.includes('garage')) return 'wood_fascia';
  if (n.includes('window') || n.includes('fascia')) return 'wood_fascia';
  if (n.includes('garage')) return 'vinyl_siding';
  if (n.includes('column') || n.includes('pillar') || n.includes('post')) {
    return 'column_post';
  }
  if (
    n.includes('shrub') ||
    n.includes('bush') ||
    n.includes('tree') ||
    n.includes('foliage')
  ) {
    return 'foliage_shrub';
  }
  if (n.includes('ground') || n.includes('turf') || n.includes('walkway')) {
    return 'ground_turf';
  }
  if (n.includes('stucco')) return 'stucco';
  if (n.includes('wall') || n.includes('brick')) return 'brick_masonry';
  return 'unknown';
}

export function classifyHitSurfaceMaterial(
  objectName: string,
  localPoint: THREE.Vector3,
  worldNormal: THREE.Vector3
): SurfaceMaterial {
  const byName = inferSurfaceMaterialFromName(objectName);
  if (byName !== 'unknown') return byName;

  if (worldNormal.y < -0.55 && localPoint.y > 1.8) {
    return 'balcony_soffit';
  }
  if (worldNormal.y >= 0.65 && localPoint.y < 0.85) {
    return 'ground_turf';
  }
  if (worldNormal.y >= 0.45 && localPoint.y >= 0.85) {
    return 'asphalt_shingle';
  }
  return 'brick_masonry';
}

export function computeTilesGroundLevelOffset(
  tilesGroup: THREE.Object3D
): number | null {
  const raycaster = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const sampleXZ: Array<[number, number]> = [
    [0, 0],
    [-14, -14],
    [14, -14],
    [-14, 14],
    [14, 14],
    [0, 18],
    [0, -18],
  ];
  const hitYs: number[] = [];

  for (const [sx, sz] of sampleXZ) {
    raycaster.set(new THREE.Vector3(sx, 1200, sz), down);
    const hits = raycaster.intersectObject(tilesGroup, true);
    if (hits.length > 0 && Number.isFinite(hits[0].point.y)) {
      hitYs.push(hits[0].point.y);
    }
  }

  if (hitYs.length === 0) return null;
  const groundY = Math.min(...hitYs);
  return -groundY;
}

export const CLIENT_CONDO_SPEC: ArchitecturalBuildingSpec = {
  archetype: 'multi_story_condo',
  floors: 3,
  metersPerFloor: 3.1,
  footprintPolygonMeters: [
    [-6.2, -4.8],
    [6.2, -4.8],
    [6.2, 4.8],
    [-6.2, 4.8],
  ],
  roofStyle: 'flat_parapet',
  roofPitchDegrees: 2.0,
  wallColorRgb: [168, 108, 88],
  trimColorRgb: [236, 238, 242],
  roofColorRgb: [54, 58, 66],
  windowBaysPerFloor: 4,
  hasGarage: false,
  balconies: [
    {
      id: 'balcony-2f-left',
      floor: 2,
      wallFace: 'front',
      centerOffsetNorm: -0.22,
      widthMeters: 3.6,
      depthMeters: 1.5,
      mountStyle: 'cantilevered',
      railingType: 'metal_picket',
    },
    {
      id: 'balcony-3f-right',
      floor: 3,
      wallFace: 'front',
      centerOffsetNorm: 0.22,
      widthMeters: 3.6,
      depthMeters: 1.5,
      mountStyle: 'cantilevered',
      railingType: 'metal_picket',
    },
  ],
  sourceSummary: '3-Story Brick Condo with 2 Walk-Out Balconies (Instant 3D)',
};

export const CLIENT_HOUSE_SPEC: ArchitecturalBuildingSpec = {
  archetype: 'single_family_gable',
  floors: 1,
  metersPerFloor: 3.4,
  footprintPolygonMeters: [
    [-6.4, -4.4],
    [6.4, -4.4],
    [6.4, 4.4],
    [-6.4, 4.4],
  ],
  roofStyle: 'pitched_gable',
  roofPitchDegrees: 24,
  wallColorRgb: [198, 192, 182],
  trimColorRgb: [242, 244, 246],
  roofColorRgb: [58, 64, 74],
  windowBaysPerFloor: 3,
  hasGarage: true,
  balconies: [],
  sourceSummary: 'Suburban Gable Residence with Front Porch & Shrubs (Instant 3D)',
};

function makeBoxMesh(
  name: string,
  min: [number, number, number],
  max: [number, number, number],
  colorHex: THREE.ColorRepresentation,
  roughness = 0.78,
  metalness = 0.08
): THREE.Mesh {
  const sx = Math.max(0.02, max[0] - min[0]);
  const sy = Math.max(0.02, max[1] - min[1]);
  const sz = Math.max(0.02, max[2] - min[2]);
  const geom = new THREE.BoxGeometry(sx, sy, sz);
  geom.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(colorHex),
    roughness,
    metalness,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = name;
  mesh.position.set(
    0.5 * (min[0] + max[0]),
    0.5 * (min[1] + max[1]),
    0.5 * (min[2] + max[2])
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildFrontCamera(heightMeters: number): CameraPose {
  const width = 1280;
  const height = 720;
  const fx = 980;
  const fy = 980;
  const targetY = heightMeters * 0.48;
  const eye = new THREE.Vector3(0, Math.max(3.6, heightMeters * 0.52), Math.max(18.5, heightMeters * 2.15));
  const target = new THREE.Vector3(0, targetY, 0);
  const forward = target.clone().sub(eye).normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const down = new THREE.Vector3().crossVectors(forward, right).normalize();

  return {
    id: 0,
    name: 'front_reference',
    width,
    height,
    intrinsics: [
      [fx, 0, width / 2],
      [0, fy, height / 2],
      [0, 0, 1],
    ],
    extrinsics: [
      [right.x, down.x, forward.x, eye.x],
      [right.y, down.y, forward.y, eye.y],
      [right.z, down.z, forward.z, eye.z],
      [0, 0, 0, 1],
    ],
  };
}

export function buildClientProceduralBuilding(
  presetOrSpec: 'condo' | 'house' | ArchitecturalBuildingSpec
): {
  group: THREE.Group;
  cameras: CameraPose[];
  minY: number;
  spec: ArchitecturalBuildingSpec;
} {
  const spec =
    typeof presetOrSpec === 'string'
      ? presetOrSpec === 'condo'
        ? CLIENT_CONDO_SPEC
        : CLIENT_HOUSE_SPEC
      : presetOrSpec;

  const group = new THREE.Group();
  group.name = 'procedural_building_root';

  const xs = spec.footprintPolygonMeters.map((p) => p[0]);
  const zs = spec.footprintPolygonMeters.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const widthM = Math.max(8.0, maxX - minX);
  const bldgH = spec.floors * spec.metersPerFloor;

  const wallColor = new THREE.Color(
    spec.wallColorRgb[0] / 255,
    spec.wallColorRgb[1] / 255,
    spec.wallColorRgb[2] / 255
  );
  const trimColor = new THREE.Color(
    spec.trimColorRgb[0] / 255,
    spec.trimColorRgb[1] / 255,
    spec.trimColorRgb[2] / 255
  );
  const roofColor = new THREE.Color(
    spec.roofColorRgb[0] / 255,
    spec.roofColorRgb[1] / 255,
    spec.roofColorRgb[2] / 255
  );

  // 1. Ground turf pad (exact minY = 0.0) & stone walkway
  group.add(
    makeBoxMesh('ground_turf', [minX - 4.5, 0.0, minZ - 3.5], [maxX + 4.5, 0.02, maxZ + 5.5], '#243c2c', 0.95, 0.0)
  );
  group.add(
    makeBoxMesh('front_walkway', [-1.1, 0.02, maxZ], [1.1, 0.07, maxZ + 4.6], '#8b939e', 0.88, 0.04)
  );

  // 2. Main 360-degree building body + stone belt-courses
  group.add(
    makeBoxMesh('main_walls', [minX, 0.02, minZ], [maxX, bldgH, maxZ], wallColor, 0.82, 0.05)
  );
  for (let fl = 1; fl < spec.floors; fl++) {
    const yB = fl * spec.metersPerFloor;
    group.add(
      makeBoxMesh(
        `stone_belt_${fl}`,
        [minX - 0.06, yB - 0.06, minZ - 0.06],
        [maxX + 0.06, yB + 0.06, maxZ + 0.06],
        trimColor,
        0.7,
        0.05
      )
    );
  }

  // 3. Roof & eaves/parapet
  if (spec.roofStyle === 'flat_parapet') {
    group.add(
      makeBoxMesh(
        'pitched_gable_roof',
        [minX - 0.08, bldgH, minZ - 0.08],
        [maxX + 0.08, bldgH + 0.42, maxZ + 0.08],
        roofColor,
        0.85,
        0.1
      )
    );
    group.add(
      makeBoxMesh(
        'eaves_gutters',
        [minX - 0.16, bldgH + 0.42, minZ - 0.16],
        [maxX + 0.16, bldgH + 0.54, maxZ + 0.16],
        trimColor,
        0.65,
        0.12
      )
    );
  } else {
    // Pitched gable prism
    const rise = 2.1;
    const roofShape = new THREE.Shape();
    roofShape.moveTo(minZ - 0.35, 0);
    roofShape.lineTo(maxZ + 0.35, 0);
    roofShape.lineTo(0.5 * (minZ + maxZ), rise);
    roofShape.closePath();
    const extrudeGeom = new THREE.ExtrudeGeometry(roofShape, {
      depth: widthM + 0.7,
      bevelEnabled: false,
    });
    extrudeGeom.rotateY(Math.PI / 2);
    extrudeGeom.translate(minX - 0.35, bldgH - 0.02, 0);
    extrudeGeom.computeVertexNormals();
    const roofMesh = new THREE.Mesh(
      extrudeGeom,
      new THREE.MeshStandardMaterial({ color: roofColor, roughness: 0.85, metalness: 0.08 })
    );
    roofMesh.name = 'pitched_gable_roof';
    roofMesh.castShadow = true;
    roofMesh.receiveShadow = true;
    group.add(roofMesh);

    group.add(
      makeBoxMesh(
        'eaves_gutters_front',
        [minX - 0.36, bldgH - 0.14, maxZ + 0.26],
        [maxX + 0.36, bldgH - 0.01, maxZ + 0.38],
        trimColor,
        0.5,
        0.25
      )
    );
    group.add(
      makeBoxMesh(
        'porch_column_left',
        [-1.95, 0.02, maxZ + 1.05],
        [-1.72, bldgH - 0.15, maxZ + 1.28],
        trimColor,
        0.65,
        0.05
      )
    );
    group.add(
      makeBoxMesh(
        'porch_column_right',
        [1.72, 0.02, maxZ + 1.05],
        [1.95, bldgH - 0.15, maxZ + 1.28],
        trimColor,
        0.65,
        0.05
      )
    );
    group.add(
      makeBoxMesh(
        'porch_canopy_eave',
        [-2.15, bldgH - 0.22, maxZ],
        [2.15, bldgH - 0.05, maxZ + 1.4],
        trimColor,
        0.7,
        0.08
      )
    );
    group.add(
      makeBoxMesh(
        'front_shrub_left',
        [-4.6, 0.02, maxZ + 0.35],
        [-2.6, 0.95, maxZ + 1.35],
        '#2b5634',
        0.92,
        0.0
      )
    );
  }

  // 4. Primary 6.67 ft (2.033m) front door
  group.add(
    makeBoxMesh('front_door', [-0.48, 0.12, maxZ - 0.02], [0.48, 2.153, maxZ + 0.08], '#6e2429', 0.6, 0.1)
  );
  if (spec.hasGarage) {
    group.add(
      makeBoxMesh('garage_door', [2.4, 0.02, maxZ - 0.02], [5.1, 2.16, maxZ + 0.07], '#dcd8ce', 0.72, 0.08)
    );
  }

  // 5. Architectural windows on front & rear
  const bays = Math.max(2, spec.windowBaysPerFloor);
  for (let fl = 1; fl <= spec.floors; fl++) {
    const y0 = (fl - 1) * spec.metersPerFloor;
    for (let b = 0; b < bays; b++) {
      const t = bays === 1 ? 0 : b / (bays - 1) - 0.5;
      const cx = t * widthM * 0.72;
      if (fl === 1 && Math.abs(cx) < 1.2) continue;
      if (fl === 1 && spec.hasGarage && cx > 1.8) continue;
      group.add(
        makeBoxMesh(
          `window_f${fl}_${b}`,
          [cx - 0.52, y0 + 0.95, maxZ - 0.01],
          [cx + 0.52, y0 + 2.25, maxZ + 0.05],
          '#2b405c',
          0.25,
          0.35
        )
      );
      group.add(
        makeBoxMesh(
          `window_rear_f${fl}_${b}`,
          [cx - 0.52, y0 + 0.95, minZ - 0.05],
          [cx + 0.52, y0 + 2.25, minZ + 0.01],
          '#2b405c',
          0.25,
          0.35
        )
      );
    }
  }

  // 6. Walk-out Balconies (slab, ceiling soffits, 42-inch 3D railings across all 4 wall faces)
  const depthM = Math.max(6.0, maxZ - minZ);
  spec.balconies.forEach((bal, idx) => {
    if (bal.floor > spec.floors) return;
    const yDeck = (bal.floor - 1) * spec.metersPerFloor;
    const yCeil = bal.floor * spec.metersPerFloor;
    const hw = 0.5 * bal.widthMeters;
    const depth =
      bal.mountStyle === 'cantilevered' ? bal.depthMeters : bal.depthMeters * 0.65;
    const railH = 1.07;
    const railColor = bal.railingType === 'glass_panel' ? '#88b8d8' : '#2a303c';

    if (bal.wallFace === 'left' || bal.wallFace === 'right') {
      const cz = bal.centerOffsetNorm * depthM;
      const x0 = bal.wallFace === 'left' ? minX - depth : maxX - 0.04;
      const x1 = bal.wallFace === 'left' ? minX + 0.04 : maxX + depth;
      const outerX0 = bal.wallFace === 'left' ? minX - depth : maxX + depth - 0.07;
      const outerX1 = bal.wallFace === 'left' ? minX - depth + 0.07 : maxX + depth;

      group.add(
        makeBoxMesh(
          `balcony_slab_${idx}`,
          [x0, yDeck - 0.08, cz - hw],
          [x1, yDeck + 0.1, cz + hw],
          trimColor,
          0.76,
          0.06
        )
      );
      group.add(
        makeBoxMesh(
          `balcony_soffit_${idx}`,
          [x0, yCeil - 0.14, cz - hw],
          [x1, yCeil - 0.02, cz + hw],
          trimColor,
          0.8,
          0.04
        )
      );
      group.add(
        makeBoxMesh(
          `balcony_railing_${idx}_outer`,
          [outerX0, yDeck + 0.1, cz - hw],
          [outerX1, yDeck + 0.1 + railH, cz + hw],
          railColor,
          0.4,
          0.55
        )
      );
      return;
    }

    const cx = bal.centerOffsetNorm * widthM;
    const isRear = bal.wallFace === 'rear';
    const z0 = isRear ? minZ - depth : maxZ - 0.04;
    const z1 = isRear ? minZ + 0.04 : maxZ + depth;
    const outerZ0 = isRear ? minZ - depth : maxZ + depth - 0.07;
    const outerZ1 = isRear ? minZ - depth + 0.07 : maxZ + depth;

    group.add(
      makeBoxMesh(
        `balcony_slab_${idx}`,
        [cx - hw, yDeck - 0.08, z0],
        [cx + hw, yDeck + 0.1, z1],
        trimColor,
        0.76,
        0.06
      )
    );
    group.add(
      makeBoxMesh(
        `balcony_soffit_${idx}`,
        [cx - hw, yCeil - 0.14, z0],
        [cx + hw, yCeil - 0.02, z1],
        trimColor,
        0.8,
        0.04
      )
    );
    group.add(
      makeBoxMesh(
        `balcony_railing_${idx}_front`,
        [cx - hw, yDeck + 0.1, outerZ0],
        [cx + hw, yDeck + 0.1 + railH, outerZ1],
        railColor,
        0.4,
        0.55
      )
    );
    group.add(
      makeBoxMesh(
        `balcony_railing_${idx}_left`,
        [cx - hw, yDeck + 0.1, z0],
        [cx - hw + 0.07, yDeck + 0.1 + railH, z1],
        railColor,
        0.4,
        0.55
      )
    );
    group.add(
      makeBoxMesh(
        `balcony_railing_${idx}_right`,
        [cx + hw - 0.07, yDeck + 0.1, z0],
        [cx + hw, yDeck + 0.1 + railH, z1],
        railColor,
        0.4,
        0.55
      )
    );
  });

  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  const minY = Number.isFinite(box.min.y) ? box.min.y : 0;

  return {
    group,
    cameras: [buildFrontCamera(bldgH)],
    minY,
    spec,
  };
}
