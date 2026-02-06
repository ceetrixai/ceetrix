/**
 * Vitest config for Stryker mutation testing.
 *
 * Excludes tests that make real network calls (invite.test.ts)
 * since they timeout during Stryker's dry run.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/invite.test.ts'],
    globals: true,
  },
});
