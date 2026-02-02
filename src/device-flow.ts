/**
 * GitHub OAuth Device Flow (RFC 8628)
 * Story 224: CLI device flow + Linux support
 *
 * For terminal-only environments where a browser can't be opened.
 * The CLI displays a code; the user enters it at github.com/login/device
 * on any device (phone, another computer). The CLI polls until authorized.
 */

import {
  GITHUB_DEVICE_CODE_URL,
  GITHUB_DEVICE_TOKEN_URL,
  DEVICE_FLOW_GRANT_TYPE,
  DEVICE_POLL_INTERVAL_SECONDS,
  DEVICE_POLL_SLOWDOWN_INCREMENT_SECONDS,
  DEVICE_FLOW_TIMEOUT_SECONDS,
  getClientIdUrl,
  getDeviceCompleteUrl,
} from './constants.js';

/** Parameters for running the device flow */
export interface DeviceFlowSpec {
  repo?: string;
}

/** Successful result from device flow completion */
export interface DeviceFlowResult {
  apiKey: string;
  username: string;
  repos: string[];
}

/** GitHub device code response */
interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

/** GitHub device token poll error codes per RFC 8628 */
type DevicePollErrorCode =
  | 'authorization_pending'
  | 'slow_down'
  | 'expired_token'
  | 'access_denied'
  | 'unsupported_grant_type'
  | 'incorrect_device_code';

/** Server response from /setup/device-complete */
interface DeviceCompleteResponse {
  api_key: string;
  username: string;
  repos: string[];
  install_url?: string;
  error?: string;
}

/** Milliseconds per second */
const MS_PER_SECOND = 1000;

/**
 * Fetch the GitHub App client_id from the Ceetrix server.
 *
 * The client_id is needed to initiate device flow with GitHub.
 * It's public by design (appears in every OAuth redirect URL).
 */
async function fetchClientId(): Promise<string> {
  const url = getClientIdUrl();
  const response = await fetch(url, {
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch client ID from ${url} (HTTP ${response.status})`);
  }

  const data = await response.json() as { client_id?: string };
  if (!data.client_id) {
    throw new Error('Server returned empty client_id');
  }

  return data.client_id;
}

/**
 * Request a device code from GitHub.
 *
 * POST https://github.com/login/device/code
 */
async function requestDeviceCode(clientId: string): Promise<DeviceCodeResponse> {
  const response = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ client_id: clientId }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub device code request failed (HTTP ${response.status}): ${text}`);
  }

  const data = await response.json() as DeviceCodeResponse & { error?: string; error_description?: string };
  if (data.error) {
    if (data.error === 'unsupported_grant_type') {
      throw new Error(
        'Device flow is not enabled for this GitHub App.\n' +
        'The app administrator must enable "Device Flow" in GitHub App settings.'
      );
    }
    throw new Error(`GitHub device code error: ${data.error} - ${data.error_description || ''}`);
  }

  return data;
}

/**
 * Display the user code prominently for copy/paste.
 */
function displayUserCode(userCode: string, verificationUri: string): void {
  console.log('');
  console.log('┌─────────────────────────────────────────────┐');
  console.log('│  To authenticate, visit:                     │');
  console.log(`│  ${verificationUri.padEnd(43)}│`);
  console.log('│                                              │');
  console.log(`│  Enter code:  ${userCode.padEnd(31)}│`);
  console.log('└─────────────────────────────────────────────┘');
  console.log('');
  console.log('Waiting for authorization...');
}

/**
 * Sleep for the specified number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Poll GitHub for the access token.
 *
 * Handles authorization_pending, slow_down, expired_token, and access_denied
 * per RFC 8628 section 3.5.
 *
 * @returns access_token on success, null on expiry/denial
 */
async function pollForToken(clientId: string, deviceCode: string, initialInterval: number): Promise<string | null> {
  let intervalSeconds = initialInterval;
  const deadline = Date.now() + DEVICE_FLOW_TIMEOUT_SECONDS * MS_PER_SECOND;

  while (Date.now() < deadline) {
    await sleep(intervalSeconds * MS_PER_SECOND);

    const response = await fetch(GITHUB_DEVICE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: DEVICE_FLOW_GRANT_TYPE,
      }),
    });

    const data = await response.json() as {
      access_token?: string;
      error?: DevicePollErrorCode;
      error_description?: string;
    };

    // Success — got token
    if (data.access_token) {
      return data.access_token;
    }

    switch (data.error) {
      case 'authorization_pending':
        // User hasn't authorized yet — keep polling at current interval
        break;

      case 'slow_down':
        // GitHub is asking us to slow down — increase interval per RFC 8628
        intervalSeconds += DEVICE_POLL_SLOWDOWN_INCREMENT_SECONDS;
        break;

      case 'expired_token':
        console.error('\n✗ Device code expired. Run `npx ceetrix` again to retry.\n');
        return null;

      case 'access_denied':
        console.error('\n✗ Authorization was denied.\n');
        return null;

      case 'unsupported_grant_type':
        console.error('\n✗ Device flow is not enabled for this GitHub App.');
        console.error('  The app administrator must enable "Device Flow" in GitHub App settings.\n');
        return null;

      case 'incorrect_device_code':
        console.error('\n✗ Invalid device code. Run `npx ceetrix` again to retry.\n');
        return null;

      default:
        console.error(`\n✗ Unexpected error: ${data.error} - ${data.error_description || ''}\n`);
        return null;
    }
  }

  console.error('\n✗ Timed out waiting for authorization. Run `npx ceetrix` again to retry.\n');
  return null;
}

/**
 * Complete setup with Ceetrix server.
 *
 * Sends the GitHub access token to POST /setup/device-complete
 * which resolves the user, checks app installation, and returns an API key.
 */
async function completeWithServer(accessToken: string, repo?: string): Promise<DeviceCompleteResponse> {
  const url = getDeviceCompleteUrl();
  const body: Record<string, string> = { access_token: accessToken };
  if (repo) {
    body.repo = repo;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error || `Server error (HTTP ${response.status})`);
  }

  return await response.json() as DeviceCompleteResponse;
}

/**
 * Run the full GitHub OAuth Device Flow.
 *
 * 1. Fetch client_id from Ceetrix server
 * 2. Request device code from GitHub
 * 3. Display user code for copy/paste
 * 4. Poll GitHub until authorized
 * 5. Complete setup with Ceetrix server
 *
 * @returns DeviceFlowResult on success, null on cancellation/expiry/denial
 */
export async function runDeviceFlow(spec: DeviceFlowSpec): Promise<DeviceFlowResult | null> {
  // Step 1: Get client_id
  console.log('Preparing device authentication...');
  const clientId = await fetchClientId();

  // Step 2: Request device code from GitHub
  const deviceCode = await requestDeviceCode(clientId);

  // Step 3: Display code for user
  displayUserCode(deviceCode.user_code, deviceCode.verification_uri);

  // Step 4: Poll for token
  const interval = Math.max(deviceCode.interval, DEVICE_POLL_INTERVAL_SECONDS);
  const accessToken = await pollForToken(clientId, deviceCode.device_code, interval);

  if (!accessToken) {
    return null;
  }

  console.log('✓ GitHub authorization received\n');

  // Step 5: Complete with Ceetrix server
  console.log('Completing setup...');
  const result = await completeWithServer(accessToken, spec.repo);

  // Handle app-not-installed case
  if (result.install_url) {
    console.log('');
    console.log('┌─────────────────────────────────────────────────────────────────┐');
    console.log('│  GitHub App not installed on this repository.                    │');
    console.log('│                                                                  │');
    console.log('│  Install it here:                                                │');
    console.log(`│  ${result.install_url.padEnd(63)}│`);
    console.log('│                                                                  │');
    console.log('│  Then run `npx ceetrix` again to complete setup.                 │');
    console.log('└─────────────────────────────────────────────────────────────────┘');
    console.log('');
    return null;
  }

  return {
    apiKey: result.api_key,
    username: result.username,
    repos: result.repos,
  };
}
