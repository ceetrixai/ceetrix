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
