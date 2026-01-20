/**
 * Tests for invite code validation and signup
 * Story 265: Gate CLI installation with invite code system
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { validateInviteCode, submitSignup } from '../src/invite.js';

const API_URL = process.env.CEETRIX_API_URL || 'https://api.ceetrix.com';

describe('Invite System', () => {
  beforeAll(() => {
    console.log(`Testing against: ${API_URL}`);
  });

  describe('validateInviteCode', () => {
    it('should return true for valid code', async () => {
      const result = await validateInviteCode('integrity2026');
      expect(result).toBe(true);
    });

    it('should return false for invalid code', async () => {
      const result = await validateInviteCode('invalid123');
      expect(result).toBe(false);
    });

    it('should return false for empty code', async () => {
      const result = await validateInviteCode('');
      expect(result).toBe(false);
    });
  });

  describe('submitSignup', () => {
    it('should successfully submit a signup', async () => {
      const email = `test-${Date.now()}@example.com`;
      const result = await submitSignup(email, 'Testing from vitest');
      expect(result).toBe(true);
    });

    it('should handle duplicate email gracefully', async () => {
      const email = `test-dup-${Date.now()}@example.com`;

      // First signup
      const first = await submitSignup(email, 'First signup');
      expect(first).toBe(true);

      // Duplicate should also return true (no info leak)
      const second = await submitSignup(email, 'Duplicate');
      expect(second).toBe(true);
    });
  });
});
