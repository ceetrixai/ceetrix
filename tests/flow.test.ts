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
}));

vi.mock('../src/prompts.js', () => ({
  promptForRepo: vi.fn(),
  promptExistingConfig: vi.fn(),
}));

vi.mock('../src/claude.js', () => ({
  checkClaudeCli: vi.fn(),
  addConfig: vi.fn(),
}));

vi.mock('../src/constants.js', () => ({
  getSetupUrl: () => 'https://app.ceetrix.com/setup',
  AUTH_TIMEOUT_MS: 100, // Short timeout for tests
}));

import { main } from '../src/index.js';
import { detectGitRemote } from '../src/git.js';
import { checkExistingConfig } from '../src/config.js';
import { startCallbackServer } from '../src/server.js';
import { openBrowser } from '../src/browser.js';
import { promptForRepo, promptExistingConfig } from '../src/prompts.js';
import { checkClaudeCli, addConfig } from '../src/claude.js';

const mockDetectGitRemote = vi.mocked(detectGitRemote);
const mockCheckExistingConfig = vi.mocked(checkExistingConfig);
const mockStartCallbackServer = vi.mocked(startCallbackServer);
const mockOpenBrowser = vi.mocked(openBrowser);
const mockPromptForRepo = vi.mocked(promptForRepo);
const mockPromptExistingConfig = vi.mocked(promptExistingConfig);
const mockCheckClaudeCli = vi.mocked(checkClaudeCli);
const mockAddConfig = vi.mocked(addConfig);

describe('main flow', () => {
  let mockConsoleLog: ReturnType<typeof vi.spyOn>;
  let mockConsoleError: ReturnType<typeof vi.spyOn>;
  let mockProcessExit: ReturnType<typeof vi.spyOn>;
  let closeServer: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

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

  it('shows URL when browser fails to open', async () => {
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
    mockAddConfig.mockResolvedValue(undefined);

    await main();

    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining('Could not open browser automatically')
    );
    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining('https://app.ceetrix.com/setup')
    );
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
