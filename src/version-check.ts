/**
 * Version check against npm registry
 *
 * Ensures user is running the latest version.
 * npx caches old versions, so we enforce @latest.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

/** npm registry URL for version check */
const NPM_REGISTRY_URL = 'https://registry.npmjs.org/ceetrix/latest';

/** Timeout for npm registry request */
const REGISTRY_TIMEOUT_MS = 5000;

/**
 * Get the current package version from package.json
 */
export function getCurrentVersion(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const packagePath = join(__dirname, '..', 'package.json');
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));
  return packageJson.version;
}

/**
 * Fetch the latest version from npm registry
 *
 * @returns Latest version string, or null if fetch fails
 */
export async function getLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REGISTRY_TIMEOUT_MS);

    const response = await fetch(NPM_REGISTRY_URL, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as { version?: string };
    return data.version ?? null;
  } catch {
    // Network error, timeout, or parse error
    return null;
  }
}

/**
 * Compare two semver version strings
 *
 * @returns negative if a < b, 0 if equal, positive if a > b
 */
export function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const diff = (partsA[i] || 0) - (partsB[i] || 0);
    if (diff !== 0) return diff;
  }

  return 0;
}

/**
 * Check if current version is latest and exit if not.
 * Skips check if unable to reach npm registry.
 */
export async function enforceLatestVersion(): Promise<void> {
  const current = getCurrentVersion();
  const latest = await getLatestVersion();

  if (latest === null) {
    // Can't reach npm registry, allow to proceed
    // (might be offline, corporate firewall, etc.)
    return;
  }

  if (compareVersions(current, latest) < 0) {
    console.error(`\n✗ Outdated version: ${current} (latest: ${latest})\n`);
    console.error('npx caches old versions. Run with @latest:\n');
    console.error('  npx ceetrix@latest\n');
    console.error('Or clear the cache:\n');
    console.error('  rm -rf ~/.npm/_npx && npx ceetrix\n');
    process.exit(1);
  }
}
