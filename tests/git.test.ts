import { describe, it, expect } from 'vitest';
import { parseGitUrl } from '../src/git.js';

describe('parseGitUrl', () => {
  describe('SSH URLs', () => {
    it('parses SSH URL with .git suffix', () => {
      expect(parseGitUrl('git@github.com:owner/repo.git')).toBe('owner/repo');
    });

    it('parses SSH URL without .git suffix', () => {
      expect(parseGitUrl('git@github.com:owner/repo')).toBe('owner/repo');
    });

    it('handles owner with hyphen', () => {
      expect(parseGitUrl('git@github.com:my-org/my-repo.git')).toBe('my-org/my-repo');
    });

    it('handles owner with underscore', () => {
      expect(parseGitUrl('git@github.com:my_org/my_repo.git')).toBe('my_org/my_repo');
    });
  });

  describe('HTTPS URLs', () => {
    it('parses HTTPS URL with .git suffix', () => {
      expect(parseGitUrl('https://github.com/owner/repo.git')).toBe('owner/repo');
    });

    it('parses HTTPS URL without .git suffix', () => {
      expect(parseGitUrl('https://github.com/owner/repo')).toBe('owner/repo');
    });

    it('handles HTTP (non-HTTPS) URL', () => {
      expect(parseGitUrl('http://github.com/owner/repo.git')).toBe('owner/repo');
    });
  });

  describe('non-GitHub URLs', () => {
    it('returns null for GitLab SSH URL', () => {
      expect(parseGitUrl('git@gitlab.com:owner/repo.git')).toBeNull();
    });

    it('returns null for GitLab HTTPS URL', () => {
      expect(parseGitUrl('https://gitlab.com/owner/repo.git')).toBeNull();
    });

    it('returns null for Bitbucket URL', () => {
      expect(parseGitUrl('git@bitbucket.org:owner/repo.git')).toBeNull();
    });
  });

  describe('invalid inputs', () => {
    it('returns null for empty string', () => {
      expect(parseGitUrl('')).toBeNull();
    });

    it('returns null for random string', () => {
      expect(parseGitUrl('not-a-url')).toBeNull();
    });

    it('returns null for malformed URL', () => {
      expect(parseGitUrl('github.com/owner')).toBeNull();
    });
  });
});
