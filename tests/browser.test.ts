import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock the open package - must return an object with unref() method
vi.mock('open', () => ({
  default: vi.fn(),
}));

import { openBrowser, canLaunchBrowser } from '../src/browser.js';
import open from 'open';

const mockOpen = vi.mocked(open);

// Mock ChildProcess with unref method
const mockChildProcess = {
  pid: 12345,
  unref: vi.fn(),
};

describe('openBrowser', () => {
  it('returns true when browser opens successfully', async () => {
    mockOpen.mockResolvedValueOnce(mockChildProcess as never);

    const result = await openBrowser('https://example.com');

    expect(result).toBe(true);
    expect(mockOpen).toHaveBeenCalledWith('https://example.com');
    expect(mockChildProcess.unref).toHaveBeenCalled();
  });

  it('returns false when browser fails to open', async () => {
    mockOpen.mockRejectedValueOnce(new Error('No browser found'));

    const result = await openBrowser('https://example.com');

    expect(result).toBe(false);
  });

  it('passes the URL to the open package', async () => {
    mockOpen.mockResolvedValueOnce(mockChildProcess as never);

    await openBrowser('https://app.ceetrix.com/setup?callback=http://localhost:54321');

    expect(mockOpen).toHaveBeenCalledWith(
      'https://app.ceetrix.com/setup?callback=http://localhost:54321'
    );
  });
});

describe('canLaunchBrowser (Story 224)', () => {
  const originalPlatform = process.platform;
  const originalEnv = { ...process.env };

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    process.env = { ...originalEnv };
  });

  it('returns true on macOS', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    expect(canLaunchBrowser()).toBe(true);
  });

  it('returns true on Linux with DISPLAY set', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    process.env.DISPLAY = ':0';
    delete process.env.WAYLAND_DISPLAY;
    expect(canLaunchBrowser()).toBe(true);
  });

  it('returns true on Linux with WAYLAND_DISPLAY set', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    delete process.env.DISPLAY;
    process.env.WAYLAND_DISPLAY = 'wayland-0';
    expect(canLaunchBrowser()).toBe(true);
  });

  it('returns false on headless Linux (no display server)', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    delete process.env.DISPLAY;
    delete process.env.WAYLAND_DISPLAY;
    expect(canLaunchBrowser()).toBe(false);
  });

  it('returns false on unsupported platforms', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect(canLaunchBrowser()).toBe(false);
  });
});
