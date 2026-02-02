import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock all dependencies
vi.mock('../src/git.js', () => ({
  detectGitRemote: vi.fn(),
}));

vi.mock('../src/config.js', () => ({
  checkExistingConfig: vi.fn(),
  removeExistingConfig: vi.fn(),
}));

vi.mock('../src/server.js', () => ({
  startCallbackServer: vi.fn(),
}));

vi.mock('../src/browser.js', () => ({
  openBrowser: vi.fn(),
  canLaunchBrowser: vi.fn().mockReturnValue(true),
}));

vi.mock('../src/prompts.js', () => ({
  promptForRepo: vi.fn(),
  promptExistingConfig: vi.fn(),
}));

vi.mock('../src/claude.js', () => ({
  checkClaudeCli: vi.fn(),
  addConfig: vi.fn(),
  writeConfigToFile: vi.fn(),
}));

vi.mock('../src/constants.js', () => ({
  getSetupUrl: () => 'https://app.ceetrix.com/setup',
  AUTH_TIMEOUT_MS: 100, // Short timeout for tests
  getMcpServerUrl: () => 'https://mcp.ceetrix.com',
  isCustomApiUrl: () => false,
  getAutoConfigPath: () => null,
}));

// Mock permissions - auto-grant in tests
vi.mock('../src/permissions.js', () => ({
  requestPermissionOrExit: vi.fn().mockResolvedValue(undefined),
  hasPermission: vi.fn().mockReturnValue(true),
  resetPermission: vi.fn(),
}));

// Mock version check - skip in tests
vi.mock('../src/version-check.js', () => ({
  enforceLatestVersion: vi.fn().mockResolvedValue(undefined),
}));

// Mock invite flow - skip in tests
vi.mock('../src/invite.js', () => ({
  runInviteFlow: vi.fn().mockResolvedValue(undefined),
}));

// Mock device flow (Story 224)
vi.mock('../src/device-flow.js', () => ({
  runDeviceFlow: vi.fn(),
}));

import { main } from '../src/index.js';
import { detectGitRemote } from '../src/git.js';
import { checkExistingConfig } from '../src/config.js';
import { startCallbackServer } from '../src/server.js';
import { openBrowser, canLaunchBrowser } from '../src/browser.js';
import { promptForRepo, promptExistingConfig } from '../src/prompts.js';
import { checkClaudeCli, addConfig } from '../src/claude.js';
import { runDeviceFlow } from '../src/device-flow.js';

const mockDetectGitRemote = vi.mocked(detectGitRemote);
const mockCheckExistingConfig = vi.mocked(checkExistingConfig);
const mockStartCallbackServer = vi.mocked(startCallbackServer);
const mockOpenBrowser = vi.mocked(openBrowser);
const mockCanLaunchBrowser = vi.mocked(canLaunchBrowser);
const mockPromptForRepo = vi.mocked(promptForRepo);
const mockPromptExistingConfig = vi.mocked(promptExistingConfig);
const mockCheckClaudeCli = vi.mocked(checkClaudeCli);
const mockAddConfig = vi.mocked(addConfig);
const mockRunDeviceFlow = vi.mocked(runDeviceFlow);

describe('main flow', () => {
  let mockConsoleLog: ReturnType<typeof vi.spyOn>;
  let mockConsoleError: ReturnType<typeof vi.spyOn>;
  let mockProcessExit: ReturnType<typeof vi.spyOn>;
  let closeServer: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default: browser available (most tests exercise browser flow)
    mockCanLaunchBrowser.mockReturnValue(true);

    mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockProcessExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });

    closeServer = vi.fn();
  });

  afterEach(() => {
    mockConsoleLog.mockRestore();
    mockConsoleError.mockRestore();
    mockProcessExit.mockRestore();
  });

  it('exits if Claude CLI is not available', async () => {
    mockCheckClaudeCli.mockResolvedValue(false);

    await expect(main()).rejects.toThrow('process.exit called');

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('Claude Code CLI not found')
    );
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });

  it('detects git remote automatically', async () => {
    mockCheckClaudeCli.mockResolvedValue(true);
    mockCheckExistingConfig.mockResolvedValue(false);
    mockDetectGitRemote.mockResolvedValue({ status: 'detected', repo: 'owner/repo' });
    mockStartCallbackServer.mockResolvedValue({
      port: 54321,
      waitForCallback: () =>
        Promise.resolve({
          apiKey: 'test_key',
          username: 'testuser',
          repos: ['owner/repo'],
        }),
      close: closeServer,
    });
    mockOpenBrowser.mockResolvedValue(true);
    mockAddConfig.mockResolvedValue(undefined);

    await main();

    expect(mockDetectGitRemote).toHaveBeenCalled();
    expect(mockPromptForRepo).not.toHaveBeenCalled();
    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining('Detected repository: github.com/owner/repo')
    );
  });

  it('prompts for repo when git remote not detected', async () => {
    mockCheckClaudeCli.mockResolvedValue(true);
    mockCheckExistingConfig.mockResolvedValue(false);
    mockDetectGitRemote.mockResolvedValue({ status: 'no-git-repo' });
    mockPromptForRepo.mockResolvedValue('manual/repo');
    mockStartCallbackServer.mockResolvedValue({
      port: 54321,
      waitForCallback: () =>
        Promise.resolve({
          apiKey: 'test_key',
          username: 'testuser',
          repos: ['manual/repo'],
        }),
      close: closeServer,
    });
    mockOpenBrowser.mockResolvedValue(true);
    mockAddConfig.mockResolvedValue(undefined);

    await main();

    expect(mockPromptForRepo).toHaveBeenCalled();
  });

  it('falls back to manual entry when git detection throws error', async () => {
    mockCheckClaudeCli.mockResolvedValue(true);
    mockCheckExistingConfig.mockResolvedValue(false);
    // Simulate git command failure (e.g., git not installed)
    mockDetectGitRemote.mockRejectedValue(new Error('git: command not found'));
    mockPromptForRepo.mockResolvedValue('manual/fallback');
    mockStartCallbackServer.mockResolvedValue({
      port: 54321,
      waitForCallback: () =>
        Promise.resolve({
          apiKey: 'test_key',
          username: 'testuser',
          repos: ['manual/fallback'],
        }),
      close: closeServer,
    });
    mockOpenBrowser.mockResolvedValue(true);
    mockAddConfig.mockResolvedValue(undefined);

    await main();

    // Should fall back to manual entry, not crash
    expect(mockPromptForRepo).toHaveBeenCalled();
    expect(mockAddConfig).toHaveBeenCalled();
  });

  it('falls back to manual entry when git returns unparseable output', async () => {
    mockCheckClaudeCli.mockResolvedValue(true);
    mockCheckExistingConfig.mockResolvedValue(false);
    // Simulate corrupt git config or unusual remote format
    mockDetectGitRemote.mockResolvedValue({ status: 'no-remote' });
    mockPromptForRepo.mockResolvedValue('manual/entered');
    mockStartCallbackServer.mockResolvedValue({
      port: 54321,
      waitForCallback: () =>
        Promise.resolve({
          apiKey: 'test_key',
          username: 'testuser',
          repos: ['manual/entered'],
        }),
      close: closeServer,
    });
    mockOpenBrowser.mockResolvedValue(true);
    mockAddConfig.mockResolvedValue(undefined);

    await main();

    // Should prompt for manual entry when remote can't be parsed
    expect(mockPromptForRepo).toHaveBeenCalled();
  });

  it('falls back to device flow when browser fails to open (Story 224)', async () => {
    mockCheckClaudeCli.mockResolvedValue(true);
    mockCheckExistingConfig.mockResolvedValue(false);
    mockDetectGitRemote.mockResolvedValue({ status: 'detected', repo: 'owner/repo' });
    mockStartCallbackServer.mockResolvedValue({
      port: 54321,
      waitForCallback: () =>
        Promise.resolve({
          apiKey: 'test_key',
          username: 'testuser',
          repos: ['owner/repo'],
        }),
      close: closeServer,
    });
    mockOpenBrowser.mockResolvedValue(false);
    mockRunDeviceFlow.mockResolvedValue({
      apiKey: 'device_key',
      username: 'deviceuser',
      repos: ['owner/repo'],
    });
    mockAddConfig.mockResolvedValue(undefined);

    await main();

    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining('Could not open browser')
    );
    // Callback server should be closed before falling back
    expect(closeServer).toHaveBeenCalled();
    // Device flow should be invoked with the repo
    expect(mockRunDeviceFlow).toHaveBeenCalledWith({ repo: 'owner/repo' });
    // Config should be written with device flow result
    expect(mockAddConfig).toHaveBeenCalledWith('device_key');
  });

  it('adds config after successful authentication', async () => {
    mockCheckClaudeCli.mockResolvedValue(true);
    mockCheckExistingConfig.mockResolvedValue(false);
    mockDetectGitRemote.mockResolvedValue({ status: 'detected', repo: 'owner/repo' });
    mockStartCallbackServer.mockResolvedValue({
      port: 54321,
      waitForCallback: () =>
        Promise.resolve({
          apiKey: 'my_api_key',
          username: 'testuser',
          repos: ['owner/repo'],
        }),
      close: closeServer,
    });
    mockOpenBrowser.mockResolvedValue(true);
    mockAddConfig.mockResolvedValue(undefined);

    await main();

    expect(mockAddConfig).toHaveBeenCalledWith('my_api_key');
    expect(mockConsoleLog).toHaveBeenCalledWith('✓ Configuration added\n');
  });

  it('closes server after completion', async () => {
    mockCheckClaudeCli.mockResolvedValue(true);
    mockCheckExistingConfig.mockResolvedValue(false);
    mockDetectGitRemote.mockResolvedValue({ status: 'detected', repo: 'owner/repo' });
    mockStartCallbackServer.mockResolvedValue({
      port: 54321,
      waitForCallback: () =>
        Promise.resolve({
          apiKey: 'test_key',
          username: 'testuser',
          repos: [],
        }),
      close: closeServer,
    });
    mockOpenBrowser.mockResolvedValue(true);
    mockAddConfig.mockResolvedValue(undefined);

    await main();

    expect(closeServer).toHaveBeenCalled();
  });

  it('exits when user cancels from existing config menu', async () => {
    mockCheckClaudeCli.mockResolvedValue(true);
    mockCheckExistingConfig.mockResolvedValue(true);
    mockPromptExistingConfig.mockResolvedValue('cancel');

    await main();

    expect(mockStartCallbackServer).not.toHaveBeenCalled();
  });

  it('prints restart notice after success', async () => {
    mockCheckClaudeCli.mockResolvedValue(true);
    mockCheckExistingConfig.mockResolvedValue(false);
    mockDetectGitRemote.mockResolvedValue({ status: 'detected', repo: 'owner/repo' });
    mockStartCallbackServer.mockResolvedValue({
      port: 54321,
      waitForCallback: () =>
        Promise.resolve({
          apiKey: 'test_key',
          username: 'testuser',
          repos: [],
        }),
      close: closeServer,
    });
    mockOpenBrowser.mockResolvedValue(true);
    mockAddConfig.mockResolvedValue(undefined);

    await main();

    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining('Restart Claude Code')
    );
  });
});

describe('device flow selection (Story 224)', () => {
  let mockConsoleLog: ReturnType<typeof vi.spyOn>;
  let mockConsoleError: ReturnType<typeof vi.spyOn>;
  let mockProcessExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockProcessExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    mockConsoleLog.mockRestore();
    mockConsoleError.mockRestore();
    mockProcessExit.mockRestore();
  });

  it('uses device flow on headless environments', async () => {
    mockCanLaunchBrowser.mockReturnValue(false);
    mockCheckClaudeCli.mockResolvedValue(true);
    mockCheckExistingConfig.mockResolvedValue(false);
    mockDetectGitRemote.mockResolvedValue({ status: 'detected', repo: 'owner/repo' });
    mockRunDeviceFlow.mockResolvedValue({
      apiKey: 'headless_key',
      username: 'headlessuser',
      repos: ['owner/repo'],
    });
    mockAddConfig.mockResolvedValue(undefined);

    await main();

    // Should NOT start callback server (no browser flow)
    expect(mockStartCallbackServer).not.toHaveBeenCalled();
    // Should show headless detection message
    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining('No display server detected')
    );
    // Should call device flow with repo
    expect(mockRunDeviceFlow).toHaveBeenCalledWith({ repo: 'owner/repo' });
    expect(mockAddConfig).toHaveBeenCalledWith('headless_key');
  });

  it('exits with code 1 when device flow returns null', async () => {
    mockCanLaunchBrowser.mockReturnValue(false);
    mockCheckClaudeCli.mockResolvedValue(true);
    mockCheckExistingConfig.mockResolvedValue(false);
    mockDetectGitRemote.mockResolvedValue({ status: 'detected', repo: 'owner/repo' });
    mockRunDeviceFlow.mockResolvedValue(null);

    await expect(main()).rejects.toThrow('process.exit called');

    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });

  it('does not show headless message when canLaunchBrowser is true', async () => {
    mockCanLaunchBrowser.mockReturnValue(true);
    mockCheckClaudeCli.mockResolvedValue(true);
    mockCheckExistingConfig.mockResolvedValue(false);
    mockDetectGitRemote.mockResolvedValue({ status: 'detected', repo: 'owner/repo' });
    mockStartCallbackServer.mockResolvedValue({
      port: 54321,
      waitForCallback: () =>
        Promise.resolve({
          apiKey: 'browser_key',
          username: 'browseruser',
          repos: ['owner/repo'],
        }),
      close: vi.fn(),
    });
    mockOpenBrowser.mockResolvedValue(true);
    mockAddConfig.mockResolvedValue(undefined);

    await main();

    // Should use browser flow, not device flow
    expect(mockStartCallbackServer).toHaveBeenCalled();
    expect(mockRunDeviceFlow).not.toHaveBeenCalled();
    // No headless message
    const logCalls = mockConsoleLog.mock.calls.map(c => c[0]);
    expect(logCalls).not.toContainEqual(
      expect.stringContaining('No display server detected')
    );
  });
});
