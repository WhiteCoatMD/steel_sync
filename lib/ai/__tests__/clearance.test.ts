import { describe, it, expect } from 'vitest';
import { clearanceNeededFt, CLEARANCE_HEADROOM_FT } from '../sizingIntent';
import { clarifyingQuestions } from '../quoteReadiness';

/** The roof question, as a customer missing only that field would be asked it. */
const roofQuestion = () =>
  clarifyingQuestions(['type', 'widthFt', 'lengthFt', 'legHeightFt', 'surface']).join(' ');

/**
 * RV customers are deliberately exempt from the ask-don't-guess height path,
 * because most of them take 12ft walls (owner, 2026-08-29). That default has to
 * yield the moment a customer names a clearance: in rehearsal "35 feet long and
 * 13 feet tall" still drew a 12ft suggestion, which is a cover the RV does not
 * fit under, offered as though it were what they asked for (2026-08-31).
 */

describe('reading a clearance out of the message', () => {
  it.each([
    ['its 35 feet long and 13 feet tall', 13],
    ['13ft tall', 13],
    ["needs to be 12' high", 12],
    ['my camper is 13.5 feet tall', 13.5],
    ['14 foot tall door', 14],
  ])('reads %s as %s', (text, want) => {
    expect(clearanceNeededFt(text)).toBe(want);
  });

  it('takes the tallest when several are mentioned', () => {
    expect(clearanceNeededFt('the rv is 12 feet tall, the boat is 14 ft tall')).toBe(14);
  });

  it.each([
    // A dimension is not a clearance. Reading these as one would raise the
    // walls of every building someone described in feet.
    '12 foot wide lean to',
    '20ft long carport',
    '24x30x11 garage',
    'i need something to cover my rv',
    '',
  ])('does not read a clearance out of "%s"', text => {
    expect(clearanceNeededFt(text)).toBeNull();
  });

  it.each([undefined, null, 42, {}])('survives the non-string %s', v => {
    expect(() => clearanceNeededFt(v)).not.toThrow();
    expect(clearanceNeededFt(v)).toBeNull();
  });

  it('ignores figures too small or large to be a building clearance', () => {
    // "5 feet tall" is a person, not a vehicle; 40 is a typo or a length.
    expect(clearanceNeededFt('im 5 feet tall')).toBeNull();
    expect(clearanceNeededFt('40 feet tall')).toBeNull();
  });

  it('leaves headroom, because a 13ft RV does not fit 13ft walls', () => {
    expect(CLEARANCE_HEADROOM_FT).toBeGreaterThanOrEqual(1);
  });
});

describe('the roof style question', () => {
  /**
   * Left open, the composer invented labels and drifted between them —
   * "A-frame horizontal" in one reply and "A-frame boxed eave" in the next.
   * "Horizontal" is not a roof style at all; it describes siding direction, so
   * that phrasing invited an answer to the wrong question (rehearsal,
   * 2026-08-31).
   */
  it('names all three styles so the model does not invent names', () => {
    const q = roofQuestion();
    expect(q).toMatch(/regular/i);
    expect(q).toMatch(/vertical/i);
    expect(q).toMatch(/boxed eave|a-frame/i);
  });

  it('does not describe the roof as horizontal', () => {
    expect(roofQuestion()).not.toMatch(/horizontal/i);
  });
});
