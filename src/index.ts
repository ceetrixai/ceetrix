/**
 * Ceetrix CLI - Set up Ceetrix backlog management for Claude Code
 */

import { detectGitRemote, GitDetectionResult } from './git.js';
import { checkExistingConfig, removeExistingConfig } from './config.js';
import { startCallbackServer } from './server.js';
import { openBrowser } from './browser.js';
import { promptForRepo, promptExistingConfig } from './prompts.js';
import { checkClaudeCli, addConfig } from './claude.js';
import { getSetupUrl, AUTH_TIMEOUT_MS } from './constants.js';
import { enforceLatestVersion } from './version-check.js';
import { requestPermissionOrExit } from './permissions.js';

/** Supported platform for this release */
const SUPPORTED_PLATFORM = 'darwin';

/**
 * Main CLI entry point
 */
export async function main(): Promise<void> {
  console.log('\nCeetrix Setup');
  console.log('─────────────\n');

  // Version check - refuse to run outdated cached versions
  await enforceLatestVersion();

  // Platform check - macOS only for now
  if (process.platform !== SUPPORTED_PLATFORM) {
    console.error(`✗ Unsupported platform: ${process.platform}\n`);
    console.error('Ceetrix currently supports macOS + Claude Code only.');
    console.error('Windows and Linux support coming soon.');
    console.error('');
    console.error('Join the Discord for updates: https://ceetrix.com/discord\n');
    process.exit(1);
  }

  // Single upfront permission for all CLI operations
  await requestPermissionOrExit();

  // Check Claude CLI is available
  const claudeAvailable = await checkClaudeCli();
  if (!claudeAvailable) {
    console.error('✗ Claude Code CLI not found\n');
    console.error('Install Claude Code first: https://claude.ai/download');
    console.error('');
    console.error('If Claude Code is installed, run: npx ceetrix --debug');
    console.error('and post the output to: https://ceetrix.com/discord\n');
    process.exit(1);
  }

  // Check if already configured
  const existingConfig = await checkExistingConfig();
  if (existingConfig) {
    const action = await handleExistingConfig();
    if (action === 'cancel' || action === 'done') {
      return;
    }
    // For 'continue', proceed with normal flow
  }

  // Detect or prompt for repo
  const detection = await detectGitRemote();
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

  // Run the setup flow
  await runSetupFlow(repo);
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
      // Continue with normal flow to get new API key
      console.log('Re-authenticating...\n');
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
 * Run the OAuth setup flow.
 *
 * @param repo - The repository to set up (owner/repo)
 */
async function runSetupFlow(repo: string): Promise<void> {
  // Start callback server
  const { port, waitForCallback, close } = await startCallbackServer();

  try {
    // Build setup URL
    const callbackUrl = `http://localhost:${port}/callback`;
    const setupUrl = `${getSetupUrl()}?callback=${encodeURIComponent(callbackUrl)}&repo=${encodeURIComponent(repo)}`;

    // Open browser
    const opened = await openBrowser(setupUrl);
    if (!opened) {
      console.log('Could not open browser automatically.');
      console.log('Please open this URL manually:\n');
      console.log(`  ${setupUrl}\n`);
    } else {
      console.log('Opening browser for GitHub authentication...');
    }

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

    // Add to Claude config
    console.log('Adding Ceetrix to Claude Code...');
    await addConfig(result.apiKey);
    console.log('✓ Configuration added\n');

    // Show restart notice
    printRestartNotice();
  } finally {
    close();
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
