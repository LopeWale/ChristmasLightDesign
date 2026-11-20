import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: [
      'packages/**/tests/**/*.test.ts',
      'apps/web/tests/**/*.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      'apps/web/tests/**/*.spec.ts',
    ],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@lumen3d/shared-schemas': path.resolve(__dirname, 'packages/shared-schemas/src/index.ts'),
      '@': path.resolve(__dirname, 'apps/web/src'),
    },
  },
});
