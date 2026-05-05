import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@inquirer/prompts', () => ({
  confirm: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

vi.mock('../src/constants.js', async () => {
  const actual = await vi.importActual('../src/constants.js') as Record<string, unknown>;
  return {
    ...actual,
    getApiBaseUrl: () => 'https://api.ceetrix.com',
  };
});

describe('consent helpers (Story 463)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads stored API key from custom config and skips prompt when current terms already accepted', async () => {
    const { readFile } = await import('fs/promises');
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({
      mcpServers: {
        ceetrix: {
          headers: {
            'X-API-Key': 'bklg_test_key',
          },
        },
      },
    }));

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      authenticated: true,
      termsAcceptedVersion: '2026-03-23',
      currentTermsVersion: '2026-03-23',
    }), { status: 200 })));

    const { getStoredConsentStatus } = await import('../src/consent.js');
    const status = await getStoredConsentStatus('/tmp/test-config.json');

    expect(status).toEqual({
      acceptedCurrentVersion: true,
      currentTermsVersion: '2026-03-23',
    });
  });

  it('returns an explicit warning when consent status cannot be verified', async () => {
    const { readFile } = await import('fs/promises');
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({
      mcpServers: {
        ceetrix: {
          headers: {
            'X-API-Key': 'bklg_test_key',
          },
        },
      },
    }));

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 401 })));

    const { getStoredConsentStatus } = await import('../src/consent.js');
    const status = await getStoredConsentStatus('/tmp/test-config.json');

    expect(status).toEqual({
      acceptedCurrentVersion: false,
      currentTermsVersion: '2026-03-23',
      warning: 'Could not verify existing consent status. Consent will be requested again.',
    });
  });

  it('exits with an explanatory message when the user declines consent', async () => {
    const { confirm } = await import('@inquirer/prompts');
    vi.mocked(confirm).mockResolvedValue(false);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { requestConsentOrExit } = await import('../src/consent.js');

    await expect(requestConsentOrExit()).rejects.toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(logSpy).toHaveBeenCalledWith(
      '\nYou must agree to the Terms of Service and Privacy Policy to use Ceetrix.\n'
    );

    exitSpy.mockRestore();
    logSpy.mockRestore();
  });
});
