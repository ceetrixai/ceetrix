import { describe, it, expect, vi } from 'vitest';

// Mock the open package
vi.mock('open', () => ({
  default: vi.fn(),
}));

import { openBrowser } from '../src/browser.js';
import open from 'open';

const mockOpen = vi.mocked(open);

describe('openBrowser', () => {
  it('returns true when browser opens successfully', async () => {
    mockOpen.mockResolvedValueOnce({} as never);

    const result = await openBrowser('https://example.com');

    expect(result).toBe(true);
    expect(mockOpen).toHaveBeenCalledWith('https://example.com');
  });

  it('returns false when browser fails to open', async () => {
    mockOpen.mockRejectedValueOnce(new Error('No browser found'));

    const result = await openBrowser('https://example.com');

    expect(result).toBe(false);
  });

  it('passes the URL to the open package', async () => {
    mockOpen.mockResolvedValueOnce({} as never);

    await openBrowser('https://app.ceetrix.com/setup?callback=http://localhost:54321');

    expect(mockOpen).toHaveBeenCalledWith(
      'https://app.ceetrix.com/setup?callback=http://localhost:54321'
    );
  });
});
