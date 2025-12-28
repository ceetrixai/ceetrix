import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

// Mock constants
vi.mock('../src/constants.js', () => ({
  getMcpServerUrl: () => 'https://api.ceetrix.com/sse',
}));

import { checkClaudeCli, addConfig, checkExistingConfig, removeConfig } from '../src/claude.js';

const mockExec = vi.mocked(exec);

// Helper to simulate promisified exec
function mockExecSuccess(stdout: string = '') {
  mockExec.mockImplementation(((
    _cmd: string,
    _opts: unknown,
    callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void
  ) => {
    if (callback) {
      callback(null, { stdout, stderr: '' });
    }
    return {} as ReturnType<typeof exec>;
  }) as typeof exec);
}

function mockExecFailure(error: Error) {
  mockExec.mockImplementation(((
    _cmd: string,
    _opts: unknown,
    callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void
  ) => {
    if (callback) {
      callback(error, { stdout: '', stderr: '' });
    }
    return {} as ReturnType<typeof exec>;
  }) as typeof exec);
}

describe('checkClaudeCli', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when claude is available', async () => {
    mockExecSuccess('claude version 1.0.0');

    const result = await checkClaudeCli();

    expect(result).toBe(true);
    expect(mockExec).toHaveBeenCalledWith(
      'claude --version',
      expect.objectContaining({ timeout: expect.any(Number) }),
      expect.any(Function)
    );
  });

  it('returns false when claude is not found', async () => {
    mockExecFailure(new Error('command not found: claude'));

    const result = await checkClaudeCli();

    expect(result).toBe(false);
  });
});

describe('addConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls claude mcp add-json with correct config', async () => {
    mockExecSuccess();

    await addConfig('test_api_key');

    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining('claude mcp add-json ceetrix'),
      expect.any(Object),
      expect.any(Function)
    );
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining('https://api.ceetrix.com/sse'),
      expect.any(Object),
      expect.any(Function)
    );
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining('X-API-Key'),
      expect.any(Object),
      expect.any(Function)
    );
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining('test_api_key'),
      expect.any(Object),
      expect.any(Function)
    );
  });

  it('throws when command fails', async () => {
    mockExecFailure(new Error('Command failed'));

    await expect(addConfig('test_api_key')).rejects.toThrow();
  });
});

describe('checkExistingConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when ceetrix is in mcp list', async () => {
    mockExecSuccess('ceetrix: https://api.ceetrix.com/sse\nother-server: ...');

    const result = await checkExistingConfig();

    expect(result).toBe(true);
  });

  it('returns false when ceetrix is not in mcp list', async () => {
    mockExecSuccess('other-server: https://example.com');

    const result = await checkExistingConfig();

    expect(result).toBe(false);
  });

  it('returns false when command fails', async () => {
    mockExecFailure(new Error('Command failed'));

    const result = await checkExistingConfig();

    expect(result).toBe(false);
  });
});

describe('removeConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls claude mcp remove', async () => {
    mockExecSuccess();

    await removeConfig();

    expect(mockExec).toHaveBeenCalledWith(
      'claude mcp remove ceetrix',
      expect.any(Object),
      expect.any(Function)
    );
  });

  it('throws when command fails', async () => {
    mockExecFailure(new Error('Command failed'));

    await expect(removeConfig()).rejects.toThrow();
  });
});
