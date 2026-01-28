/**
 * Tests for constants and configuration
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getMcpServerUrl, getSetupUrl, AUTH_TIMEOUT_MS, PORT_RANGE, DEFAULT_PORT, isCustomApiUrl, getAutoConfigPath } from '../src/constants.js';

// Helper to save and restore env vars
function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
  }
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe('getMcpServerUrl', () => {
  it('returns production URL by default', () => {
    const url = getMcpServerUrl();
    expect(url).toBe('https://api.ceetrix.com/mcp');
  });

  it('URL uses HTTPS', () => {
    const url = getMcpServerUrl();
    expect(url.startsWith('https://')).toBe(true);
  });

  it('URL ends with /mcp (HTTP transport)', () => {
    const url = getMcpServerUrl();
    expect(url.endsWith('/mcp')).toBe(true);
  });
});

describe('getSetupUrl', () => {
  it('returns production setup URL by default', () => {
    const url = getSetupUrl();
    expect(url).toBe('https://api.ceetrix.com/setup');
  });

  it('URL uses HTTPS', () => {
    const url = getSetupUrl();
    expect(url.startsWith('https://')).toBe(true);
  });

  it('URL ends with /setup', () => {
    const url = getSetupUrl();
    expect(url.endsWith('/setup')).toBe(true);
  });
});

describe('AUTH_TIMEOUT_MS', () => {
  it('is a number', () => {
    expect(typeof AUTH_TIMEOUT_MS).toBe('number');
  });

  it('is 5 minutes in milliseconds', () => {
    expect(AUTH_TIMEOUT_MS).toBe(5 * 60 * 1000);
  });

  it('is at least 30 seconds', () => {
    expect(AUTH_TIMEOUT_MS).toBeGreaterThanOrEqual(30000);
  });

  it('is at most 10 minutes', () => {
    expect(AUTH_TIMEOUT_MS).toBeLessThanOrEqual(600000);
  });
});

describe('PORT_RANGE', () => {
  it('has 5 port options', () => {
    expect(PORT_RANGE).toHaveLength(5);
  });

  it('starts with DEFAULT_PORT', () => {
    expect(PORT_RANGE[0]).toBe(DEFAULT_PORT);
  });

  it('ports are sequential', () => {
    for (let i = 1; i < PORT_RANGE.length; i++) {
      expect(PORT_RANGE[i]).toBe(PORT_RANGE[i - 1] + 1);
    }
  });

  it('all ports are above 1024 (non-privileged)', () => {
    for (const port of PORT_RANGE) {
      expect(port).toBeGreaterThan(1024);
    }
  });
});

describe('DEFAULT_PORT', () => {
  it('is 54321', () => {
    expect(DEFAULT_PORT).toBe(54321);
  });

  it('is a non-privileged port', () => {
    expect(DEFAULT_PORT).toBeGreaterThan(1024);
  });
});

describe('URL consistency', () => {
  it('both URLs use api.ceetrix.com domain', () => {
    withEnv({ CEETRIX_API_URL: undefined, CEETRIX_MCP_URL: undefined }, () => {
      const mcpUrl = getMcpServerUrl();
      const setupUrl = getSetupUrl();

      expect(mcpUrl).toContain('api.ceetrix.com');
      expect(setupUrl).toContain('api.ceetrix.com');
    });
  });

  it('both URLs use ceetrix.com domain', () => {
    withEnv({ CEETRIX_API_URL: undefined, CEETRIX_MCP_URL: undefined }, () => {
      const mcpUrl = getMcpServerUrl();
      const setupUrl = getSetupUrl();

      expect(mcpUrl).toContain('ceetrix.com');
      expect(setupUrl).toContain('ceetrix.com');
    });
  });
});

describe('isCustomApiUrl', () => {
  it('returns false when CEETRIX_API_URL is not set', () => {
    withEnv({ CEETRIX_API_URL: undefined }, () => {
      expect(isCustomApiUrl()).toBe(false);
    });
  });

  it('returns false when CEETRIX_API_URL is production URL', () => {
    withEnv({ CEETRIX_API_URL: 'https://api.ceetrix.com' }, () => {
      expect(isCustomApiUrl()).toBe(false);
    });
  });

  it('returns false when CEETRIX_API_URL is production URL with trailing slash', () => {
    withEnv({ CEETRIX_API_URL: 'https://api.ceetrix.com/' }, () => {
      expect(isCustomApiUrl()).toBe(false);
    });
  });

  it('returns true when CEETRIX_API_URL is staging', () => {
    withEnv({ CEETRIX_API_URL: 'https://staging-api.ceetrix.com' }, () => {
      expect(isCustomApiUrl()).toBe(true);
    });
  });

  it('returns true when CEETRIX_API_URL is localhost', () => {
    withEnv({ CEETRIX_API_URL: 'http://localhost:8787' }, () => {
      expect(isCustomApiUrl()).toBe(true);
    });
  });
});

describe('getAutoConfigPath', () => {
  it('returns null when CEETRIX_API_URL is not set', () => {
    withEnv({ CEETRIX_API_URL: undefined }, () => {
      expect(getAutoConfigPath()).toBeNull();
    });
  });

  it('returns null when CEETRIX_API_URL is production', () => {
    withEnv({ CEETRIX_API_URL: 'https://api.ceetrix.com' }, () => {
      expect(getAutoConfigPath()).toBeNull();
    });
  });

  it('returns path with hostname for staging URL', () => {
    withEnv({ CEETRIX_API_URL: 'https://staging-api.ceetrix.com' }, () => {
      const path = getAutoConfigPath();
      expect(path).toContain('staging-api-ceetrix-com');
      expect(path).toEndWith('.json');
      expect(path).toContain('.claude-ceetrix-');
    });
  });

  it('returns path with hostname for localhost URL', () => {
    withEnv({ CEETRIX_API_URL: 'http://localhost:8787' }, () => {
      const path = getAutoConfigPath();
      expect(path).toContain('localhost-8787');
      expect(path).toEndWith('.json');
    });
  });

  it('converts dots and colons to dashes for filesystem safety', () => {
    withEnv({ CEETRIX_API_URL: 'https://test.api.example.com:9000' }, () => {
      const path = getAutoConfigPath();
      // The hostname part should have dots/colons converted to dashes
      expect(path).toContain('test-api-example-com-9000');
      expect(path).toEndWith('.json');
    });
  });
});

describe('getMcpServerUrl with env vars', () => {
  it('returns production URL when no env vars set', () => {
    withEnv({ CEETRIX_API_URL: undefined, CEETRIX_MCP_URL: undefined }, () => {
      expect(getMcpServerUrl()).toBe('https://api.ceetrix.com/mcp');
    });
  });

  it('uses CEETRIX_MCP_URL when explicitly set', () => {
    withEnv({ CEETRIX_MCP_URL: 'https://custom.example.com/mcp' }, () => {
      expect(getMcpServerUrl()).toBe('https://custom.example.com/mcp');
    });
  });

  it('derives MCP URL from CEETRIX_API_URL when CEETRIX_MCP_URL not set', () => {
    withEnv({ CEETRIX_API_URL: 'https://staging-api.ceetrix.com', CEETRIX_MCP_URL: undefined }, () => {
      expect(getMcpServerUrl()).toBe('https://staging-api.ceetrix.com/sse');
    });
  });

  it('strips trailing slash from CEETRIX_API_URL before appending /sse', () => {
    withEnv({ CEETRIX_API_URL: 'https://staging-api.ceetrix.com/', CEETRIX_MCP_URL: undefined }, () => {
      expect(getMcpServerUrl()).toBe('https://staging-api.ceetrix.com/sse');
    });
  });

  it('CEETRIX_MCP_URL takes precedence over CEETRIX_API_URL', () => {
    withEnv({
      CEETRIX_API_URL: 'https://staging-api.ceetrix.com',
      CEETRIX_MCP_URL: 'https://override.example.com/mcp'
    }, () => {
      expect(getMcpServerUrl()).toBe('https://override.example.com/mcp');
    });
  });
});
