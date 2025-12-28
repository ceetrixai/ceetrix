import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @inquirer/prompts
vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
  select: vi.fn(),
}));

import { promptForRepo, promptExistingConfig, promptConfirm } from '../src/prompts.js';
import { input, select } from '@inquirer/prompts';

const mockInput = vi.mocked(input);
const mockSelect = vi.mocked(select);

describe('promptForRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the input repository', async () => {
    mockInput.mockResolvedValueOnce('owner/repo');

    const result = await promptForRepo();

    expect(result).toBe('owner/repo');
  });

  it('passes validation function to input', async () => {
    mockInput.mockResolvedValueOnce('owner/repo');

    await promptForRepo();

    expect(mockInput).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('owner/repo'),
        validate: expect.any(Function),
      })
    );
  });

  describe('validation', () => {
    it('accepts valid owner/repo format', async () => {
      mockInput.mockImplementation(async (opts) => {
        const validate = opts.validate as (value: string) => boolean | string;
        expect(validate('owner/repo')).toBe(true);
        return 'owner/repo';
      });

      await promptForRepo();
    });

    it('rejects input without slash', async () => {
      mockInput.mockImplementation(async (opts) => {
        const validate = opts.validate as (value: string) => boolean | string;
        expect(validate('noslash')).toBe('Format: owner/repo');
        return 'owner/repo';
      });

      await promptForRepo();
    });

    it('rejects input with multiple slashes', async () => {
      mockInput.mockImplementation(async (opts) => {
        const validate = opts.validate as (value: string) => boolean | string;
        expect(validate('a/b/c')).toBe('Format: owner/repo');
        return 'owner/repo';
      });

      await promptForRepo();
    });

    it('rejects empty owner', async () => {
      mockInput.mockImplementation(async (opts) => {
        const validate = opts.validate as (value: string) => boolean | string;
        expect(validate('/repo')).toBe('Format: owner/repo');
        return 'owner/repo';
      });

      await promptForRepo();
    });

    it('rejects empty repo', async () => {
      mockInput.mockImplementation(async (opts) => {
        const validate = opts.validate as (value: string) => boolean | string;
        expect(validate('owner/')).toBe('Format: owner/repo');
        return 'owner/repo';
      });

      await promptForRepo();
    });
  });
});

describe('promptExistingConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns add-repo when selected', async () => {
    mockSelect.mockResolvedValueOnce('add-repo');

    const result = await promptExistingConfig();

    expect(result).toBe('add-repo');
  });

  it('returns reauth when selected', async () => {
    mockSelect.mockResolvedValueOnce('reauth');

    const result = await promptExistingConfig();

    expect(result).toBe('reauth');
  });

  it('returns remove when selected', async () => {
    mockSelect.mockResolvedValueOnce('remove');

    const result = await promptExistingConfig();

    expect(result).toBe('remove');
  });

  it('returns cancel when selected', async () => {
    mockSelect.mockResolvedValueOnce('cancel');

    const result = await promptExistingConfig();

    expect(result).toBe('cancel');
  });

  it('presents all four options', async () => {
    mockSelect.mockResolvedValueOnce('cancel');

    await promptExistingConfig();

    expect(mockSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: expect.arrayContaining([
          expect.objectContaining({ value: 'add-repo' }),
          expect.objectContaining({ value: 'reauth' }),
          expect.objectContaining({ value: 'remove' }),
          expect.objectContaining({ value: 'cancel' }),
        ]),
      })
    );
  });
});

describe('promptConfirm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when Yes is selected', async () => {
    mockSelect.mockResolvedValueOnce(true);

    const result = await promptConfirm('Are you sure?');

    expect(result).toBe(true);
  });

  it('returns false when No is selected', async () => {
    mockSelect.mockResolvedValueOnce(false);

    const result = await promptConfirm('Are you sure?');

    expect(result).toBe(false);
  });

  it('uses the provided message', async () => {
    mockSelect.mockResolvedValueOnce(true);

    await promptConfirm('Custom message?');

    expect(mockSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Custom message?',
      })
    );
  });
});
