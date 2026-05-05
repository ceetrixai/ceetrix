import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock all dependencies
vi.mock('../src/git.js', () => ({
  detectGitRemote: vi.fn(),
}));

vi.mock('../src/config.js', () => ({
  getAgentStatuses: vi.fn(),
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
  promptAgentWizard: vi.fn(),
}));

vi.mock('../src/claude.js', () => ({
  addConfig: vi.fn(),
  writeConfigToFile: vi.fn(),
}));

vi.mock('../src/codex.js', () => ({
  addConfig: vi.fn(),
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

// Mock consent - auto-accept in tests (Story 463)
vi.mock('../src/consent.js', () => ({
  requestConsentOrExit: vi.fn().mockResolvedValue(undefined),
  getStoredConsentStatus: vi.fn().mockResolvedValue(null),
  CURRENT_TERMS_VERSION: '2026-03-23',
}));

import { main } from '../src/index.js';
import { detectGitRemote } from '../src/git.js';
import { getAgentStatuses } from '../src/config.js';
import { startCallbackServer } from '../src/server.js';
import { openBrowser, canLaunchBrowser } from '../src/browser.js';
import { promptForRepo, promptExistingConfig, promptAgentWizard } from '../src/prompts.js';
import { addConfig } from '../src/claude.js';
import { addConfig as addCodexConfig } from '../src/codex.js';
import { runDeviceFlow } from '../src/device-flow.js';
import { requestConsentOrExit, getStoredConsentStatus } from '../src/consent.js';

const mockDetectGitRemote = vi.mocked(detectGitRemote);
const mockGetAgentStatuses = vi.mocked(getAgentStatuses);
const mockStartCallbackServer = vi.mocked(startCallbackServer);
const mockOpenBrowser = vi.mocked(openBrowser);
const mockCanLaunchBrowser = vi.mocked(canLaunchBrowser);
const mockPromptForRepo = vi.mocked(promptForRepo);
const mockPromptExistingConfig = vi.mocked(promptExistingConfig);
const mockPromptAgentWizard = vi.mocked(promptAgentWizard);
const mockAddConfig = vi.mocked(addConfig);
const mockAddCodexConfig = vi.mocked(addCodexConfig);
const mockRunDeviceFlow = vi.mocked(runDeviceFlow);
const mockRequestConsentOrExit = vi.mocked(requestConsentOrExit);
const mockGetStoredConsentStatus = vi.mocked(getStoredConsentStatus);

/** Helper: standard statuses where only Claude is detected and unconfigured */
function claudeOnlyStatuses() {
  return {
    claude: { detected: true, configured: false },
    codex: { detected: false, configured: false },
  };
}

/** Helper: standard browser flow server setup */
function setupBrowserFlow(closeServer: ReturnType<typeof vi.fn>, apiKey = 'test_key', username = 'testuser', repos = ['owner/repo']) {
  mockStartCallbackServer.mockResolvedValue({
    port: 54321,
    waitForCallback: () =>
      Promise.resolve({ apiKey, username, repos }),
    close: closeServer,
  });
  mockOpenBrowser.mockResolvedValue(true);
}

describe('main flow', () => {
  let mockConsoleLog: ReturnType<typeof vi.spyOn>;
  let mockConsoleError: ReturnType<typeof vi.spyOn>;
  let mockProcessExit: ReturnType<typeof vi.spyOn>;
  let closeServer: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStoredConsentStatus.mockResolvedValue(null);

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
    vi.unstubAllGlobals();
    mockConsoleLog.mockRestore();
    mockConsoleError.mockRestore();
    mockProcessExit.mockRestore();
  });

  it('exits if no supported agent is available', async () => {
    mockGetAgentStatuses.mockResolvedValue({
      claude: { detected: false, configured: false },
      codex: { detected: false, configured: false },
    });

    await expect(main()).rejects.toThrow('process.exit called');

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('No supported coding agent found')
    );
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });

  it('detects git remote automatically', async () => {
    mockGetAgentStatuses.mockResolvedValue(claudeOnlyStatuses());
    // Single unconfigured agent auto-selected by wizard
    mockPromptAgentWizard.mockResolvedValue(['claude']);
    mockDetectGitRemote.mockResolvedValue({ status: 'detected', repo: 'owner/repo' });
    setupBrowserFlow(closeServer);
    mockAddConfig.mockResolvedValue(undefined);

    await main();

    expect(mockDetectGitRemote).toHaveBeenCalled();
    expect(mockPromptForRepo).not.toHaveBeenCalled();
    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining('Detected repository: github.com/owner/repo')
    );
  });

  it('prompts for repo when git remote not detected', async () => {
    mockGetAgentStatuses.mockResolvedValue(claudeOnlyStatuses());
    mockPromptAgentWizard.mockResolvedValue(['claude']);
    mockDetectGitRemote.mockResolvedValue({ status: 'no-git-repo' });
    mockPromptForRepo.mockResolvedValue('manual/repo');
    setupBrowserFlow(closeServer);
    mockAddConfig.mockResolvedValue(undefined);

    await main();

    expect(mockPromptForRepo).toHaveBeenCalled();
  });

  it('falls back to manual entry when git detection throws error', async () => {
    mockGetAgentStatuses.mockResolvedValue(claudeOnlyStatuses());
    mockPromptAgentWizard.mockResolvedValue(['claude']);
    // Simulate git command failure (e.g., git not installed)
    mockDetectGitRemote.mockRejectedValue(new Error('git: command not found'));
    mockPromptForRepo.mockResolvedValue('manual/fallback');
    setupBrowserFlow(closeServer);
    mockAddConfig.mockResolvedValue(undefined);

    await main();

    // Should fall back to manual entry, not crash
    expect(mockPromptForRepo).toHaveBeenCalled();
    expect(mockAddConfig).toHaveBeenCalled();
  });

  it('falls back to manual entry when git returns unparseable output', async () => {
    mockGetAgentStatuses.mockResolvedValue(claudeOnlyStatuses());
    mockPromptAgentWizard.mockResolvedValue(['claude']);
    // Simulate corrupt git config or unusual remote format
    mockDetectGitRemote.mockResolvedValue({ status: 'no-remote' });
    mockPromptForRepo.mockResolvedValue('manual/entered');
    setupBrowserFlow(closeServer);
    mockAddConfig.mockResolvedValue(undefined);

    await main();

    // Should prompt for manual entry when remote can't be parsed
    expect(mockPromptForRepo).toHaveBeenCalled();
  });

  it('falls back to device flow when browser fails to open (Story 224)', async () => {
    mockGetAgentStatuses.mockResolvedValue(claudeOnlyStatuses());
    mockPromptAgentWizard.mockResolvedValue(['claude']);
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
    // Device flow should be invoked with repo and terms version
    expect(mockRunDeviceFlow).toHaveBeenCalledWith({ repo: 'owner/repo', termsVersion: '2026-03-23' });
    // Config should be written with device flow result
    expect(mockAddConfig).toHaveBeenCalledWith('device_key');
  });

  it('adds config after successful authentication', async () => {
    mockGetAgentStatuses.mockResolvedValue(claudeOnlyStatuses());
    mockPromptAgentWizard.mockResolvedValue(['claude']);
    mockDetectGitRemote.mockResolvedValue({ status: 'detected', repo: 'owner/repo' });
    setupBrowserFlow(closeServer, 'my_api_key');
    mockAddConfig.mockResolvedValue(undefined);

    await main();

    expect(mockAddConfig).toHaveBeenCalledWith('my_api_key');
    expect(mockConsoleLog).toHaveBeenCalledWith('✓ Configuration added\n');
  });

  it('skips consent prompt when stored API key already accepted current terms', async () => {
    mockGetAgentStatuses.mockResolvedValue(claudeOnlyStatuses());
    mockGetStoredConsentStatus.mockResolvedValue({
      acceptedCurrentVersion: true,
      currentTermsVersion: '2026-03-23',
    });
    mockPromptAgentWizard.mockResolvedValue(['claude']);
    mockDetectGitRemote.mockResolvedValue({ status: 'detected', repo: 'owner/repo' });
    setupBrowserFlow(closeServer, 'my_api_key');
    mockAddConfig.mockResolvedValue(undefined);

    await main();

    expect(mockRequestConsentOrExit).not.toHaveBeenCalled();
    expect(mockConsoleLog).toHaveBeenCalledWith('✓ Terms already accepted\n');
  });

  it('uses server terms version when consent must be recorded again', async () => {
    mockCanLaunchBrowser.mockReturnValue(false);
    mockGetAgentStatuses.mockResolvedValue(claudeOnlyStatuses());
    mockGetStoredConsentStatus.mockResolvedValue({
      acceptedCurrentVersion: false,
      currentTermsVersion: '2026-04-01',
    });
    mockPromptAgentWizard.mockResolvedValue(['claude']);
    mockDetectGitRemote.mockResolvedValue({ status: 'detected', repo: 'owner/repo' });
    mockRunDeviceFlow.mockResolvedValue({
      apiKey: 'device_key',
      username: 'testuser',
      repos: ['owner/repo'],
    });
    mockAddConfig.mockResolvedValue(undefined);

    await main();

    expect(mockRequestConsentOrExit).toHaveBeenCalled();
    expect(mockRunDeviceFlow).toHaveBeenCalledWith({
      repo: 'owner/repo',
      termsVersion: '2026-04-01',
    });
  });

  it('closes server after completion', async () => {
    mockGetAgentStatuses.mockResolvedValue(claudeOnlyStatuses());
    mockPromptAgentWizard.mockResolvedValue(['claude']);
    mockDetectGitRemote.mockResolvedValue({ status: 'detected', repo: 'owner/repo' });
    setupBrowserFlow(closeServer, 'test_key', 'testuser', []);
    mockAddConfig.mockResolvedValue(undefined);

    await main();

    expect(closeServer).toHaveBeenCalled();
  });

  it('exits when user cancels from existing config menu', async () => {
    // All detected agents are configured → existing config menu
    mockGetAgentStatuses.mockResolvedValue({
      claude: { detected: true, configured: true },
      codex: { detected: false, configured: false },
    });
    mockPromptExistingConfig.mockResolvedValue('cancel');

    await main();

    expect(mockStartCallbackServer).not.toHaveBeenCalled();
  });

  it('prints restart notice after success', async () => {
    mockGetAgentStatuses.mockResolvedValue(claudeOnlyStatuses());
    mockPromptAgentWizard.mockResolvedValue(['claude']);
    mockDetectGitRemote.mockResolvedValue({ status: 'detected', repo: 'owner/repo' });
    setupBrowserFlow(closeServer, 'test_key', 'testuser', []);
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
    mockGetAgentStatuses.mockResolvedValue(claudeOnlyStatuses());
    mockPromptAgentWizard.mockResolvedValue(['claude']);
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
    // Should call device flow with repo and terms version
    expect(mockRunDeviceFlow).toHaveBeenCalledWith({ repo: 'owner/repo', termsVersion: '2026-03-23' });
    expect(mockAddConfig).toHaveBeenCalledWith('headless_key');
  });

  it('exits with code 1 when device flow returns null', async () => {
    mockCanLaunchBrowser.mockReturnValue(false);
    mockGetAgentStatuses.mockResolvedValue(claudeOnlyStatuses());
    mockPromptAgentWizard.mockResolvedValue(['claude']);
    mockDetectGitRemote.mockResolvedValue({ status: 'detected', repo: 'owner/repo' });
    mockRunDeviceFlow.mockResolvedValue(null);

    await expect(main()).rejects.toThrow('process.exit called');

    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });

  it('does not show headless message when canLaunchBrowser is true', async () => {
    mockCanLaunchBrowser.mockReturnValue(true);
    mockGetAgentStatuses.mockResolvedValue(claudeOnlyStatuses());
    mockPromptAgentWizard.mockResolvedValue(['claude']);
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

describe('agent wizard flow (Story 397)', () => {
  let mockConsoleLog: ReturnType<typeof vi.spyOn>;
  let mockConsoleError: ReturnType<typeof vi.spyOn>;
  let mockProcessExit: ReturnType<typeof vi.spyOn>;
  let closeServer: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
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

  it('auto-selects Claude via wizard when only Claude is detected', async () => {
    mockGetAgentStatuses.mockResolvedValue(claudeOnlyStatuses());
    // Wizard auto-selects single unconfigured agent
    mockPromptAgentWizard.mockResolvedValue(['claude']);
    mockDetectGitRemote.mockResolvedValue({ status: 'detected', repo: 'owner/repo' });
    setupBrowserFlow(closeServer);
    mockAddConfig.mockResolvedValue(undefined);

    await main();

    expect(mockPromptAgentWizard).toHaveBeenCalledWith(claudeOnlyStatuses());
    expect(mockAddConfig).toHaveBeenCalledWith('test_key');
  });

  it('auto-selects Codex via wizard when only Codex is detected', async () => {
    const statuses = {
      claude: { detected: false, configured: false },
      codex: { detected: true, configured: false },
    };
    mockGetAgentStatuses.mockResolvedValue(statuses);
    mockPromptAgentWizard.mockResolvedValue(['codex']);
    mockDetectGitRemote.mockResolvedValue({ status: 'detected', repo: 'owner/repo' });
    setupBrowserFlow(closeServer, 'codex_key', 'codexuser');
    mockAddCodexConfig.mockResolvedValue(undefined);

    await main();

    expect(mockPromptAgentWizard).toHaveBeenCalledWith(statuses);
    // Should use Codex config writer, not Claude's
    expect(mockAddCodexConfig).toHaveBeenCalledWith('codex_key', 'https://mcp.ceetrix.com');
    expect(mockAddConfig).not.toHaveBeenCalled();
  });

  it('shows wizard when both agents detected, neither configured', async () => {
    const statuses = {
      claude: { detected: true, configured: false },
      codex: { detected: true, configured: false },
    };
    mockGetAgentStatuses.mockResolvedValue(statuses);
    mockPromptAgentWizard.mockResolvedValue(['claude', 'codex']);
    mockDetectGitRemote.mockResolvedValue({ status: 'detected', repo: 'owner/repo' });
    setupBrowserFlow(closeServer);
    mockAddConfig.mockResolvedValue(undefined);
    mockAddCodexConfig.mockResolvedValue(undefined);

    await main();

    expect(mockPromptAgentWizard).toHaveBeenCalledWith(statuses);
    // Both config writers should be called with same API key
    expect(mockAddConfig).toHaveBeenCalledWith('test_key');
    expect(mockAddCodexConfig).toHaveBeenCalledWith('test_key', 'https://mcp.ceetrix.com');
  });

  it('shows wizard when Claude configured, Codex not', async () => {
    const statuses = {
      claude: { detected: true, configured: true },
      codex: { detected: true, configured: false },
    };
    mockGetAgentStatuses.mockResolvedValue(statuses);
    // Wizard returns only Codex (Claude is disabled)
    mockPromptAgentWizard.mockResolvedValue(['codex']);
    mockDetectGitRemote.mockResolvedValue({ status: 'detected', repo: 'owner/repo' });
    setupBrowserFlow(closeServer, 'codex_key');
    mockAddCodexConfig.mockResolvedValue(undefined);

    await main();

    expect(mockPromptAgentWizard).toHaveBeenCalledWith(statuses);
    // Only Codex should be configured
    expect(mockAddCodexConfig).toHaveBeenCalledWith('codex_key', 'https://mcp.ceetrix.com');
    expect(mockAddConfig).not.toHaveBeenCalled();
  });

  it('shows existing config menu when all detected agents are configured', async () => {
    mockGetAgentStatuses.mockResolvedValue({
      claude: { detected: true, configured: true },
      codex: { detected: true, configured: true },
    });
    mockPromptExistingConfig.mockResolvedValue('cancel');

    await main();

    // Should show existing config menu, not wizard
    expect(mockPromptExistingConfig).toHaveBeenCalled();
    expect(mockPromptAgentWizard).not.toHaveBeenCalled();
    expect(mockStartCallbackServer).not.toHaveBeenCalled();
  });

  it('exits gracefully when user deselects all agents in wizard', async () => {
    mockGetAgentStatuses.mockResolvedValue({
      claude: { detected: true, configured: false },
      codex: { detected: true, configured: false },
    });
    // User deselects all
    mockPromptAgentWizard.mockResolvedValue([]);

    await main();

    expect(mockConsoleLog).toHaveBeenCalledWith('No agents selected.\n');
    expect(mockStartCallbackServer).not.toHaveBeenCalled();
    expect(mockAddConfig).not.toHaveBeenCalled();
  });

  it('prints env var notice after Codex config', async () => {
    mockGetAgentStatuses.mockResolvedValue({
      claude: { detected: false, configured: false },
      codex: { detected: true, configured: false },
    });
    mockPromptAgentWizard.mockResolvedValue(['codex']);
    mockDetectGitRemote.mockResolvedValue({ status: 'detected', repo: 'owner/repo' });
    setupBrowserFlow(closeServer, 'codex_key', 'codexuser');
    mockAddCodexConfig.mockResolvedValue(undefined);

    await main();

    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining('Restart Codex CLI')
    );
  });

  it('configures both agents and prints both notices', async () => {
    mockGetAgentStatuses.mockResolvedValue({
      claude: { detected: true, configured: false },
      codex: { detected: true, configured: false },
    });
    mockPromptAgentWizard.mockResolvedValue(['claude', 'codex']);
    mockDetectGitRemote.mockResolvedValue({ status: 'detected', repo: 'owner/repo' });
    setupBrowserFlow(closeServer, 'shared_key');
    mockAddConfig.mockResolvedValue(undefined);
    mockAddCodexConfig.mockResolvedValue(undefined);

    await main();

    // Both agents configured with same key
    expect(mockAddConfig).toHaveBeenCalledWith('shared_key');
    expect(mockAddCodexConfig).toHaveBeenCalledWith('shared_key', 'https://mcp.ceetrix.com');
    // Both notices printed
    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining('Restart Claude Code')
    );
    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining('Restart Codex CLI')
    );
  });
});
