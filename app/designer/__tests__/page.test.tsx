import { describe, it, expect, vi, beforeEach } from 'vitest';

const getDealer = vi.fn();
// DEFAULT_DEALER_ID moved into this module so the designer, the website form
// and the Facebook webhook all fall back to the SAME dealer. The tests assert
// against 'tejasmex', so the mock pins that value rather than reading the env.
vi.mock('@/lib/db/dealers', () => ({ getDealer, DEFAULT_DEALER_ID: 'tejasmex' }));

// The loader pulls in next/dynamic and the three.js designer; the page's own
// behaviour is entirely in which props it hands over, so a stub is enough.
vi.mock('@/components/designer/BuildingDesignerLoader', () => ({
  default: (props: unknown) => props,
}));

const { default: DesignerPage } = await import('../page');

const dealerRow = (id: string) => ({
  id, name: `Dealer ${id}`, phone: '+15555550100', email: `${id}@example.com`,
  website: '', theme: {}, showPricing: true, colorPalette: [],
  availableBuildingTypes: [], pricing: {},
});

const render = (dealer?: string) =>
  DesignerPage({ searchParams: Promise.resolve(dealer === undefined ? {} : { dealer }) });

describe('DesignerPage dealer resolution', () => {
  beforeEach(() => {
    getDealer.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('uses the requested dealer when it resolves', async () => {
    getDealer.mockImplementation(async (id: string) => dealerRow(id));
    const el: any = await render('acme');
    expect(el.props.dealerId).toBe('acme');
    expect(el.props.dealer.id).toBe('acme');
  });

  // The defect: an unknown slug — and, far worse, ANY dealer with
  // active = false, since getDealer filters on it — used to render a working
  // designer with dealer = null and the raw slug written into
  // config.dealerId. The customer configured a building, pressed submit, and
  // /api/quote 404'd on a dealerId that resolves to nothing.
  it('falls back to the default dealer for an unknown slug (spec 3.3)', async () => {
    getDealer.mockImplementation(async (id: string) =>
      id === 'tejasmex' ? dealerRow('tejasmex') : null);

    const el: any = await render('typo');

    expect(getDealer).toHaveBeenCalledWith('typo');
    expect(getDealer).toHaveBeenCalledWith('tejasmex');
    expect(el.props.dealer).not.toBeNull();
    expect(el.props.dealer.id).toBe('tejasmex');
    // Never the raw slug — this value is what /api/quote re-resolves.
    expect(el.props.dealerId).toBe('tejasmex');
  });

  it('falls back to the default dealer when the requested one is inactive', async () => {
    // getDealer's WHERE clause includes `active = true`, so an inactive
    // dealer is indistinguishable from a missing one here — by design.
    getDealer.mockImplementation(async (id: string) =>
      id === 'tejasmex' ? dealerRow('tejasmex') : null);

    const el: any = await render('deactivated-dealer');

    expect(el.props.dealer.id).toBe('tejasmex');
    expect(el.props.dealerId).toBe('tejasmex');
  });

  it('does not look the default up twice when the default itself is the unknown slug', async () => {
    getDealer.mockResolvedValue(null);
    const el: any = await render('tejasmex');
    expect(getDealer).toHaveBeenCalledTimes(1);
    expect(el.props.dealerId).toBe('tejasmex');
    expect(el.props.dealer).toBeNull();
  });

  it('still renders (never blank-screens) when nothing resolves at all', async () => {
    getDealer.mockResolvedValue(null);
    const el: any = await render('typo');
    expect(el).toBeTruthy();
    expect(el.props.dealerId).toBe('tejasmex');
    expect(el.props.dealer).toBeNull();
  });

  it('still renders and does not attempt a fallback when the lookup throws', async () => {
    getDealer.mockRejectedValue(new Error('connection refused'));
    const el: any = await render('acme');
    expect(getDealer).toHaveBeenCalledTimes(1); // a DB outage is not an unknown slug
    expect(el.props.dealer).toBeNull();
    expect(el.props.dealerId).toBe('tejasmex');
  });
});
