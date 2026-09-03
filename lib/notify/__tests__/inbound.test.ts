import { describe, it, expect } from 'vitest';
import { buildInboundSmsBody, type InboundLead } from '../inbound';

/**
 * The SMS carries a customer's own words, which is the difference between this
 * and every other alert body in the codebase: the text is arbitrary and
 * hostile-by-accident. Someone typing an em dash or an emoji into Messenger
 * would push the whole message out of GSM-7 and halve the single-segment limit
 * from 160 to 70 — turning one billed segment into two or three, on every lead,
 * forever. See buildSmsBody in ../sms.ts for the underlying rule.
 */

const lead = (over: Partial<InboundLead> = {}): InboundLead => ({
  channel: 'web',
  externalId: 'web:x',
  message: '24x30 garage',
  status: 'Quoted',
  needsReply: false,
  ...over,
});

/** The GSM 03.38 basic set, near enough: plain printable ASCII. */
const isGsm7Safe = (s: string) => /^[\x20-\x7E]*$/.test(s);

describe('buildInboundSmsBody', () => {
  it('says the channel, what they asked, and what happened', () => {
    const body = buildInboundSmsBody(lead());
    expect(body).toContain('web');
    expect(body).toContain('24x30 garage');
    expect(body).toContain('Quoted');
  });

  it('includes the price when there was one', () => {
    expect(buildInboundSmsBody(lead({ quoted: '$3,445' }))).toContain('$3,445');
  });

  it('never exceeds one billed segment', () => {
    const body = buildInboundSmsBody(lead({ message: 'a'.repeat(500) }));
    expect(body.length).toBeLessThanOrEqual(160);
  });

  it('keeps the status readable even when the message is enormous', () => {
    const body = buildInboundSmsBody(lead({ message: 'a'.repeat(500), status: 'Needs you' }));
    expect(body).toContain('Needs you');
    expect(body.length).toBeLessThanOrEqual(160);
  });

  // The whole reason this function exists rather than a template literal.
  it('strips characters that would break GSM-7 and halve the limit', () => {
    const body = buildInboundSmsBody(
      lead({ message: 'I need a 24x30 — “garage” 🚚 for my truck…' }),
    );
    expect(isGsm7Safe(body)).toBe(true);
    expect(body).toContain('24x30');
  });

  it('flattens newlines a customer pasted in', () => {
    const body = buildInboundSmsBody(lead({ message: 'line one\nline two\n\nline three' }));
    expect(body).not.toMatch(/[\r\n]/);
    expect(body).toContain('line one line two line three');
  });

  it('still produces something usable for an empty message', () => {
    const body = buildInboundSmsBody(lead({ message: '' }));
    expect(body.length).toBeGreaterThan(0);
    expect(isGsm7Safe(body)).toBe(true);
  });
});
