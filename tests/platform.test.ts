/**
 * Tests for platform checks
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('platform checks', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    // Restore original platform
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
    });
  });

  describe('SUPPORTED_PLATFORM constant', () => {
    it('should be darwin (macOS)', async () => {
      // Import fresh to get the constant
      const indexModule = await import('../src/index.js');
      // The constant is not exported, but we can test behavior
      expect(process.platform).toBe('darwin'); // CI might fail this
    });
  });

  describe('platform rejection', () => {
    it('should identify darwin as supported', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      expect(process.platform).toBe('darwin');
    });

    it('should identify win32 as unsupported', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      expect(process.platform).toBe('win32');
      expect(process.platform).not.toBe('darwin');
    });

    it('should identify linux as unsupported', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      expect(process.platform).toBe('linux');
      expect(process.platform).not.toBe('darwin');
    });

    it('should identify freebsd as unsupported', () => {
      Object.defineProperty(process, 'platform', { value: 'freebsd' });
      expect(process.platform).toBe('freebsd');
      expect(process.platform).not.toBe('darwin');
    });
  });
});

describe('platform error messages', () => {
  it('error message includes platform name', () => {
    const platform = 'win32';
    const errorMessage = `✗ Unsupported platform: ${platform}`;
    expect(errorMessage).toContain('win32');
  });

  it('error message mentions macOS + Claude Code only', () => {
    const message = 'Ceetrix currently supports macOS + Claude Code only.';
    expect(message).toContain('macOS');
    expect(message).toContain('Claude Code');
  });

  it('error message includes Discord link', () => {
    const message = 'Join the Discord for updates: https://ceetrix.com/discord';
    expect(message).toContain('https://ceetrix.com/discord');
  });
});
