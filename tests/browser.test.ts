import { describe, it, expect, vi } from 'vitest';

// Mock the open package - must return an object with unref() method
vi.mock('open', () => ({
  default: vi.fn(),
}));

import { openBrowser } from '../src/browser.js';
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
