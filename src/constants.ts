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

/** MCP server URL for Claude Code config (SSE transport for compatibility) */
export function getMcpServerUrl(): string {
  return process.env.CEETRIX_MCP_URL || 'https://api.ceetrix.com/sse';
}
