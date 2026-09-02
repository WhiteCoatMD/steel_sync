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

/**
 * The three dealer states, asserted on the SQL itself.
 *
 * There is no Postgres in the unit suite, so these check the shape of the
 * statement rather than its result. That is still worth having: the bug this
 * covers was a WHERE clause that simply did not mention the column, which
 * typechecks and passes every behavioural test that mocks the layer above.
 */
const captureSql = () => {
  const seen: string[] = [];
  vi.doMock('../index', () => ({
    getSql:
      () =>
      (strings: TemplateStringsArray, ..._params: unknown[]) => {
        seen.push(strings.join(' ? ').replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      },
  }));
  return seen;
};

describe('activeDealerForSession', () => {
  it('lets a pending dealer in and keeps a suspended one out', async () => {
    const seen = captureSql();
    vi.resetModules();
    const { activeDealerForSession } = await import('../dealerUsers');
    await activeDealerForSession('dunrite', 'owner@dunrite.com');
    vi.doUnmock('../index');
    // approved_at IS NULL is pending (allowed), active = true is approved
    // (allowed); everything else — approved then switched off — is suspended.
    expect(seen[0]).toContain('(d.approved_at IS NULL OR d.active = true)');
  });
});

describe('setDealerActive', () => {
  it('stamps approved_at the first time a dealer is approved, and only then', async () => {
    const seen = captureSql();
    vi.resetModules();
    const { setDealerActive } = await import('../dealerUsers');
    await setDealerActive('bob-buildings', true);
    vi.doUnmock('../index');
    expect(seen[0]).toContain('approved_at = COALESCE(approved_at, now())');
  });

  it('never clears approved_at on suspension, which would re-open the door', async () => {
    const seen = captureSql();
    vi.resetModules();
    const { setDealerActive } = await import('../dealerUsers');
    await setDealerActive('bob-buildings', false);
    vi.doUnmock('../index');
    expect(seen[0]).toContain('active = false');
    expect(seen[0]).not.toContain('approved_at');
  });
});
