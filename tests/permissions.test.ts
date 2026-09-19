/**
 * Tests for permission-based execution system
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hasPermission, resetPermission, requestPermissionOrExit } from '../src/permissions.js';

// Mock @inquirer/prompts
vi.mock('@inquirer/prompts', () => ({
  confirm: vi.fn(),
}));

import { confirm } from '@inquirer/prompts';
const mockConfirm = vi.mocked(confirm);

describe('permissions', () => {
  beforeEach(() => {
    resetPermission();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetPermission();
  });

  describe('hasPermission', () => {
    it('returns false initially', () => {
      expect(hasPermission()).toBe(false);
    });
  });

  describe('resetPermission', () => {
    it('resets permission state', () => {
      resetPermission();
      expect(hasPermission()).toBe(false);
    });
  });
});

describe('permission model', () => {
  let mockExit: ReturnType<typeof vi.spyOn>;
  let mockConsoleLog: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetPermission();
    vi.clearAllMocks();
    mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    resetPermission();
    mockExit.mockRestore();
    mockConsoleLog.mockRestore();
  });

  it('is all-or-nothing (atomic)', async () => {
    // Permission should be granted once upfront, not per-command
    // After granting, subsequent calls should not re-prompt
    mockConfirm.mockResolvedValueOnce(true);

    await requestPermissionOrExit();
    expect(hasPermission()).toBe(true);
    expect(mockConfirm).toHaveBeenCalledTimes(1);

    // Second call should NOT prompt again (permission already granted)
    await requestPermissionOrExit();
    expect(mockConfirm).toHaveBeenCalledTimes(1); // Still 1, not 2
    expect(hasPermission()).toBe(true);
  });

  it('exits cleanly if denied', async () => {
    // When permission is denied, process.exit(0) is called
    mockConfirm.mockResolvedValueOnce(false);
    // Make mock throw to simulate actual process.exit behavior (stops execution)
    mockExit.mockImplementation(() => { throw new Error('process.exit called'); });

    await expect(requestPermissionOrExit()).rejects.toThrow('process.exit called');

    expect(mockExit).toHaveBeenCalledWith(0);
    // Permission should NOT be granted since exit was called before setting it
    expect(hasPermission()).toBe(false);
  });

  it('grants permission when user confirms', async () => {
    mockConfirm.mockResolvedValueOnce(true);

    await requestPermissionOrExit();

    expect(mockExit).not.toHaveBeenCalled();
    expect(hasPermission()).toBe(true);
  });
});

// --- Story 547: disclosure of third-party installs ---

describe('disclosure box (story 547)', () => {
  it('no line exceeds the box width', async () => {
    const { disclosureLines, PERMISSION_BOX_WIDTH } = await import('../src/permissions.js');

    // A line wider than its border is a silent visual defect: the box just
    // looks broken and no other assertion notices.
    for (const line of disclosureLines()) {
      expect(line.length, `too long: ${line}`).toBeLessThanOrEqual(PERMISSION_BOX_WIDTH - 2);
    }
  });

  it('names every third-party package any harness would install', async () => {
    const { disclosureLines } = await import('../src/permissions.js');
    const { HARNESSES } = await import('../src/harnesses.js');

    // Guards against the installer fetching something the prompt never named.
    const text = disclosureLines().join('\n');
    const declared = HARNESSES.flatMap((h) => h.installs ?? []);

    expect(declared.length).toBeGreaterThan(0);
    for (const install of declared) {
      expect(text).toContain(install.packageName);
      expect(text).toContain(install.publisher);
    }
  });

  it('does not claim that nothing leaves the machine', async () => {
    const { disclosureLines } = await import('../src/permissions.js');
    const text = disclosureLines().join('\n').toLowerCase();

    // The old wording said "Nothing is sent externally unless you choose to
    // share." Setup now fetches packages, so that sentence would be false.
    expect(text).not.toContain('nothing is sent externally');
  });

  it('separates installing software from running commands', async () => {
    const { disclosureLines } = await import('../src/permissions.js');
    const text = disclosureLines().join('\n');

    expect(text).toContain('INSTALL software published by others');
  });
});
