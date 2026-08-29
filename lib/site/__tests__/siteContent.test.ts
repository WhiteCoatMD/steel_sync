import { describe, it, expect } from 'vitest';
import { resolveSite, siteMetadata, sanitizeCustomCss } from '../siteContent';
import type { DealerSettings } from '../../building/types';

/**
 * A dealer row starts with `theme` and `site` both `{}`. The generated site
 * still has to look finished on day one — a half-branded page with "undefined"
 * in the headline reads worse than no site at all.
 */

const bare = {
  id: 'dealer_columbia',
  name: 'Columbia Carports',
  phone: '(318) 249-8172',
  email: 'sales@example.com',
  website: '',
  theme: {},
  showPricing: true,
  colorPalette: [],
  availableBuildingTypes: [],
  pricing: {},
} as unknown as DealerSettings;

describe('an unconfigured dealer still gets a finished site', () => {
  const { content, theme } = resolveSite(bare);

  it('fills every copy field', () => {
    for (const v of [content.headline, content.tagline, content.about, content.ctaLabel, content.quotePrompt]) {
      expect(v.trim()).not.toBe('');
      expect(v).not.toMatch(/undefined|null|\[object/i);
    }
    expect(content.services.length).toBeGreaterThan(0);
  });

  it('writes the dealer’s own name into the copy rather than generic filler', () => {
    expect(content.tagline).toContain('Columbia Carports');
    expect(content.about).toContain('Columbia Carports');
  });

  it('gives an accent dark enough to read as white-on-colour', () => {
    // The accent doubles as the button background, so a light default would
    // put white text on a pale field.
    expect(theme.primaryColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(theme.primaryColor.toLowerCase()).not.toBe('#ffffff');
  });

  it('defaults the attribution on rather than off', () => {
    expect(theme.showPoweredBy).toBe(true);
  });
});

describe('dealer settings win over the defaults', () => {
  it('takes branding and copy when present', () => {
    const branded = {
      ...bare,
      theme: { primaryColor: '#b91c1c', headerStyle: 'light', showPoweredBy: false, logoUrl: 'https://x/l.png' },
      site: { headline: 'Built in Louisiana', ctaLabel: 'Build yours' },
    } as unknown as DealerSettings;
    const { content, theme } = resolveSite(branded);
    expect(theme.primaryColor).toBe('#b91c1c');
    expect(theme.headerStyle).toBe('light');
    expect(theme.showPoweredBy).toBe(false);
    expect(theme.logoUrl).toBe('https://x/l.png');
    expect(content.headline).toBe('Built in Louisiana');
    expect(content.ctaLabel).toBe('Build yours');
    // Unset fields still fall back rather than going blank.
    expect(content.about).toContain('Columbia Carports');
  });

  it('treats an empty string as unset, not as intentional blankness', () => {
    const blanked = { ...bare, site: { headline: '   ' } } as unknown as DealerSettings;
    expect(resolveSite(blanked).content.headline.trim()).not.toBe('');
  });
});

describe('custom CSS cannot break out of the style tag', () => {
  /**
   * The value is rendered with dangerouslySetInnerHTML inside <style>. Only an
   * admin can set it today, but the super-admin editor makes it an editable
   * field — which turns "trusted source" into "one compromised account".
   */
  it('strips a closing style tag and the script that follows it', () => {
    const attack = '.a{color:red}</style><script>alert(document.cookie)</script>';
    const out = sanitizeCustomCss(attack)!;
    expect(out).not.toContain('</style');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<');
  });

  it.each([
    '</STYLE><script>x</script>',
    '</style ><img src=x onerror=alert(1)>',
    '<svg onload=alert(1)>',
  ])('neutralises %s', attack => {
    expect(sanitizeCustomCss(attack) ?? '').not.toContain('<');
  });

  it('leaves legitimate CSS working, including the child combinator', () => {
    const css = '.card > .title { color: #b91c1c; } @media (max-width: 40rem) { .card { padding: 0 } }';
    expect(sanitizeCustomCss(css)).toBe(css);
  });

  it('ignores a non-string and an empty value', () => {
    expect(sanitizeCustomCss(undefined)).toBeUndefined();
    expect(sanitizeCustomCss(42)).toBeUndefined();
    expect(sanitizeCustomCss('   ')).toBeUndefined();
  });

  it('caps the length so one dealer cannot bloat every page render', () => {
    expect(sanitizeCustomCss('a'.repeat(50_000))!.length).toBeLessThanOrEqual(20_000);
  });

  it('is applied by resolveSite, not left to the caller to remember', () => {
    const evil = {
      ...bare,
      theme: { customCss: '.a{}</style><script>alert(1)</script>' },
    } as unknown as DealerSettings;
    expect(resolveSite(evil).theme.customCss ?? '').not.toContain('<');
  });
});

describe('metadata keeps a generated site findable', () => {
  it('names the dealer in the title and stays within a description length', () => {
    const meta = siteMetadata(bare);
    expect(meta.title).toContain('Columbia Carports');
    expect(meta.description.length).toBeLessThanOrEqual(155);
    expect(meta.description.trim()).not.toBe('');
  });
});
