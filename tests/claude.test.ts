import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exec } from 'child_process';

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

// Mock which package
vi.mock('which', () => ({
  default: vi.fn().mockResolvedValue('/opt/homebrew/bin/claude'),
}));

// Mock permissions to auto-grant in tests
vi.mock('../src/permissions.js', () => ({
  requestPermission: vi.fn().mockResolvedValue(true),
  hasSessionTrust: vi.fn().mockReturnValue(true),
  resetSessionTrust: vi.fn(),
}));

// Mock constants
vi.mock('../src/constants.js', () => ({
  getMcpServerUrl: () => 'https://api.ceetrix.com/sse',
}));

const mockExec = vi.mocked(exec);

// Track call count to differentiate version check vs actual command
let execCallCount = 0;

function setupMocks(versionResponse: string, commandResponse: string | Error) {
  execCallCount = 0;
  mockExec.mockImplementation(((
    cmd: string,
    _opts: unknown,
    callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void
  ) => {
    execCallCount++;
    if (callback) {
      // First call is always version check
      if (cmd.includes('--version')) {
        callback(null, { stdout: versionResponse, stderr: '' });
      } else if (commandResponse instanceof Error) {
        callback(commandResponse, { stdout: '', stderr: '' });
      } else {
        callback(null, { stdout: commandResponse, stderr: '' });
      }
    }
    return {} as ReturnType<typeof exec>;
  }) as typeof exec);
}

function setupVersionCheckFailure() {
  mockExec.mockImplementation(((
    _cmd: string,
    _opts: unknown,
    callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void
  ) => {
    if (callback) {
      callback(new Error('command not found'), { stdout: '', stderr: '' });
    }
    return {} as ReturnType<typeof exec>;
  }) as typeof exec);
}

describe('checkClaudeCli', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the module to clear cached claude path
    vi.resetModules();
  });

  it('returns true when claude responds with Claude Code marker', async () => {
    setupMocks('2.0.76 (Claude Code)', '');

    // Re-import after reset
    const { checkClaudeCli } = await import('../src/claude.js');
    const result = await checkClaudeCli();

    expect(result).toBe(true);
  });

  it('returns false when version check fails', async () => {
    setupVersionCheckFailure();

    const { checkClaudeCli } = await import('../src/claude.js');
    const result = await checkClaudeCli();

    expect(result).toBe(false);
  });

  it('returns false when version lacks Claude Code marker', async () => {
    setupMocks('Some Other Tool v1.0.0', '');

    const { checkClaudeCli } = await import('../src/claude.js');
    const result = await checkClaudeCli();

    expect(result).toBe(false);
  });
});

describe('addConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('calls claude mcp add-json with correct config', async () => {
    setupMocks('2.0.76 (Claude Code)', '');

    const { addConfig } = await import('../src/claude.js');
    await addConfig('test_api_key');

    // Should have called exec with mcp add-json command
    const calls = mockExec.mock.calls;
    const addJsonCall = calls.find(c => String(c[0]).includes('mcp add-json'));

    expect(addJsonCall).toBeDefined();
    expect(String(addJsonCall![0])).toContain('ceetrix');
    expect(String(addJsonCall![0])).toContain('test_api_key');
  });

  it('throws when claude is not found', async () => {
    setupVersionCheckFailure();

    const { addConfig } = await import('../src/claude.js');
    await expect(addConfig('test_api_key')).rejects.toThrow('Claude CLI not found');
  });
});

describe('checkExistingConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns true when ceetrix is in mcp list', async () => {
    setupMocks('2.0.76 (Claude Code)', 'ceetrix: https://api.ceetrix.com/sse');

    const { checkExistingConfig } = await import('../src/claude.js');
    const result = await checkExistingConfig();

    expect(result).toBe(true);
  });

  it('returns false when ceetrix is not in mcp list', async () => {
    setupMocks('2.0.76 (Claude Code)', 'other-server: https://example.com');

    const { checkExistingConfig } = await import('../src/claude.js');
    const result = await checkExistingConfig();

    expect(result).toBe(false);
  });

  it('returns false when claude is not found', async () => {
    setupVersionCheckFailure();

    const { checkExistingConfig } = await import('../src/claude.js');
    const result = await checkExistingConfig();

    expect(result).toBe(false);
  });
});

describe('removeConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('calls claude mcp remove', async () => {
    setupMocks('2.0.76 (Claude Code)', '');

    const { removeConfig } = await import('../src/claude.js');
    await removeConfig();

    const calls = mockExec.mock.calls;
    const removeCall = calls.find(c => String(c[0]).includes('mcp remove'));

    expect(removeCall).toBeDefined();
    expect(String(removeCall![0])).toContain('ceetrix');
  });

  it('throws when claude is not found', async () => {
    setupVersionCheckFailure();

    const { removeConfig } = await import('../src/claude.js');
    await expect(removeConfig()).rejects.toThrow('Claude CLI not found');
  });
});
