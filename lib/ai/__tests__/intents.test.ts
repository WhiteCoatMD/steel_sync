import { describe, it, expect } from 'vitest';
import { shapeIntents } from '../parseRequest';

/**
 * Intent is READ by the model now rather than matched by regex, because a list
 * of phrasings is the wrong shape for a question people ask a hundred ways.
 * Two regex passes shipped and both missed real customer wording.
 *
 * What matters most here is the failure direction. Intent picks which correct
 * reply to send; it never decides whether a PRICE goes out. So a garbled or
 * absent `intents` must degrade to the regex matchers, not silently read as
 * "the customer asked for nothing".
 */

describe('shaping what the model returned', () => {
  it('reports null when the model sent no intents, so callers can fall back', () => {
    // null and all-false are DIFFERENT: the first means "no answer, use the
    // regex floor", the second is a real answer to respect.
    expect(shapeIntents(undefined)).toBeNull();
    expect(shapeIntents(null)).toBeNull();
    expect(shapeIntents('asksFinancing')).toBeNull();
    expect(shapeIntents(42)).toBeNull();
  });

  it('keeps an all-false answer as an answer', () => {
    const out = shapeIntents({});
    expect(out).not.toBeNull();
    expect(out!.asksFinancing).toBe(false);
  });

  it('treats anything but literal true as false', () => {
    // A model returning "yes" or 1 must not read as intent.
    const out = shapeIntents({
      asksFinancing: 'yes',
      asksRoofComparison: 1,
      asksWhatSize: 'true',
      needsExtraHeight: {},
      isRvUse: true,
    })!;
    expect(out.asksFinancing).toBe(false);
    expect(out.asksRoofComparison).toBe(false);
    expect(out.asksWhatSize).toBe(false);
    expect(out.needsExtraHeight).toBe(false);
    expect(out.isRvUse).toBe(true);
  });

  it('fills every key, so a caller never reads undefined as a decision', () => {
    const out = shapeIntents({ asksFinancing: true })!;
    for (const k of [
      'asksFinancing',
      'asksRoofComparison',
      'asksWhatSize',
      'needsExtraHeight',
      'isRvUse',
    ] as const) {
      expect(typeof out[k]).toBe('boolean');
    }
  });
});
