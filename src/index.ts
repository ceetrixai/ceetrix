/**
 * Ceetrix CLI - Set up Ceetrix backlog management for Claude Code
 */

import { detectGitRemote, GitDetectionResult } from './git.js';
import { checkExistingConfig, removeExistingConfig } from './config.js';
import { startCallbackServer } from './server.js';
import { openBrowser, canLaunchBrowser } from './browser.js';
import { promptForRepo, promptExistingConfig } from './prompts.js';
import { checkClaudeCli, addConfig, writeConfigToFile } from './claude.js';
import { getSetupUrl, AUTH_TIMEOUT_MS, getMcpServerUrl, isCustomApiUrl, getAutoConfigPath } from './constants.js';
import { printDebugInfo } from './debug.js';
import { enforceLatestVersion } from './version-check.js';
import { requestPermissionOrExit } from './permissions.js';
import { runDeviceFlow } from './device-flow.js';

/** CLI context for debug/diagnostics */
interface CliContext {
  debug: boolean;
  configPath: string | null;
  noBrowser: boolean;
}

/** Parse command line arguments */
function parseArgs(): CliContext {
  const args = process.argv.slice(2);

  // Parse --config <path>
  let configPath: string | null = null;
  const configIndex = args.findIndex(arg => arg === '--config' || arg === '-c');
  if (configIndex !== -1 && args[configIndex + 1]) {
    configPath = args[configIndex + 1];
  }

  return {
    debug: args.includes('--debug') || args.includes('-d'),
    configPath,
    noBrowser: args.includes('--no-browser'),
  };
}

/** Supported platforms for this release */
const SUPPORTED_PLATFORMS = ['darwin', 'linux'];

/**
 * Main CLI entry point
 */
export async function main(): Promise<void> {
  const cliContext = parseArgs();

  // Handle --debug flag
  if (cliContext.debug) {
    await printDebugInfo();
    return;
  }

  // Auto-detect custom API URL and use separate config file
  // This prevents clobbering production ~/.claude.json when testing staging
  if (!cliContext.configPath && isCustomApiUrl()) {
    const autoPath = getAutoConfigPath();
    if (autoPath) {
      cliContext.configPath = autoPath;
      console.log('\n⚠️  Custom API URL detected');
      console.log(`   CEETRIX_API_URL = ${process.env.CEETRIX_API_URL}`);
      console.log(`   Config will be saved to: ${autoPath}`);
      console.log('   Your production ~/.claude.json will NOT be modified.\n');
    }
  }

  console.log('\nCeetrix Setup');
  console.log('─────────────\n');

  // Version check - refuse to run outdated cached versions
  await enforceLatestVersion();

  // Platform check - macOS and Linux only
  if (!SUPPORTED_PLATFORMS.includes(process.platform)) {
    console.error(`✗ Unsupported platform: ${process.platform}\n`);
    console.error('Ceetrix currently supports macOS and Linux + Claude Code only.');
    console.error('Windows support coming soon.');
    console.error('');
    console.error('Join the Discord for updates: https://ceetrix.com/discord\n');
    process.exit(1);
  }

  // Single upfront permission for all CLI operations (skip if using custom config)
  if (!cliContext.configPath) {
    await requestPermissionOrExit();
  }

  // Check Claude CLI is available (skip if using custom config - we write directly)
  if (!cliContext.configPath) {
    const claudeAvailable = await checkClaudeCli();
    if (!claudeAvailable) {
      console.error('✗ Claude Code CLI not found or version too old\n');
      console.error('Ceetrix requires Claude Code version 2.0 or later.');
      console.error('Install/update: https://docs.anthropic.com/en/docs/claude-code');
      console.error('');
      console.error('Run: npx ceetrix --debug');
      console.error('for diagnostic info to share at: https://ceetrix.com/discord\n');
      process.exit(1);
    }

    // Check if already configured (only when writing to default location)
    const existingConfig = await checkExistingConfig();
    if (existingConfig) {
      const action = await handleExistingConfig();
      if (action === 'cancel' || action === 'done') {
        return;
      }
      // For 'continue', proceed with normal flow
    }
  } else {
    console.log(`Writing config to: ${cliContext.configPath}\n`);
  }

  // Detect or prompt for repo
  let detection: GitDetectionResult;
  try {
    detection = await detectGitRemote();
  } catch {
    // Git detection failed (e.g., git not installed) - fall back to prompt
    detection = { status: 'no-git-repo' };
  }
  let repo: string;

  if (detection.status === 'detected') {
    console.log(`Detected repository: github.com/${detection.repo}\n`);
    repo = detection.repo;
  } else {
    // Show appropriate message based on detection status
    switch (detection.status) {
      case 'no-git-repo':
        console.log('Not inside a git repository.\n');
        break;
      case 'no-remote':
        console.log('Git repository has no remote origin configured.\n');
        break;
      case 'not-github':
        console.log('Remote origin is not a GitHub repository.\n');
        break;
    }
    repo = await promptForRepo();
  }

  // Select auth flow: device flow for headless/--no-browser, browser flow otherwise
  const useDeviceFlow = cliContext.noBrowser || !canLaunchBrowser();

  if (useDeviceFlow) {
    if (!cliContext.noBrowser) {
      console.log('No display server detected. Using device code authentication.\n');
    }
    await runDeviceSetupFlow(repo, cliContext.configPath);
  } else {
    await runBrowserSetupFlow(repo, cliContext.configPath);
  }
}

/**
 * Handle case when Ceetrix is already configured.
 *
 * @returns Action taken: 'cancel', 'done', or 'continue'
 */
async function handleExistingConfig(): Promise<'cancel' | 'done' | 'continue'> {
  const action = await promptExistingConfig();

  switch (action) {
    case 'cancel':
      return 'cancel';

    case 'remove':
      console.log('Removing Ceetrix configuration...');
      try {
        await removeExistingConfig();
        console.log('✓ Ceetrix removed\n');
      } catch (err) {
        console.error('✗ Failed to remove configuration\n');
        throw err;
      }
      return 'done';

    case 'reauth':
      // Remove existing config before re-authenticating
      console.log('Re-authenticating...');
      try {
        await removeExistingConfig();
      } catch {
        // Ignore removal errors - config may not exist
      }
      console.log('');
      return 'continue';

    case 'add-repo':
      // Continue with normal flow
      console.log('Adding repository...\n');
      return 'continue';

    default:
      return 'cancel';
  }
}

/**
 * Run the device flow setup (Story 224).
 *
 * Uses GitHub OAuth Device Flow (RFC 8628) — no browser needed.
 * The CLI displays a code; user enters it at github.com/login/device on any device.
 *
 * @param repo - The repository to set up (owner/repo)
 * @param configPath - Optional custom config file path (null = use claude mcp add)
 */
async function runDeviceSetupFlow(repo: string, configPath: string | null): Promise<void> {
  const result = await runDeviceFlow({ repo });

  if (!result) {
    // User denied, code expired, or app not installed — messages already printed
    process.exit(1);
  }

  // Show success
  console.log(`✓ Authenticated as @${result.username}`);
  if (result.repos.length > 0) {
    console.log(`✓ Access granted to: ${result.repos.join(', ')}\n`);
  } else {
    console.log('');
  }

  // Write config (same as browser flow)
  await writeConfig(result.apiKey, configPath);
}

/**
 * Run the browser-based OAuth setup flow (existing behaviour).
 *
 * Opens a browser for GitHub OAuth; receives callback on localhost.
 * Falls back to device flow if the browser fails to open.
 *
 * @param repo - The repository to set up (owner/repo)
 * @param configPath - Optional custom config file path (null = use claude mcp add)
 */
async function runBrowserSetupFlow(repo: string, configPath: string | null): Promise<void> {
  // Start callback server
  const { port, waitForCallback, close } = await startCallbackServer();

  try {
    // Build setup URL
    const callbackUrl = `http://localhost:${port}/callback`;
    const setupUrl = `${getSetupUrl()}?callback=${encodeURIComponent(callbackUrl)}&repo=${encodeURIComponent(repo)}`;

    // Try to open browser
    const opened = await openBrowser(setupUrl);
    if (!opened) {
      // Browser failed — fall back to device flow explicitly (not silently)
      close();
      console.log('Could not open browser. Switching to device code authentication.\n');
      await runDeviceSetupFlow(repo, configPath);
      return;
    }

    console.log('Opening browser for GitHub authentication...');
    console.log('Waiting for authentication...\n');

    // Wait for callback with timeout
    const authTimeout = createCancellableTimeout(AUTH_TIMEOUT_MS);
    const result = await Promise.race([
      waitForCallback(),
      authTimeout.promise,
    ]);
    // Cancel the timeout to allow Node.js to exit cleanly
    authTimeout.cancel();

    if (!result) {
      console.error('✗ Authentication timed out\n');
      console.error('Run `npx ceetrix` again to retry.\n');
      process.exit(1);
    }

    // Show success
    console.log(`✓ Authenticated as @${result.username}`);
    if (result.repos.length > 0) {
      console.log(`✓ Access granted to: ${result.repos.join(', ')}\n`);
    } else {
      console.log('');
    }

    // Write config
    await writeConfig(result.apiKey, configPath);
  } finally {
    close();
  }
}

/**
 * Write MCP config to Claude Code or a custom file.
 *
 * Shared by both browser and device flow paths.
 */
async function writeConfig(apiKey: string, configPath: string | null): Promise<void> {
  if (configPath) {
    // Write directly to custom config file (non-destructive to ~/.claude.json)
    console.log(`Writing Ceetrix config to ${configPath}...`);
    await writeConfigToFile(apiKey, getMcpServerUrl(), configPath);
    console.log('✓ Configuration written\n');
    printCustomConfigNotice(configPath);
  } else {
    // Use claude mcp add (writes to ~/.claude.json)
    console.log('Adding Ceetrix to Claude Code...');
    await addConfig(apiKey);
    console.log('✓ Configuration added\n');
    printRestartNotice();
  }
}

/**
 * A cancellable timeout that can be cleared to allow Node.js to exit.
 */
interface CancellableTimeout {
  promise: Promise<null>;
  cancel: () => void;
}

/**
 * Create a cancellable timeout promise.
 *
 * @param ms - Timeout in milliseconds
 * @returns Object with promise and cancel function
 */
function createCancellableTimeout(ms: number): CancellableTimeout {
  let timeoutId: ReturnType<typeof setTimeout>;
  const promise = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => resolve(null), ms);
  });
  return {
    promise,
    cancel: () => clearTimeout(timeoutId),
  };
}

/**
 * Print the restart notice with instructions.
 */
function printRestartNotice(): void {
  console.log('┌─────────────────────────────────────────────────────────────────┐');
  console.log('│  ⚠️  Restart Claude Code to activate Ceetrix                     │');
  console.log('│                                                                  │');
  console.log('│  Claude Code does not auto-detect new MCP servers.               │');
  console.log('│  Quit and reopen Claude Code, then describe a feature you        │');
  console.log('│  want to build and ask Claude to "create a story for it".        │');
  console.log('└─────────────────────────────────────────────────────────────────┘\n');
}

/**
 * Print notice for custom config file usage.
 */
function printCustomConfigNotice(configPath: string): void {
  console.log('┌─────────────────────────────────────────────────────────────────┐');
  console.log('│  Config written to custom file (not ~/.claude.json)             │');
  console.log('│                                                                  │');
  console.log('│  To use this config with Claude:                                 │');
  console.log(`│    claude --mcp-config ${configPath}`);
  console.log('│                                                                  │');
  console.log('│  Your production ~/.claude.json was NOT modified.               │');
  console.log('└─────────────────────────────────────────────────────────────────┘\n');
}
