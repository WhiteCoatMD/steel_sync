import { describe, it, expect } from 'vitest';
import { shapeContact } from '../../ai/parseRequest';

/**
 * Everything the bot can state about a dealer — delivery area, warranty, lead
 * time, whether they pour concrete — is per-dealer free text, not a constant.
 *
 * That shape matters more than it looks: concrete is offered by SOME dealers in
 * SOME areas (owner, 2026-08-29), so a dealer who has told us nothing must
 * inherit nothing. The failure to avoid is Dunrite's policies answering for a
 * dealer who does not pour concrete at all.
 */

describe('contact details we collect', () => {
  it('keeps only the fields an invoice or a concrete quote needs', () => {
    const c = shapeContact({
      fullName: 'John Smith',
      address: '1420 Pine Hill Rd',
      phone: '318-555-0142',
      email: 'j@example.com',
      zipCode: '71047',
      creditCard: '4111111111111111',
      notes: 'anything else',
    });
    expect(c).toEqual({
      fullName: 'John Smith',
      address: '1420 Pine Hill Rd',
      phone: '318-555-0142',
      email: 'j@example.com',
      zipCode: '71047',
    });
    // Nothing outside the allowlist survives, whatever the model returns.
    expect(Object.keys(c)).not.toContain('creditCard');
    expect(Object.keys(c)).not.toContain('notes');
  });

  it('drops blanks rather than storing empty strings', () => {
    expect(shapeContact({ fullName: '   ', phone: '318-555-0142' })).toEqual({
      phone: '318-555-0142',
    });
  });

  it('ignores anything that is not a string', () => {
    expect(shapeContact({ phone: 3185550142, email: { at: 'x' } })).toEqual({});
  });

  it('survives a garbled contact block', () => {
    expect(shapeContact(null)).toEqual({});
    expect(shapeContact('John Smith')).toEqual({});
  });
});
