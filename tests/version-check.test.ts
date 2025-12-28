/**
 * Tests for version checking functionality
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { compareVersions, getCurrentVersion, getLatestVersion } from '../src/version-check.js';

describe('compareVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('2.5.3', '2.5.3')).toBe(0);
  });

  it('returns negative when first version is lower', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.1.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.9', '1.0.10')).toBeLessThan(0);
  });

  it('returns positive when first version is higher', () => {
    expect(compareVersions('1.0.1', '1.0.0')).toBeGreaterThan(0);
    expect(compareVersions('1.1.0', '1.0.0')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0', '1.0.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.10', '1.0.9')).toBeGreaterThan(0);
  });

  it('handles versions with different segment counts', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1', '1.0.0')).toBe(0);
  });
});

describe('getCurrentVersion', () => {
  it('returns a valid semver string', () => {
    const version = getCurrentVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('matches package.json version', async () => {
    const version = getCurrentVersion();
    const packageJson = await import('../package.json');
    expect(version).toBe(packageJson.version);
  });
});

describe('getLatestVersion', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns version from npm registry on success', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: '2.0.0' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const version = await getLatestVersion();
    expect(version).toBe('2.0.0');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://registry.npmjs.org/ceetrix/latest',
      expect.any(Object)
    );
  });

  it('returns null on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const version = await getLatestVersion();
    expect(version).toBeNull();
  });

  it('returns null on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }));

    const version = await getLatestVersion();
    expect(version).toBeNull();
  });

  it('returns null on invalid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}), // Missing version field
    }));

    const version = await getLatestVersion();
    expect(version).toBeNull();
  });
});
