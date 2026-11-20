import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI, Type, type Schema } from '@google/genai';

function preloadRootEnvOnce(): void {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../../.env'),
  ];
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = line.slice(0, eqIdx).trim().replace(/^export\s+/, '');
      let val = line.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  }
}

preloadRootEnvOnce();

export { Type };
export type { Schema };

export function getGenAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    throw new Error('GEMINI_API_KEY is not set in server environment');
  }
  return new GoogleGenAI({ apiKey });
}

export function getGeminiModel(): string {
  return process.env.GEMINI_MODEL || 'gemini-2.5-flash';
}

export function isGeminiMockMode(): boolean {
  return process.env.GEMINI_MOCK_MODE === 'true';
}

export function stripDataUrlPrefix(input: string): {
  mimeType: string;
  base64Data: string;
} {
  const match = input.match(/^data:([^;]+);base64,(.+)$/s);
  if (match) {
    return {
      mimeType: match[1],
      base64Data: match[2].replace(/\s+/g, ''),
    };
  }
  return {
    mimeType: 'image/png',
    base64Data: input.replace(/\s+/g, ''),
  };
}

export const SURFACE_MATERIAL_ENUM_VALUES = [
  'asphalt_shingle',
  'metal_gutter',
  'wood_fascia',
  'brick_masonry',
  'vinyl_siding',
  'stucco',
  'column_post',
  'foliage_shrub',
  'ground_turf',
  'unknown',
];

export const BULB_PRESET_ENUM_VALUES = [
  'C9_LED',
  'C7_LED',
  'MINI_5MM_LED',
  'ICICLE_DROP_LED',
  'RGB_SOFFIT_PUCK',
  'PATHWAY_C9_STAKE',
];

export const LIGHT_PATTERN_ENUM_VALUES = [
  'SOLID',
  'ALTERNATING',
  'CANDY_CANE',
  'TWINKLE',
];
