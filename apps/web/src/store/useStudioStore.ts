'use client';

import { create } from 'zustand';
import {
  BULB_PRESET_SPECS,
  ProjectExportSchema,
  type BulbPreset,
  type CalibrationSource,
  type CameraPose,
  type ConceptPreset,
  type DetectedZone,
  type LightPattern,
  type LightRun,
  type ReconstructionJob,
  type SceneSourceMode,
  type SurfaceMaterial,
  type ToolMode,
  type Vec3,
} from '@lumen3d/shared-schemas';
import { DEFAULT_FEET_PER_SCENE_UNIT } from '@/lib/geometry/raycastCalibration';
import {
  recomputeRunBulbPositions,
  type SurfaceTriangle,
} from '@/lib/geometry/splineGenerators';

export type LightingMode = 'DAY' | 'DUSK' | 'NIGHT';
export type ActiveDrawer = 'NONE' | 'COPILOT' | 'BOM';

export interface TilesAnchor {
  lat: number;
  lng: number;
  height: number;
}

const MAX_HISTORY = 40;

export interface StudioState {
  // Reconstruction & Scene state
  sceneSource: SceneSourceMode;
  sceneTitle: string;
  tilesAnchor: TilesAnchor | null;
  proceduralPreset: 'condo' | 'house' | null;
  activeDrawer: ActiveDrawer;
  job: ReconstructionJob | null;
  cameras: CameraPose[];
  detectedZones: DetectedZone[];
  groundMinY: number;
  isReconstructing: boolean;
  reconError: string | null;
  mapsAttribution: string | null;
  mapsWarnings: string[];

  // Calibration state
  feetPerSceneUnit: number;
  calibrationSource: CalibrationSource;
  rulerPoints: Vec3[];
  isCalibrating: boolean;
  calibrationError: string | null;

  // Viewport & Active Tool state
  lightingMode: LightingMode;
  toolMode: ToolMode;
  activeBulbPreset: BulbPreset;
  activeSpacingInches: number;
  activeColorsHex: string[];
  activePattern: LightPattern;
  activeHelixTurns: number;
  activeHelixRadius: number;
  activeBrushRadius: number;

  // Draft placement state
  draftPoints: Vec3[];
  draftSurfaceMaterial: SurfaceMaterial;
  draftScatterTriangles: SurfaceTriangle[];
  scatterMetaByRunId: Record<
    string,
    { triangles: SurfaceTriangle[]; brushRadius: number }
  >;
  isPaintingScatter: boolean;

  // Runs + Selection + Undo/Redo stacks
  runs: LightRun[];
  selectedRunId: string | null;
  pastRuns: LightRun[][];
  futureRuns: LightRun[][];

  // Actions — Scene & Calibration
  setJob: (job: ReconstructionJob | null, title?: string) => void;
  setTilesScene: (title: string, anchor: TilesAnchor) => void;
  setProceduralScene: (preset: 'condo' | 'house', title?: string) => void;
  resetToLauncher: () => void;
  setActiveDrawer: (drawer: ActiveDrawer) => void;
  setCameras: (cameras: CameraPose[]) => void;
  setDetectedZones: (zones: DetectedZone[]) => void;
  setGroundMinY: (minY: number) => void;
  setReconstructing: (flag: boolean, error?: string | null) => void;
  setMapsStatus: (attribution: string | null, warnings?: string[]) => void;
  setCalibrating: (flag: boolean, error?: string | null) => void;
  setCalibration: (feetPerSceneUnit: number, source: CalibrationSource) => void;
  addRulerPoint: (pt: Vec3) => void;
  clearRulerPoints: () => void;

  // Actions — Tooling & Lighting
  setLightingMode: (mode: LightingMode) => void;
  setToolMode: (mode: ToolMode) => void;
  setActiveBulbPreset: (preset: BulbPreset) => void;
  setActiveSpacingInches: (inches: number) => void;
  setActiveColorsHex: (colors: string[]) => void;
  setActivePattern: (pattern: LightPattern) => void;
  setActiveHelixTurns: (turns: number) => void;
  setActiveHelixRadius: (radius: number) => void;
  setActiveBrushRadius: (radius: number) => void;

  // Actions — Draft & Run Management
  appendDraftPoint: (
    pt: Vec3,
    surfaceMaterial?: SurfaceMaterial,
    triangles?: SurfaceTriangle[]
  ) => void;
  setPaintingScatter: (painting: boolean) => void;
  cancelDraft: () => void;
  commitDraftRun: (customName?: string) => LightRun | null;
  addRunDirect: (
    partial: Omit<LightRun, 'id' | 'bulbPositions'> & {
      id?: string;
      bulbPositions?: Vec3[];
    }
  ) => LightRun;
  selectRun: (runId: string | null) => void;
  updateRun: (
    runId: string,
    patch: Partial<
      Pick<
        LightRun,
        | 'name'
        | 'bulbPreset'
        | 'spacingInches'
        | 'colorsHex'
        | 'pattern'
        | 'surfaceMaterial'
        | 'helixParams'
      >
    >
  ) => void;
  deleteRun: (runId: string) => void;
  clearRuns: () => void;
  undo: () => void;
  redo: () => void;
  applyConceptPreset: (preset: ConceptPreset) => void;
  exportProjectJson: () => string;
  importProjectJson: (rawJson: string) => void;
}

function pushUndoSnapshot(past: LightRun[][], current: LightRun[]): LightRun[][] {
  const cloned = current.map((r) => ({
    ...r,
    colorsHex: [...r.colorsHex],
    controlPoints: r.controlPoints.map((p) => [...p] as Vec3),
    bulbPositions: r.bulbPositions.map((p) => [...p] as Vec3),
    helixParams: r.helixParams
      ? {
          baseCenter: [...r.helixParams.baseCenter] as Vec3,
          topCenter: [...r.helixParams.topCenter] as Vec3,
          radius: r.helixParams.radius,
          turns: r.helixParams.turns,
        }
      : undefined,
  }));
  const next = [...past, cloned];
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
}

function makeRunId(): string {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function defaultRunLabel(toolMode: ToolMode, index: number): string {
  switch (toolMode) {
    case 'LINEAR_EAVE':
      return `Roofline / Eave Run #${index}`;
    case 'HELICAL_WRAP':
      return `Column Helix Wrap #${index}`;
    case 'SURFACE_SCATTER':
      return `Shrub Foliage Net #${index}`;
    case 'PATHWAY_STAKE':
      return `Walkway Stake Line #${index}`;
    default:
      return `Light Run #${index}`;
  }
}

export const useStudioStore = create<StudioState>((set, get) => ({
  sceneSource: 'NONE',
  sceneTitle: '',
  tilesAnchor: null,
  proceduralPreset: null,
  activeDrawer: 'NONE',
  job: null,
  cameras: [],
  detectedZones: [],
  groundMinY: 0,
  isReconstructing: false,
  reconError: null,
  mapsAttribution: null,
  mapsWarnings: [],

  feetPerSceneUnit: DEFAULT_FEET_PER_SCENE_UNIT,
  calibrationSource: 'DEFAULT',
  rulerPoints: [],
  isCalibrating: false,
  calibrationError: null,

  lightingMode: 'NIGHT',
  toolMode: 'LINEAR_EAVE',
  activeBulbPreset: 'C9_LED',
  activeSpacingInches: BULB_PRESET_SPECS.C9_LED.defaultSpacingInches,
  activeColorsHex: ['#ffd996', '#ff2424'],
  activePattern: 'ALTERNATING',
  activeHelixTurns: 6,
  activeHelixRadius: 0.14,
  activeBrushRadius: 0.55,

  draftPoints: [],
  draftSurfaceMaterial: 'metal_gutter',
  draftScatterTriangles: [],
  scatterMetaByRunId: {},
  isPaintingScatter: false,

  runs: [],
  selectedRunId: null,
  pastRuns: [],
  futureRuns: [],

  setJob: (job, title) =>
    set((state) => ({
      job,
      proceduralPreset: null,
      tilesAnchor: null,
      sceneSource:
        job && (job.status === 'completed' || state.sceneSource !== 'NONE')
          ? 'MESH_RECON'
          : state.sceneSource,
      sceneTitle:
        title !== undefined
          ? title
          : job?.buildingSpec?.sourceSummary || state.sceneTitle || '3D Exterior Model',
    })),
  setTilesScene: (sceneTitle, tilesAnchor) =>
    set({
      sceneSource: 'MAPS_3D_TILES',
      sceneTitle,
      tilesAnchor,
      proceduralPreset: null,
      job: null,
      groundMinY: 0,
      feetPerSceneUnit: DEFAULT_FEET_PER_SCENE_UNIT,
      calibrationSource: 'MAPS_3D_TILES',
      isReconstructing: false,
      reconError: null,
    }),
  setProceduralScene: (preset, title) =>
    set({
      sceneSource: 'MESH_RECON',
      sceneTitle:
        title ||
        (preset === 'condo'
          ? '3-Story Condo · 2 Balconies'
          : 'Suburban Gable Residence'),
      proceduralPreset: preset,
      tilesAnchor: null,
      job: null,
      groundMinY: 0,
      feetPerSceneUnit: DEFAULT_FEET_PER_SCENE_UNIT,
      calibrationSource: 'AUTO_DOOR',
      isReconstructing: false,
      reconError: null,
    }),
  resetToLauncher: () =>
    set({
      sceneSource: 'NONE',
      sceneTitle: '',
      tilesAnchor: null,
      proceduralPreset: null,
      activeDrawer: 'NONE',
      job: null,
      isReconstructing: false,
      reconError: null,
      draftPoints: [],
      draftScatterTriangles: [],
      isPaintingScatter: false,
    }),
  setActiveDrawer: (activeDrawer) => set({ activeDrawer }),
  setCameras: (cameras) => set({ cameras }),
  setDetectedZones: (detectedZones) => set({ detectedZones }),
  setGroundMinY: (groundMinY) => set({ groundMinY }),
  setReconstructing: (isReconstructing, reconError = null) =>
    set({ isReconstructing, reconError }),
  setMapsStatus: (mapsAttribution, mapsWarnings = []) =>
    set({ mapsAttribution, mapsWarnings }),
  setCalibrating: (isCalibrating, calibrationError = null) =>
    set({ isCalibrating, calibrationError }),

  setCalibration: (feetPerSceneUnit, calibrationSource) => {
    const safeScale = Math.max(0.05, feetPerSceneUnit);
    set((state) => ({
      feetPerSceneUnit: safeScale,
      calibrationSource,
      calibrationError: null,
      runs: state.runs.map((run) => {
        const meta = state.scatterMetaByRunId[run.id];
        return {
          ...run,
          bulbPositions: recomputeRunBulbPositions(
            run,
            safeScale,
            meta?.triangles,
            meta?.brushRadius
          ),
        };
      }),
    }));
  },

  addRulerPoint: (pt) =>
    set((state) => ({
      rulerPoints: state.rulerPoints.length >= 2 ? [pt] : [...state.rulerPoints, pt],
    })),

  clearRulerPoints: () => set({ rulerPoints: [] }),

  setLightingMode: (lightingMode) => set({ lightingMode }),

  setToolMode: (toolMode) =>
    set((state) => {
      let nextPreset = state.activeBulbPreset;
      let nextSpacing = state.activeSpacingInches;
      if (toolMode === 'PATHWAY_STAKE' && nextPreset !== 'PATHWAY_C9_STAKE') {
        nextPreset = 'PATHWAY_C9_STAKE';
        nextSpacing = BULB_PRESET_SPECS.PATHWAY_C9_STAKE.defaultSpacingInches;
      } else if (toolMode === 'HELICAL_WRAP' && nextPreset === 'PATHWAY_C9_STAKE') {
        nextPreset = 'MINI_5MM_LED';
        nextSpacing = BULB_PRESET_SPECS.MINI_5MM_LED.defaultSpacingInches;
      } else if (toolMode === 'SURFACE_SCATTER' && nextPreset === 'PATHWAY_C9_STAKE') {
        nextPreset = 'MINI_5MM_LED';
        nextSpacing = 6;
      } else if (toolMode === 'LINEAR_EAVE' && nextPreset === 'PATHWAY_C9_STAKE') {
        nextPreset = 'C9_LED';
        nextSpacing = BULB_PRESET_SPECS.C9_LED.defaultSpacingInches;
      }
      return {
        toolMode,
        activeBulbPreset: nextPreset,
        activeSpacingInches: nextSpacing,
        draftPoints: [],
        draftScatterTriangles: [],
        isPaintingScatter: false,
      };
    }),

  setActiveBulbPreset: (activeBulbPreset) =>
    set({
      activeBulbPreset,
      activeSpacingInches: BULB_PRESET_SPECS[activeBulbPreset].defaultSpacingInches,
    }),

  setActiveSpacingInches: (activeSpacingInches) =>
    set({ activeSpacingInches: Math.max(1, activeSpacingInches) }),

  setActiveColorsHex: (activeColorsHex) =>
    set({ activeColorsHex: activeColorsHex.length > 0 ? activeColorsHex : ['#ffd996'] }),

  setActivePattern: (activePattern) => set({ activePattern }),
  setActiveHelixTurns: (activeHelixTurns) =>
    set({ activeHelixTurns: Math.max(0.5, activeHelixTurns) }),
  setActiveHelixRadius: (activeHelixRadius) =>
    set({ activeHelixRadius: Math.max(0.03, activeHelixRadius) }),
  setActiveBrushRadius: (activeBrushRadius) =>
    set({ activeBrushRadius: Math.max(0.1, activeBrushRadius) }),

  appendDraftPoint: (pt, surfaceMaterial, triangles) =>
    set((state) => {
      let mergedTris = state.draftScatterTriangles;
      if (triangles && triangles.length > 0) {
        mergedTris = [...state.draftScatterTriangles, ...triangles];
        if (mergedTris.length > 1800) {
          mergedTris = mergedTris.slice(mergedTris.length - 1800);
        }
      }
      return {
        draftPoints: [...state.draftPoints, pt],
        draftSurfaceMaterial:
          state.draftPoints.length === 0 && surfaceMaterial
            ? surfaceMaterial
            : state.draftSurfaceMaterial,
        draftScatterTriangles: mergedTris,
      };
    }),

  setPaintingScatter: (isPaintingScatter) => set({ isPaintingScatter }),

  cancelDraft: () =>
    set({
      draftPoints: [],
      draftScatterTriangles: [],
      isPaintingScatter: false,
    }),

  commitDraftRun: (customName) => {
    const state = get();
    const {
      toolMode,
      draftPoints,
      draftSurfaceMaterial,
      draftScatterTriangles,
      activeBulbPreset,
      activeSpacingInches,
      activeColorsHex,
      activePattern,
      activeHelixRadius,
      activeHelixTurns,
      feetPerSceneUnit,
    } = state;

    if (
      (toolMode === 'LINEAR_EAVE' ||
        toolMode === 'PATHWAY_STAKE' ||
        toolMode === 'HELICAL_WRAP') &&
      draftPoints.length < 2
    ) {
      return null;
    }
    if (toolMode === 'SURFACE_SCATTER' && draftPoints.length < 1) {
      return null;
    }

    const helixParams =
      toolMode === 'HELICAL_WRAP'
        ? {
            baseCenter: draftPoints[0],
            topCenter: draftPoints[draftPoints.length - 1],
            radius: activeHelixRadius,
            turns: activeHelixTurns,
          }
        : undefined;

    const baseRun: Omit<LightRun, 'bulbPositions'> = {
      id: makeRunId(),
      name: customName || defaultRunLabel(toolMode, state.runs.length + 1),
      toolMode,
      bulbPreset:
        toolMode === 'PATHWAY_STAKE' ? 'PATHWAY_C9_STAKE' : activeBulbPreset,
      spacingInches: activeSpacingInches,
      colorsHex: [...activeColorsHex],
      pattern: activePattern,
      controlPoints: draftPoints.map((p) => [...p] as Vec3),
      helixParams,
      surfaceMaterial:
        toolMode === 'PATHWAY_STAKE'
          ? 'ground_turf'
          : toolMode === 'HELICAL_WRAP'
            ? 'column_post'
            : toolMode === 'SURFACE_SCATTER'
              ? 'foliage_shrub'
              : draftSurfaceMaterial,
    };

    const bulbPositions = recomputeRunBulbPositions(
      baseRun,
      feetPerSceneUnit,
      draftScatterTriangles,
      state.activeBrushRadius
    );
    if (bulbPositions.length === 0) {
      set({ draftPoints: [], draftScatterTriangles: [], isPaintingScatter: false });
      return null;
    }

    const fullRun: LightRun = {
      ...baseRun,
      bulbPositions,
    };

    set((prev) => ({
      pastRuns: pushUndoSnapshot(prev.pastRuns, prev.runs),
      futureRuns: [],
      runs: [...prev.runs, fullRun],
      selectedRunId: fullRun.id,
      scatterMetaByRunId:
        toolMode === 'SURFACE_SCATTER'
          ? {
              ...prev.scatterMetaByRunId,
              [fullRun.id]: {
                triangles: draftScatterTriangles,
                brushRadius: state.activeBrushRadius,
              },
            }
          : prev.scatterMetaByRunId,
      draftPoints: [],
      draftScatterTriangles: [],
      isPaintingScatter: false,
    }));

    return fullRun;
  },

  addRunDirect: (partial) => {
    const state = get();
    const id = partial.id || makeRunId();
    const bulbPositions =
      partial.bulbPositions && partial.bulbPositions.length > 0
        ? partial.bulbPositions
        : recomputeRunBulbPositions({ ...partial, id }, state.feetPerSceneUnit);

    const fullRun: LightRun = {
      ...partial,
      id,
      bulbPositions,
    };

    set((prev) => ({
      pastRuns: pushUndoSnapshot(prev.pastRuns, prev.runs),
      futureRuns: [],
      runs: [...prev.runs, fullRun],
      selectedRunId: fullRun.id,
    }));
    return fullRun;
  },

  selectRun: (selectedRunId) => set({ selectedRunId }),

  updateRun: (runId, patch) =>
    set((state) => {
      const target = state.runs.find((r) => r.id === runId);
      if (!target) return state;

      const updatedBase: LightRun = {
        ...target,
        ...patch,
        colorsHex: patch.colorsHex ? [...patch.colorsHex] : target.colorsHex,
        helixParams: patch.helixParams ? { ...patch.helixParams } : target.helixParams,
      };

      const needsGeometryRecompute =
        patch.bulbPreset !== undefined ||
        patch.spacingInches !== undefined ||
        patch.helixParams !== undefined;

      const scatterMeta = state.scatterMetaByRunId[runId];
      const nextBulbs = needsGeometryRecompute
        ? recomputeRunBulbPositions(
            updatedBase,
            state.feetPerSceneUnit,
            scatterMeta?.triangles,
            scatterMeta?.brushRadius
          )
        : updatedBase.bulbPositions;

      return {
        pastRuns: pushUndoSnapshot(state.pastRuns, state.runs),
        futureRuns: [],
        runs: state.runs.map((r) =>
          r.id === runId ? { ...updatedBase, bulbPositions: nextBulbs } : r
        ),
      };
    }),

  deleteRun: (runId) =>
    set((state) => {
      if (!state.runs.some((r) => r.id === runId)) return state;
      return {
        pastRuns: pushUndoSnapshot(state.pastRuns, state.runs),
        futureRuns: [],
        runs: state.runs.filter((r) => r.id !== runId),
        selectedRunId: state.selectedRunId === runId ? null : state.selectedRunId,
      };
    }),

  clearRuns: () =>
    set((state) => {
      if (state.runs.length === 0) return state;
      return {
        pastRuns: pushUndoSnapshot(state.pastRuns, state.runs),
        futureRuns: [],
        runs: [],
        selectedRunId: null,
        draftPoints: [],
      };
    }),

  undo: () =>
    set((state) => {
      if (state.pastRuns.length === 0) return state;
      const previous = state.pastRuns[state.pastRuns.length - 1];
      return {
        pastRuns: state.pastRuns.slice(0, -1),
        futureRuns: pushUndoSnapshot(state.futureRuns, state.runs),
        runs: previous,
        selectedRunId: null,
      };
    }),

  redo: () =>
    set((state) => {
      if (state.futureRuns.length === 0) return state;
      const next = state.futureRuns[state.futureRuns.length - 1];
      return {
        pastRuns: pushUndoSnapshot(state.pastRuns, state.runs),
        futureRuns: state.futureRuns.slice(0, -1),
        runs: next,
        selectedRunId: null,
      };
    }),

  applyConceptPreset: (preset) =>
    set((state) => {
      if (state.runs.length === 0 || preset.runMutations.length === 0) {
        return state;
      }
      const nextRuns = state.runs.map((run, idx) => {
        const matched =
          preset.runMutations.find((m) => m.runId && m.runId === run.id) ||
          preset.runMutations[idx % preset.runMutations.length];
        if (!matched) return run;

        // Preserve pathway stake bulb type on ground stakes while applying colors/pattern
        const effectivePreset =
          run.toolMode === 'PATHWAY_STAKE' ? 'PATHWAY_C9_STAKE' : matched.bulbPreset;
        const effectiveSpacing =
          run.toolMode === 'PATHWAY_STAKE'
            ? Math.max(18, matched.spacingInches)
            : matched.spacingInches;

        const mutated: LightRun = {
          ...run,
          bulbPreset: effectivePreset,
          colorsHex: [...matched.colorsHex],
          pattern: matched.pattern,
          spacingInches: effectiveSpacing,
        };
        const scatterMeta = state.scatterMetaByRunId[run.id];
        return {
          ...mutated,
          bulbPositions: recomputeRunBulbPositions(
            mutated,
            state.feetPerSceneUnit,
            scatterMeta?.triangles,
            scatterMeta?.brushRadius
          ),
        };
      });

      return {
        pastRuns: pushUndoSnapshot(state.pastRuns, state.runs),
        futureRuns: [],
        runs: nextRuns,
      };
    }),

  exportProjectJson: () => {
    const state = get();
    const payload = {
      version: 1 as const,
      exportedAt: new Date().toISOString(),
      feetPerSceneUnit: state.feetPerSceneUnit,
      calibrationSource: state.calibrationSource,
      lightingMode: state.lightingMode,
      runs: state.runs,
    };
    return JSON.stringify(payload, null, 2);
  },

  importProjectJson: (rawJson) => {
    const parsed = ProjectExportSchema.parse(JSON.parse(rawJson));
    set((state) => ({
      pastRuns: pushUndoSnapshot(state.pastRuns, state.runs),
      futureRuns: [],
      feetPerSceneUnit: parsed.feetPerSceneUnit,
      calibrationSource: parsed.calibrationSource,
      lightingMode: parsed.lightingMode,
      runs: parsed.runs,
      selectedRunId: null,
    }));
  },
}));
