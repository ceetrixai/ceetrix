/**
 * The hook program's server client (story 510).
 *
 * Credentials: CEETRIX_API_URL and CEETRIX_API_KEY when both are set (tests,
 * local runs); otherwise the Ceetrix MCP server Claude Code is configured
 * with in ~/.claude.json, project scope for this repo first, then user scope.
 * The base URL is that server's URL with a trailing /mcp or /sse removed.
 *
 * Every request is abandoned after SERVER_REQUEST_TIMEOUT_MS (or the given
 * timeout) and reported as unreachable.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { SERVER_REQUEST_TIMEOUT_MS } from './constants.js';

export interface Credentials {
  baseUrl: string;
  apiKey: string;
}

const CLAUDE_CONFIG_FILE = '.claude.json';
const MCP_SERVER_NAME = 'ceetrix';
const API_KEY_HEADER = 'X-API-Key';
const ENDPOINT_SUFFIX = /\/(?:mcp|sse)\/?$/;
const TRAILING_SLASHES = /\/+$/;

interface McpServerEntry {
  url?: unknown;
  headers?: Record<string, unknown>;
}

function fromEntry(entry: McpServerEntry | undefined): Credentials | null {
  if (!entry || typeof entry.url !== 'string') return null;
  const key = entry.headers?.[API_KEY_HEADER];
  if (typeof key !== 'string' || key.length === 0) return null;
  return { baseUrl: entry.url.replace(ENDPOINT_SUFFIX, '').replace(TRAILING_SLASHES, ''), apiKey: key };
}

export function resolveCredentials(
  env: Record<string, string | undefined>,
  homeDir: string,
  repoRoot: string,
): Credentials | null {
  if (env.CEETRIX_API_URL && env.CEETRIX_API_KEY) {
    return { baseUrl: env.CEETRIX_API_URL.replace(TRAILING_SLASHES, ''), apiKey: env.CEETRIX_API_KEY };
  }
  let config: {
    mcpServers?: Record<string, McpServerEntry>;
    projects?: Record<string, { mcpServers?: Record<string, McpServerEntry> }>;
  };
  try {
    config = JSON.parse(readFileSync(join(homeDir, CLAUDE_CONFIG_FILE), 'utf8'));
  } catch {
    return null;
  }
  return (
    fromEntry(config.projects?.[repoRoot]?.mcpServers?.[MCP_SERVER_NAME]) ??
    fromEntry(config.mcpServers?.[MCP_SERVER_NAME])
  );
}

export type ClientResult =
  | { kind: 'ok'; status: number; body: any }
  | { kind: 'http_error'; status: number; body: any }
  | { kind: 'unreachable'; error: string };

export interface ClientSpec {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface HookClient {
  post(path: string, body: unknown, timeoutMs?: number): Promise<ClientResult>;
  get(path: string, query: Record<string, string>): Promise<ClientResult>;
}

export function createClient(spec: ClientSpec): HookClient {
  const fetchImpl = spec.fetchImpl ?? fetch;
  const defaultTimeout = spec.timeoutMs ?? SERVER_REQUEST_TIMEOUT_MS;

  async function request(url: string, init: RequestInit, timeoutMs: number): Promise<ClientResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { ...init, signal: controller.signal });
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      return response.ok
        ? { kind: 'ok', status: response.status, body }
        : { kind: 'http_error', status: response.status, body };
    } catch (err) {
      return { kind: 'unreachable', error: (err as Error).message };
    } finally {
      clearTimeout(timer);
    }
  }

  const headers = { 'Content-Type': 'application/json', [API_KEY_HEADER]: spec.apiKey };

  return {
    post(path, body, timeoutMs = defaultTimeout) {
      return request(`${spec.baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(body) }, timeoutMs);
    },
    get(path, query) {
      const qs = new URLSearchParams(query).toString();
      return request(`${spec.baseUrl}${path}?${qs}`, { method: 'GET', headers }, defaultTimeout);
    },
  };
}
