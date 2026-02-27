/**
 * Tests for Codex CLI integration (Story 397)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exec } from 'child_process';

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

// Mock which package
vi.mock('which', () => ({
  default: vi.fn(),
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

// Mock constants
vi.mock('../src/constants.js', () => ({
  CODEX_CONFIG_DIR: '.codex',
  CODEX_CONFIG_FILE: 'config.toml',
  CODEX_MCP_SERVER_NAME: 'ceetrix',
  CODEX_API_KEY_ENV_VAR: 'CEETRIX_API_KEY',
  CODEX_VERSION_MARKER: 'codex',
  CODEX_VERSION_CHECK_TIMEOUT_MS: 3000,
  COMMON_CODEX_PATHS: ['/usr/local/bin/codex'],
}));

const mockExec = vi.mocked(exec);

function setupExecMock(response: string | Error) {
  mockExec.mockImplementation(((
    _cmd: string,
    _opts: unknown,
    callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void
  ) => {
    if (callback) {
      if (response instanceof Error) {
        callback(response, { stdout: '', stderr: '' });
      } else {
        callback(null, { stdout: response, stderr: '' });
      }
    }
    return {} as ReturnType<typeof exec>;
  }) as typeof exec);
}

describe('isCodexAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns true when codex responds with version containing marker', async () => {
    const whichMock = (await import('which')).default as unknown as ReturnType<typeof vi.fn>;
    whichMock.mockResolvedValue('/usr/local/bin/codex');
    setupExecMock('codex 1.0.5');

    const { isCodexAvailable } = await import('../src/codex.js');
    const result = await isCodexAvailable();
    expect(result).toBe(true);
  });

  it('returns false when which throws and fallback paths fail', async () => {
    const whichMock = (await import('which')).default as unknown as ReturnType<typeof vi.fn>;
    whichMock.mockRejectedValue(new Error('not found'));
    setupExecMock(new Error('command not found'));

    const { isCodexAvailable } = await import('../src/codex.js');
    const result = await isCodexAvailable();
    expect(result).toBe(false);
  });

  it('returns false when version output lacks codex marker', async () => {
    const whichMock = (await import('which')).default as unknown as ReturnType<typeof vi.fn>;
    whichMock.mockResolvedValue('/usr/local/bin/codex');
    setupExecMock('some-other-tool v2.0');

    const { isCodexAvailable } = await import('../src/codex.js');
    const result = await isCodexAvailable();
    expect(result).toBe(false);
  });

  it('returns true for uppercase Codex in version output', async () => {
    const whichMock = (await import('which')).default as unknown as ReturnType<typeof vi.fn>;
    whichMock.mockResolvedValue('/usr/local/bin/codex');
    setupExecMock('OpenAI Codex CLI v1.2.3');

    const { isCodexAvailable } = await import('../src/codex.js');
    const result = await isCodexAvailable();
    expect(result).toBe(true);
  });
});

describe('addConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('creates config directory and writes TOML when no existing file', async () => {
    const { readFile, writeFile, mkdir } = await import('fs/promises');
    const mockReadFile = vi.mocked(readFile);
    const mockWriteFile = vi.mocked(writeFile);
    const mockMkdir = vi.mocked(mkdir);

    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    mockWriteFile.mockResolvedValue();
    mockMkdir.mockResolvedValue(undefined);

    const { addConfig } = await import('../src/codex.js');
    await addConfig('secret_key_123', 'https://api.ceetrix.com/mcp');

    expect(mockMkdir).toHaveBeenCalledWith(
      expect.stringContaining('.codex'),
      { recursive: true },
    );
    expect(mockWriteFile).toHaveBeenCalledOnce();
  });

  it('writes env var name, NOT the actual API key', async () => {
    const { readFile, writeFile, mkdir } = await import('fs/promises');
    const mockReadFile = vi.mocked(readFile);
    const mockWriteFile = vi.mocked(writeFile);
    vi.mocked(mkdir).mockResolvedValue(undefined);

    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    mockWriteFile.mockResolvedValue();

    const { addConfig } = await import('../src/codex.js');
    await addConfig('super_secret_actual_key', 'https://api.ceetrix.com/mcp');

    const writtenContent = mockWriteFile.mock.calls[0][1] as string;
    // Must NOT contain the actual key
    expect(writtenContent).not.toContain('super_secret_actual_key');
    // Must contain the env var name
    expect(writtenContent).toContain('CEETRIX_API_KEY');
  });

  it('uses env_http_headers, not http_headers', async () => {
    const { readFile, writeFile, mkdir } = await import('fs/promises');
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(writeFile).mockResolvedValue();
    vi.mocked(mkdir).mockResolvedValue(undefined);

    const { addConfig } = await import('../src/codex.js');
    await addConfig('key', 'https://api.ceetrix.com/mcp');

    const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string;
    expect(writtenContent).toContain('env_http_headers');
    expect(writtenContent).not.toMatch(/(?<!\w)http_headers(?!\w)/);
  });

  it('writes correct MCP server URL', async () => {
    const { readFile, writeFile, mkdir } = await import('fs/promises');
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(writeFile).mockResolvedValue();
    vi.mocked(mkdir).mockResolvedValue(undefined);

    const { addConfig } = await import('../src/codex.js');
    await addConfig('key', 'https://api.ceetrix.com/mcp');

    const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string;
    expect(writtenContent).toContain('https://api.ceetrix.com/mcp');
  });

  it('merges with existing TOML content', async () => {
    const { readFile, writeFile, mkdir } = await import('fs/promises');
    const existingToml = [
      '[model]',
      'name = "gpt-4"',
      '',
      '[mcp_servers.other_server]',
      'url = "https://other.com"',
    ].join('\n');

    vi.mocked(readFile).mockResolvedValue(existingToml as any);
    vi.mocked(writeFile).mockResolvedValue();
    vi.mocked(mkdir).mockResolvedValue(undefined);

    const { addConfig } = await import('../src/codex.js');
    await addConfig('key', 'https://api.ceetrix.com/mcp');

    const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string;
    // Existing model section preserved
    expect(writtenContent).toContain('gpt-4');
    // Existing other server preserved
    expect(writtenContent).toContain('other_server');
    // Ceetrix added
    expect(writtenContent).toContain('ceetrix');
    expect(writtenContent).toContain('https://api.ceetrix.com/mcp');
  });
});

describe('checkExistingConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns true when ceetrix entry exists in TOML', async () => {
    const { readFile } = await import('fs/promises');
    const toml = [
      '[mcp_servers.ceetrix]',
      'url = "https://api.ceetrix.com/mcp"',
      'env_http_headers = { "X-API-Key" = "CEETRIX_API_KEY" }',
    ].join('\n');
    vi.mocked(readFile).mockResolvedValue(toml as any);

    const { checkExistingConfig } = await import('../src/codex.js');
    const result = await checkExistingConfig();
    expect(result).toBe(true);
  });

  it('returns false when file does not exist', async () => {
    const { readFile } = await import('fs/promises');
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

    const { checkExistingConfig } = await import('../src/codex.js');
    const result = await checkExistingConfig();
    expect(result).toBe(false);
  });

  it('returns false when file exists but no ceetrix entry', async () => {
    const { readFile } = await import('fs/promises');
    const toml = [
      '[mcp_servers.other]',
      'url = "https://other.com"',
    ].join('\n');
    vi.mocked(readFile).mockResolvedValue(toml as any);

    const { checkExistingConfig } = await import('../src/codex.js');
    const result = await checkExistingConfig();
    expect(result).toBe(false);
  });

  it('returns false when file is empty', async () => {
    const { readFile } = await import('fs/promises');
    vi.mocked(readFile).mockResolvedValue('' as any);

    const { checkExistingConfig } = await import('../src/codex.js');
    const result = await checkExistingConfig();
    expect(result).toBe(false);
  });
});

describe('removeConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('removes ceetrix entry and preserves other entries', async () => {
    const { readFile, writeFile } = await import('fs/promises');
    const toml = [
      '[mcp_servers.other]',
      'url = "https://other.com"',
      '',
      '[mcp_servers.ceetrix]',
      'url = "https://api.ceetrix.com/mcp"',
    ].join('\n');
    vi.mocked(readFile).mockResolvedValue(toml as any);
    vi.mocked(writeFile).mockResolvedValue();

    const { removeConfig } = await import('../src/codex.js');
    await removeConfig();

    const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string;
    expect(writtenContent).toContain('other');
    expect(writtenContent).not.toContain('ceetrix');
  });

  it('handles file not found gracefully', async () => {
    const { readFile } = await import('fs/promises');
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

    const { removeConfig } = await import('../src/codex.js');
    // Should not throw
    await expect(removeConfig()).resolves.toBeUndefined();
  });

  it('does not write when ceetrix entry does not exist', async () => {
    const { readFile, writeFile } = await import('fs/promises');
    const toml = [
      '[mcp_servers.other]',
      'url = "https://other.com"',
    ].join('\n');
    vi.mocked(readFile).mockResolvedValue(toml as any);
    vi.mocked(writeFile).mockResolvedValue();

    const { removeConfig } = await import('../src/codex.js');
    await removeConfig();

    expect(vi.mocked(writeFile)).not.toHaveBeenCalled();
  });
});
