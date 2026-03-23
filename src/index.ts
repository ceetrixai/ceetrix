/**
 * Ceetrix CLI - Set up Ceetrix backlog management for coding agents
 */

import { detectGitRemote, GitDetectionResult } from './git.js';
import { getAgentStatuses, removeExistingConfig } from './config.js';
import type { AgentStatus } from './config.js';
import { startCallbackServer } from './server.js';
import { openBrowser, canLaunchBrowser } from './browser.js';
import { promptForRepo, promptExistingConfig, promptAgentWizard, AgentType } from './prompts.js';
import { addConfig as addClaudeConfig, writeConfigToFile } from './claude.js';
import { addConfig as addCodexConfig } from './codex.js';
import { getApiBaseUrl, getSetupUrl, AUTH_TIMEOUT_MS, getMcpServerUrl, isCustomApiUrl, getAutoConfigPath } from './constants.js';
import { printDebugInfo } from './debug.js';
import { enforceLatestVersion } from './version-check.js';
import { requestPermissionOrExit } from './permissions.js';
import { requestConsentOrExit, CURRENT_TERMS_VERSION } from './consent.js';
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
    console.error('Ceetrix currently supports macOS and Linux only.');
    console.error('Windows support coming soon.');
    console.error('');
    console.error('Join the Discord for updates: https://ceetrix.com/discord\n');
    process.exit(1);
  }

  // Single upfront permission for all CLI operations (skip if using custom config)
  if (!cliContext.configPath) {
    await requestPermissionOrExit();
  }

  // T&C consent (Story 463) — required before proceeding
  await requestConsentOrExit();

  // Detect available agents and their config status (skip if using custom config)
  let selectedAgents: AgentType[] = ['claude'];

  if (!cliContext.configPath) {
    const statuses = await getAgentStatuses();
    const detected = (Object.entries(statuses) as [AgentType, AgentStatus][])
      .filter(([, s]) => s.detected);

    if (detected.length === 0) {
      console.error('✗ No supported coding agent found\n');
      console.error('Ceetrix works with:');
      console.error('  - Claude Code (v2.0+): https://docs.anthropic.com/en/docs/claude-code');
      console.error('  - OpenAI Codex CLI:    https://github.com/openai/codex');
      console.error('');
      console.error('Run: npx ceetrix --debug');
      console.error('for diagnostic info to share at: https://ceetrix.com/discord\n');
      process.exit(1);
    }

    // If all detected agents are already configured, show existing config menu
    const allConfigured = detected.every(([, s]) => s.configured);
    if (allConfigured) {
      const action = await handleExistingConfig();
      if (action === 'cancel' || action === 'done') {
        return;
      }
      // For 'continue' (re-auth), configure all detected agents
      selectedAgents = detected.map(([agent]) => agent);
    } else {
      // Show wizard for incremental agent selection
      selectedAgents = await promptAgentWizard(statuses);
      if (selectedAgents.length === 0) {
        console.log('No agents selected.\n');
        return;
      }
      console.log('');
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
    await runDeviceSetupFlow(repo, cliContext.configPath, selectedAgents);
  } else {
    await runBrowserSetupFlow(repo, cliContext.configPath, selectedAgents);
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
 * @param configPath - Optional custom config file path (null = use agent's default config)
 * @param agents - Which agents to configure
 */
async function runDeviceSetupFlow(repo: string, configPath: string | null, agents: AgentType[]): Promise<void> {
  const result = await runDeviceFlow({ repo, termsVersion: CURRENT_TERMS_VERSION });

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

  // Write config for each selected agent
  await writeConfig(result.apiKey, configPath, agents);
}

/**
 * Run the browser-based OAuth setup flow (existing behaviour).
 *
 * Opens a browser for GitHub OAuth; receives callback on localhost.
 * Falls back to device flow if the browser fails to open.
 *
 * @param repo - The repository to set up (owner/repo)
 * @param configPath - Optional custom config file path (null = use agent's default config)
 * @param agents - Which agents to configure
 */
async function runBrowserSetupFlow(repo: string, configPath: string | null, agents: AgentType[]): Promise<void> {
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
      await runDeviceSetupFlow(repo, configPath, agents);
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

    // Record T&C consent via API (Story 463)
    await recordConsentViaApi(result.apiKey);

    // Write config for each selected agent
    await writeConfig(result.apiKey, configPath, agents);
  } finally {
    close();
  }
}

/**
 * Record T&C consent via the API after browser-based auth (Story 463).
 * Best-effort — logs warning on failure but does not block setup.
 */
async function recordConsentViaApi(apiKey: string): Promise<void> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/v1/consent/accept`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({
        terms_version: CURRENT_TERMS_VERSION,
        source: 'cli',
      }),
    });
    if (response.ok) {
      console.log('✓ Terms accepted\n');
    }
  } catch {
    // Non-fatal — consent can be recorded on next web login
    console.log('⚠ Could not record consent. You may be prompted again on web login.\n');
  }
}

/**
 * Write MCP config to all selected agents or a custom file.
 *
 * Shared by both browser and device flow paths.
 *
 * @param apiKey - The API key from authentication
 * @param configPath - Custom config file path (null = use agent's default)
 * @param agents - Which agents to configure
 */
async function writeConfig(apiKey: string, configPath: string | null, agents: AgentType[]): Promise<void> {
  if (configPath) {
    // Write directly to custom config file (non-destructive to default configs)
    console.log(`Writing Ceetrix config to ${configPath}...`);
    await writeConfigToFile(apiKey, getMcpServerUrl(), configPath);
    console.log('✓ Configuration written\n');
    printCustomConfigNotice(configPath);
    return;
  }

  const url = getMcpServerUrl();

  for (const agent of agents) {
    switch (agent) {
      case 'claude':
        console.log('Adding Ceetrix to Claude Code...');
        await addClaudeConfig(apiKey);
        console.log('✓ Configuration added\n');
        printRestartNotice();
        break;

      case 'codex':
        console.log('Adding Ceetrix to Codex CLI...');
        await addCodexConfig(apiKey, url);
        console.log('✓ Configuration added\n');
        printCodexRestartNotice();
        break;
    }
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

/**
 * Print restart notice for Codex CLI users.
 */
function printCodexRestartNotice(): void {
  console.log('┌─────────────────────────────────────────────────────────────────┐');
  console.log('│  Restart Codex CLI to activate Ceetrix                          │');
  console.log('│                                                                  │');
  console.log('│  Quit and reopen Codex, then describe a feature you             │');
  console.log('│  want to build and ask Codex to "create a story for it".        │');
  console.log('└─────────────────────────────────────────────────────────────────┘\n');
}
