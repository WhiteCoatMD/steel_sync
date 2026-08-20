import { describe, it, expect } from 'vitest';
import { createDefaultConfig, DEFAULT_PRICING_RULES } from '../defaultConfig';
import { calculatePrice } from '../../pricing/calculatePrice';

describe('pricing golden values', () => {
  it('default config price is stable across refactors', () => {
    const cfg = createDefaultConfig('test');
    const p = calculatePrice(cfg, DEFAULT_PRICING_RULES);
    expect(p.total).toBeCloseTo(13599.0, 0);
  });

  it('a lean-to carrying a roll-up is priced', () => {
    const cfg = createDefaultConfig('test');
    cfg.leanTos = [{
      id: 'lt1', wall: 'left', widthFt: 5, lengthFt: 30, heightFt: 8,
      roofColor: { id: 'white', hex: '#FFFFFF' },
      wallColor: { id: 'white', hex: '#FFFFFF' },
      walls: 'open',
      openings: [{ id: 'o1', type: 'rollup', widthFt: 10, heightFt: 10,
                   wall: 'front', positionFt: 0, color: null }],
    }];
    const p = calculatePrice(cfg, DEFAULT_PRICING_RULES);
    expect(p.leanToTotal).toBeGreaterThan(0);
  });
});
