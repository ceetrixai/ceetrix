/**
 * Tests for permission-based execution system
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hasSessionTrust, resetSessionTrust } from '../src/permissions.js';

describe('permissions', () => {
  beforeEach(() => {
    resetSessionTrust();
  });

  afterEach(() => {
    resetSessionTrust();
  });

  describe('hasSessionTrust', () => {
    it('returns false initially', () => {
      expect(hasSessionTrust()).toBe(false);
    });
  });

  describe('resetSessionTrust', () => {
    it('resets trust state', () => {
      // Can't easily test requestPermission without mocking inquirer
      // but we can verify reset works
      resetSessionTrust();
      expect(hasSessionTrust()).toBe(false);
    });
  });
});
