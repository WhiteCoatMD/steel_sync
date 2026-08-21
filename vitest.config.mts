import { defineConfig, configDefaults } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
    // Vitest's default excludes cover node_modules and build output, but not a
    // git worktree nested inside the repo. Without this, running the suite from
    // the main checkout also collects the tests inside .claude/worktrees/*,
    // where the component resolves react-dom from the WORKTREE's node_modules
    // while zustand resolves from this one — two copies of React in one process,
    // which fails with an invalid-hook-call that has nothing to do with the code
    // under test. CI never sees it (no worktree there), so it presents as
    // "passes in CI, fails locally".
    exclude: [...configDefaults.exclude, '.claude/**', '.superpowers/**'],
  },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, '.') },
  },
});
