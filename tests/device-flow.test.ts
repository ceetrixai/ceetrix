/**
 * Unit tests for GitHub OAuth Device Flow (Story 224)
 *
 * Tests the device flow module with mocked fetch calls.
 * No network or database connections.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock constants with zero poll interval — tests run without real delays
vi.mock('../src/constants.js', () => ({
  GITHUB_DEVICE_CODE_URL: 'https://github.com/login/device/code',
  GITHUB_DEVICE_TOKEN_URL: 'https://github.com/login/oauth/access_token',
  DEVICE_FLOW_GRANT_TYPE: 'urn:ietf:params:oauth:grant-type:device_code',
  DEVICE_POLL_INTERVAL_SECONDS: 0,
  DEVICE_POLL_SLOWDOWN_INCREMENT_SECONDS: 0,
  DEVICE_FLOW_TIMEOUT_SECONDS: 900,
  getClientIdUrl: () => 'https://api.ceetrix.com/setup/client-id',
  getDeviceCompleteUrl: () => 'https://api.ceetrix.com/setup/device-complete',
}));

// Mock fetch globally before importing the module
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Must import after mocking fetch and constants
const { runDeviceFlow } = await import('../src/device-flow.js');

/** Helper: create a successful JSON response */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Helper: create an error response */
function errorResponse(status: number, body?: unknown): Response {
  return new Response(body ? JSON.stringify(body) : '', { status });
}

describe('runDeviceFlow (Story 224)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('completes full device flow successfully', async () => {
    // 1. GET /setup/client-id
    mockFetch.mockResolvedValueOnce(jsonResponse({ client_id: 'Iv1.test123' }));

    // 2. POST github.com/login/device/code
    mockFetch.mockResolvedValueOnce(jsonResponse({
      device_code: 'dc_abc123',
      user_code: 'ABCD-1234',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
      interval: 0,
    }));

    // 3. First poll: authorization_pending
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'authorization_pending' }));

    // 4. Second poll: success
    mockFetch.mockResolvedValueOnce(jsonResponse({ access_token: 'gho_test_token' }));

    // 5. POST /setup/device-complete
    mockFetch.mockResolvedValueOnce(jsonResponse({
      api_key: 'ceetrix_testkey',
      username: 'testuser',
      repos: ['owner/repo'],
    }));

    const result = await runDeviceFlow({ repo: 'owner/repo' });

    expect(result).toEqual({
      apiKey: 'ceetrix_testkey',
      username: 'testuser',
      repos: ['owner/repo'],
    });

    // Verify client-id was fetched
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/setup/client-id'),
      expect.objectContaining({ headers: { 'Accept': 'application/json' } }),
    );

    // Verify device code was requested with client_id
    expect(mockFetch).toHaveBeenCalledWith(
      'https://github.com/login/device/code',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ client_id: 'Iv1.test123' }),
      }),
    );

    // Verify device-complete was called with token and repo
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/setup/device-complete'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ access_token: 'gho_test_token', repo: 'owner/repo' }),
      }),
    );
  });

  it('returns null when user denies authorization', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ client_id: 'Iv1.test123' }));
    mockFetch.mockResolvedValueOnce(jsonResponse({
      device_code: 'dc_abc123',
      user_code: 'ABCD-1234',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
      interval: 0,
    }));

    // Poll returns access_denied
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'access_denied' }));

    const result = await runDeviceFlow({ repo: 'owner/repo' });
    expect(result).toBeNull();
  });

  it('returns null when device code expires', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ client_id: 'Iv1.test123' }));
    mockFetch.mockResolvedValueOnce(jsonResponse({
      device_code: 'dc_abc123',
      user_code: 'ABCD-1234',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
      interval: 0,
    }));

    // Poll returns expired_token
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'expired_token' }));

    const result = await runDeviceFlow({ repo: 'owner/repo' });
    expect(result).toBeNull();
  });

  it('returns null and displays install URL when app not installed', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ client_id: 'Iv1.test123' }));
    mockFetch.mockResolvedValueOnce(jsonResponse({
      device_code: 'dc_abc123',
      user_code: 'ABCD-1234',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
      interval: 0,
    }));

    // Poll success
    mockFetch.mockResolvedValueOnce(jsonResponse({ access_token: 'gho_test_token' }));

    // device-complete returns install_url
    mockFetch.mockResolvedValueOnce(jsonResponse({
      api_key: '',
      username: 'testuser',
      repos: [],
      install_url: 'https://github.com/apps/ceetrix/installations/new',
    }));

    const result = await runDeviceFlow({ repo: 'owner/repo' });
    expect(result).toBeNull();
  });

  it('throws when client-id endpoint fails', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(500));

    await expect(runDeviceFlow({ repo: 'owner/repo' })).rejects.toThrow(/Failed to fetch client ID/);
  });

  it('throws when device flow is not enabled on GitHub App', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ client_id: 'Iv1.test123' }));
    mockFetch.mockResolvedValueOnce(jsonResponse({
      error: 'unsupported_grant_type',
      error_description: 'The application does not support the device code grant type.',
    }));

    await expect(runDeviceFlow({ repo: 'owner/repo' })).rejects.toThrow(/Device flow is not enabled/);
  });
});
