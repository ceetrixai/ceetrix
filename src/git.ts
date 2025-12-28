/**
 * Git remote detection utilities
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/** Timeout for git commands in milliseconds */
const GIT_COMMAND_TIMEOUT_MS = 5000;

/**
 * Result of git remote detection
 */
export type GitDetectionResult =
  | { status: 'detected'; repo: string }
  | { status: 'no-git-repo' }
  | { status: 'no-remote' }
  | { status: 'not-github' };

/**
 * Detect the GitHub repository from git remote origin.
 * @returns Detection result with status and repo if found
 */
export async function detectGitRemote(): Promise<GitDetectionResult> {
  // First check if we're in a git repository
  try {
    await execAsync('git rev-parse --is-inside-work-tree', {
      timeout: GIT_COMMAND_TIMEOUT_MS,
    });
  } catch {
    return { status: 'no-git-repo' };
  }

  // Check for remote origin
  let remoteUrl: string;
  try {
    const { stdout } = await execAsync('git config --get remote.origin.url', {
      timeout: GIT_COMMAND_TIMEOUT_MS,
    });
    remoteUrl = stdout.trim();
  } catch {
    return { status: 'no-remote' };
  }

  // Parse the URL
  const repo = parseGitUrl(remoteUrl);
  if (!repo) {
    return { status: 'not-github' };
  }

  return { status: 'detected', repo };
}

/**
 * Parse a git URL to extract owner/repo.
 * Supports SSH and HTTPS formats.
 *
 * @param url - Git remote URL
 * @returns owner/repo string or null if not a valid GitHub URL
 */
export function parseGitUrl(url: string): string | null {
  if (!url) {
    return null;
  }

  // SSH format: git@github.com:owner/repo.git
  const sshMatch = url.match(/git@github\.com:([^/]+)\/([^/.]+)/);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }

  // HTTPS format: https://github.com/owner/repo.git
  const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (httpsMatch) {
    return `${httpsMatch[1]}/${httpsMatch[2]}`;
  }

  return null;
}
