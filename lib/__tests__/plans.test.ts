import { describe, it, expect } from 'vitest';
import { planAllows, isPlan, PLAN_IDS } from '../plans';

describe('planAllows', () => {
  it('grants AI auto-reply only on pro', () => {
    expect(planAllows('pro', 'aiAutoReply')).toBe(true);
    expect(planAllows('starter', 'aiAutoReply')).toBe(false);
    expect(planAllows('none', 'aiAutoReply')).toBe(false);
  });

  // A typo in a hand-edited database column must not hand out a paid feature.
  it('denies everything for an unknown or malformed plan', () => {
    expect(planAllows('PRO', 'aiAutoReply')).toBe(false);
    expect(planAllows('enterprise', 'aiAutoReply')).toBe(false);
    expect(planAllows('', 'aiAutoReply')).toBe(false);
    expect(planAllows(null, 'aiAutoReply')).toBe(false);
    expect(planAllows(undefined, 'aiAutoReply')).toBe(false);
    expect(planAllows(7, 'aiAutoReply')).toBe(false);
  });
});

describe('isPlan', () => {
  it('accepts exactly the three known plans', () => {
    expect(PLAN_IDS).toEqual(['none', 'starter', 'pro']);
    for (const p of PLAN_IDS) expect(isPlan(p)).toBe(true);
    expect(isPlan('enterprise')).toBe(false);
    expect(isPlan(null)).toBe(false);
  });
});
