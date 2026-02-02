/**
 * Constants for ceetrix CLI
 *
 * Note: Functions are used for env-based values to ensure they're read at runtime,
 * not at build time when TypeScript compiles.
 */

/** Base URL for Ceetrix API, can be overridden via CEETRIX_API_URL env var */
export function getApiBaseUrl(): string {
  return process.env.CEETRIX_API_URL || 'https://api.ceetrix.com';
}

/** Setup endpoint URL */
export function getSetupUrl(): string {
  return `${getApiBaseUrl()}/setup`;
}

/** Authentication timeout in milliseconds (5 minutes) */
export const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

/** Default port for local callback server */
export const DEFAULT_PORT = 54321;

/** Ports to try for callback server if default is in use */
export const PORT_RANGE = [54321, 54322, 54323, 54324, 54325];

/** MCP server URL for Claude Code config (HTTP transport) */
export function getMcpServerUrl(): string {
  // Explicit CEETRIX_MCP_URL takes precedence
  if (process.env.CEETRIX_MCP_URL) {
    return process.env.CEETRIX_MCP_URL;
  }

  // If custom API URL is set, derive MCP URL from it (append /sse)
  // This prevents the common mistake of setting CEETRIX_API_URL but forgetting CEETRIX_MCP_URL
  if (process.env.CEETRIX_API_URL) {
    const apiUrl = process.env.CEETRIX_API_URL.replace(/\/+$/, '');
    return `${apiUrl}/sse`;
  }

  // Default to production
  return 'https://api.ceetrix.com/mcp';
}

// --- Device Flow constants (Story 224) ---

/** GitHub device authorization endpoint (RFC 8628) */
export const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';

/** GitHub device token polling endpoint */
export const GITHUB_DEVICE_TOKEN_URL = 'https://github.com/login/oauth/access_token';

/** OAuth grant type for device authorization (RFC 8628 section 3.4) */
export const DEVICE_FLOW_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

/** Minimum poll interval in seconds per RFC 8628 section 3.5 */
export const DEVICE_POLL_INTERVAL_SECONDS = 5;

/** Interval increase when GitHub returns slow_down (seconds, RFC 8628 section 3.5) */
export const DEVICE_POLL_SLOWDOWN_INCREMENT_SECONDS = 5;

/** Maximum time to wait for device flow authorization (seconds). Matches GitHub's device_code expiry. */
export const DEVICE_FLOW_TIMEOUT_SECONDS = 900;

/** Client-id endpoint path */
export const CLIENT_ID_PATH = '/setup/client-id';

/** Device completion endpoint path */
export const DEVICE_COMPLETE_PATH = '/setup/device-complete';

/** Client-id endpoint URL */
export function getClientIdUrl(): string {
  return `${getApiBaseUrl()}${CLIENT_ID_PATH}`;
}

/** Device completion endpoint URL */
export function getDeviceCompleteUrl(): string {
  return `${getApiBaseUrl()}${DEVICE_COMPLETE_PATH}`;
}

// --- End Device Flow constants ---

/** Production API base URL (for comparison) */
const PRODUCTION_API_URL = 'https://api.ceetrix.com';

/**
 * Check if we're using a custom (non-production) API URL.
 *
 * @returns true if CEETRIX_API_URL is set to something other than production
 */
export function isCustomApiUrl(): boolean {
  const apiUrl = process.env.CEETRIX_API_URL;
  if (!apiUrl) return false;

  // Normalize by removing trailing slashes
  const normalized = apiUrl.replace(/\/+$/, '');
  return normalized !== PRODUCTION_API_URL;
}

/**
 * Get the auto-generated config file path for custom API URLs.
 *
 * Extracts the hostname from CEETRIX_API_URL and creates a path like:
 *   ~/.claude-ceetrix-staging-api.json (for staging-api.ceetrix.com)
 *   ~/.claude-ceetrix-localhost.json (for localhost:8787)
 *
 * @returns Config file path, or null if using production URL
 */
export function getAutoConfigPath(): string | null {
  const apiUrl = process.env.CEETRIX_API_URL;
  if (!apiUrl || !isCustomApiUrl()) return null;

  try {
    const url = new URL(apiUrl);
    // Extract hostname, replace dots/colons with dashes for filename safety
    const hostname = url.host.replace(/[.:]/g, '-');
    return `${process.env.HOME}/.claude-ceetrix-${hostname}.json`;
  } catch {
    // Invalid URL - shouldn't happen but handle gracefully
    return `${process.env.HOME}/.claude-ceetrix-custom.json`;
  }
}
