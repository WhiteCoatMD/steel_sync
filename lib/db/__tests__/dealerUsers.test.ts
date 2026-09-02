import { describe, it, expect, vi } from 'vitest';
import { slugify } from '../dealerUsers';

describe('slugify', () => {
  it('makes a URL-safe id from a business name', () => {
    expect(slugify('Dunrite Metal Buildings')).toBe('dunrite-metal-buildings');
    expect(slugify("Bob's Carports & Barns")).toBe('bobs-carports-barns');
    expect(slugify('  Double   Spaces  ')).toBe('double-spaces');
    expect(slugify('Tejas-Mex')).toBe('tejas-mex');
  });

  it('never produces leading, trailing or doubled separators', () => {
    expect(slugify('--Weird--Name--')).toBe('weird-name');
    expect(slugify('!!!')).toBe('dealer');
  });

  it('caps the length so an id stays a usable URL', () => {
    expect(slugify('A'.repeat(200)).length).toBeLessThanOrEqual(40);
  });

  // The id is a public URL and a foreign key. It must never be empty.
  it('falls back to a usable id when nothing survives', () => {
    expect(slugify('')).toBe('dealer');
    expect(slugify('   ')).toBe('dealer');
  });
});

describe('allocateDealerId', () => {
  it('suffixes an id that is already taken', async () => {
    const taken = new Set(['bob-buildings', 'bob-buildings-2']);
    vi.resetModules();
    vi.doMock('../index', () => ({
      getSql: () => (strings: TemplateStringsArray, ...params: unknown[]) =>
        Promise.resolve(taken.has(params[0] as string) ? [{ '?column?': 1 }] : []),
    }));
    const { allocateDealerId } = await import('../dealerUsers');
    expect(await allocateDealerId('Bob Buildings')).toBe('bob-buildings-3');
    vi.doUnmock('../index');
  });
});
