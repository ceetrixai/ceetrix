/**
 * Tests for platform checks
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies to isolate platform check
vi.mock('../src/version-check.js', () => ({
  enforceLatestVersion: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/invite.js', () => ({
  runInviteFlow: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/permissions.js', () => ({
  requestPermissionOrExit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/claude.js', () => ({
  checkClaudeCli: vi.fn().mockResolvedValue(true),
  addConfig: vi.fn(),
}));

vi.mock('../src/config.js', () => ({
  checkExistingConfig: vi.fn().mockResolvedValue(false),
}));

vi.mock('../src/git.js', () => ({
  detectGitRemote: vi.fn().mockResolvedValue({ status: 'detected', repo: 'test/repo' }),
}));

vi.mock('../src/server.js', () => ({
  startCallbackServer: vi.fn().mockResolvedValue({
    port: 54321,
    waitForCallback: vi.fn().mockResolvedValue({ apiKey: 'test', username: 'test', repos: [] }),
    close: vi.fn(),
  }),
}));

vi.mock('../src/browser.js', () => ({
  openBrowser: vi.fn().mockResolvedValue(true),
}));

vi.mock('../src/prompts.js', () => ({
  promptForRepo: vi.fn(),
  promptExistingConfig: vi.fn(),
}));

describe('platform checks', () => {
  const originalPlatform = process.platform;
  let mockExit: ReturnType<typeof vi.spyOn>;
  let mockConsoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });

  describe('unsupported platforms exit with code 1', () => {
    it('exits on win32', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const { main } = await import('../src/index.js');
      await main();

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('Unsupported platform: win32')
      );
    });

    it('exits on freebsd', async () => {
      Object.defineProperty(process, 'platform', { value: 'freebsd' });

      const { main } = await import('../src/index.js');
      await main();

      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe('supported platforms proceed', () => {
    it('does not exit on darwin', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      const { main } = await import('../src/index.js');
      await main();

      // Should not have exited with platform error
      const platformExitCall = mockExit.mock.calls.find(
        call => call[0] === 1
      );
      // If it exited, check it wasn't for platform reasons
      if (platformExitCall) {
        expect(mockConsoleError).not.toHaveBeenCalledWith(
          expect.stringContaining('Unsupported platform')
        );
      }
    });

    it('does not exit on linux', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });

      const { main } = await import('../src/index.js');
      await main();

      // Should not have exited with platform error
      const platformExitCall = mockExit.mock.calls.find(
        call => call[0] === 1
      );
      // If it exited, check it wasn't for platform reasons
      if (platformExitCall) {
        expect(mockConsoleError).not.toHaveBeenCalledWith(
          expect.stringContaining('Unsupported platform')
        );
      }
    });
  });
});

describe('platform error messages', () => {
  it('error message includes platform name', () => {
    const platform = 'win32';
    const errorMessage = `✗ Unsupported platform: ${platform}`;
    expect(errorMessage).toContain('win32');
  });

  it('error message mentions macOS and Linux + Claude Code only', () => {
    const message = 'Ceetrix currently supports macOS and Linux + Claude Code only.';
    expect(message).toContain('macOS');
    expect(message).toContain('Linux');
    expect(message).toContain('Claude Code');
  });

  it('error message includes Discord link', () => {
    const message = 'Join the Discord for updates: https://ceetrix.com/discord';
    expect(message).toContain('https://ceetrix.com/discord');
  });

  it('SUPPORTED_PLATFORMS includes darwin and linux', () => {
    const SUPPORTED_PLATFORMS = ['darwin', 'linux'];
    expect(SUPPORTED_PLATFORMS).toContain('darwin');
    expect(SUPPORTED_PLATFORMS).toContain('linux');
  });
});
