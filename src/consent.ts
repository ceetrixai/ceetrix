/**
 * T&C consent prompt for CLI setup flow (Story 463)
 *
 * Displays a boxed consent prompt with links to the Terms of Service
 * and Privacy Policy. Must be accepted before setup can proceed.
 */

import { confirm } from '@inquirer/prompts';
import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { parse } from 'smol-toml';
import {
  CODEX_CONFIG_DIR,
  CODEX_CONFIG_FILE,
  CODEX_MCP_SERVER_NAME,
  getApiBaseUrl,
} from './constants.js';

/** Current terms version — must match server-side CURRENT_TERMS_VERSION */
export const CURRENT_TERMS_VERSION = '2026-03-23';

/** Marketing site base URL for legal pages */
const LEGAL_BASE_URL = 'https://ceetrix.com';
const CLAUDE_CONFIG_FILE = '.claude.json';

interface ClaudeConfig {
  mcpServers?: Record<string, {
    headers?: Record<string, string>;
  }>;
}

interface CodexConfig {
  mcp_servers?: Record<string, {
    http_headers?: Record<string, string>;
  }>;
}

interface AuthMeResponse {
  authenticated?: boolean;
  termsAcceptedVersion?: string | null;
  currentTermsVersion?: string;
}

export interface StoredConsentStatus {
  acceptedCurrentVersion: boolean;
  currentTermsVersion: string;
  warning?: string;
}

function getClaudeConfigPath(homeDir = homedir()): string {
  return join(homeDir, CLAUDE_CONFIG_FILE);
}

function getCodexConfigPath(homeDir = homedir()): string {
  return join(homeDir, CODEX_CONFIG_DIR, CODEX_CONFIG_FILE);
}

async function readApiKeyFromJsonConfig(configPath: string): Promise<string | null> {
  try {
    const content = await readFile(configPath, 'utf-8');
    const config = JSON.parse(content) as ClaudeConfig;
    return config.mcpServers?.ceetrix?.headers?.['X-API-Key'] ?? null;
  } catch {
    return null;
  }
}

async function readApiKeyFromCodexConfig(configPath: string): Promise<string | null> {
  try {
    const content = await readFile(configPath, 'utf-8');
    const config = parse(content) as CodexConfig;
    return config.mcp_servers?.[CODEX_MCP_SERVER_NAME]?.http_headers?.['X-API-Key'] ?? null;
  } catch {
    return null;
  }
}

async function readStoredApiKey(configPath: string | null): Promise<string | null> {
  if (configPath) {
    return readApiKeyFromJsonConfig(configPath);
  }

  const claudeApiKey = await readApiKeyFromJsonConfig(getClaudeConfigPath());
  if (claudeApiKey) {
    return claudeApiKey;
  }

  return readApiKeyFromCodexConfig(getCodexConfigPath());
}

export async function getStoredConsentStatus(
  configPath: string | null
): Promise<StoredConsentStatus | null> {
  const apiKey = await readStoredApiKey(configPath);
  if (!apiKey) {
    return null;
  }

  try {
    const response = await fetch(`${getApiBaseUrl()}/auth/me`, {
      headers: {
        'Accept': 'application/json',
        'X-API-Key': apiKey,
      },
    });

    if (!response.ok) {
      return {
        acceptedCurrentVersion: false,
        currentTermsVersion: CURRENT_TERMS_VERSION,
        warning: 'Could not verify existing consent status. Consent will be requested again.',
      };
    }

    const data = await response.json() as AuthMeResponse;
    if (data.authenticated !== true || !data.currentTermsVersion) {
      return {
        acceptedCurrentVersion: false,
        currentTermsVersion: CURRENT_TERMS_VERSION,
        warning: 'Stored API key did not confirm current consent status. Consent will be requested again.',
      };
    }

    return {
      acceptedCurrentVersion: data.termsAcceptedVersion === data.currentTermsVersion,
      currentTermsVersion: data.currentTermsVersion,
    };
  } catch {
    return {
      acceptedCurrentVersion: false,
      currentTermsVersion: CURRENT_TERMS_VERSION,
      warning: 'Could not reach Ceetrix to verify existing consent status. Consent will be requested again.',
    };
  }
}

/**
 * Display the T&C consent prompt and require explicit agreement.
 * Exits the process if the user declines.
 *
 * @returns true if accepted (never returns false — exits on decline)
 */
export async function requestConsentOrExit(): Promise<void> {
  console.log('');
  console.log('┌─ Terms of Service & Privacy Policy ─────────────────────────┐');
  console.log('│                                                              │');
  console.log('│  By continuing, you agree to:                               │');
  console.log('│                                                              │');
  console.log(`│  • Terms of Service                                         │`);
  console.log(`│    ${(LEGAL_BASE_URL + '/tos').padEnd(56)}│`);
  console.log('│                                                              │');
  console.log(`│  • Privacy Policy                                           │`);
  console.log(`│    ${(LEGAL_BASE_URL + '/privacy').padEnd(56)}│`);
  console.log('│                                                              │');
  console.log('│  Your specifications are processed by Google Gemini.        │');
  console.log('│  See Privacy Policy for details.                            │');
  console.log('│                                                              │');
  console.log('└──────────────────────────────────────────────────────────────┘');
  console.log('');

  const agreed = await confirm({
    message: 'Do you agree to the Terms of Service and Privacy Policy?',
    default: true,
  });

  if (!agreed) {
    console.log('\nYou must agree to the Terms of Service and Privacy Policy to use Ceetrix.\n');
    process.exit(0);
  }
}
