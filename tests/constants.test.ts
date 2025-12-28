/**
 * Tests for constants and configuration
 */

import { describe, it, expect } from 'vitest';
import { getMcpServerUrl, getSetupUrl, AUTH_TIMEOUT_MS, PORT_RANGE, DEFAULT_PORT } from '../src/constants.js';

describe('getMcpServerUrl', () => {
  it('returns production URL by default', () => {
    const url = getMcpServerUrl();
    expect(url).toBe('https://api.ceetrix.com/sse');
  });

  it('URL uses HTTPS', () => {
    const url = getMcpServerUrl();
    expect(url.startsWith('https://')).toBe(true);
  });

  it('URL ends with /sse (Streamable HTTP transport)', () => {
    const url = getMcpServerUrl();
    expect(url.endsWith('/sse')).toBe(true);
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
    const mcpUrl = getMcpServerUrl();
    const setupUrl = getSetupUrl();

    expect(mcpUrl).toContain('api.ceetrix.com');
    expect(setupUrl).toContain('api.ceetrix.com');
  });

  it('both URLs use ceetrix.com domain', () => {
    const mcpUrl = getMcpServerUrl();
    const setupUrl = getSetupUrl();

    expect(mcpUrl).toContain('ceetrix.com');
    expect(setupUrl).toContain('ceetrix.com');
  });
});
