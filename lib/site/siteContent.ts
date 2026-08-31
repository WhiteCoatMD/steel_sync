import type { DealerSettings, DealerTheme } from '../building/types';

/**
 * Resolves everything a generated dealer website needs to render.
 *
 * A dealer row starts with `theme` and `site` both `{}`. The site still has to
 * look finished on day one — a half-branded page with "undefined" in the
 * headline is worse than no site — so every field here falls back, and the
 * fallbacks are derived from the dealer's own name rather than being generic
 * lorem text.
 */

export interface SiteContent {
  headline: string;
  tagline: string;
  about: string;
  services: Array<{ title: string; body: string }>;
  ctaLabel: string;
  /** Shown above the form. */
  quotePrompt: string;
}

export interface ResolvedSite {
  content: SiteContent;
  theme: Required<Omit<DealerTheme, 'fontFamily' | 'customCss'>> & {
    fontFamily: string | null;
    customCss?: string;
  };
}

/**
 * Deliberately conservative defaults. The brand colour doubles as the accent on
 * buttons and headings, so an unset value must still give readable contrast
 * against white — hence a dark slate rather than a mid-tone.
 */
const DEFAULT_THEME = {
  logoUrl: '',
  primaryColor: '#1e293b',
  secondaryColor: '#334155',
  backgroundColor: '#ffffff',
  headerStyle: 'dark' as const,
  fontFamily: null,
  showPoweredBy: true,
};

const DEFAULT_SERVICES: SiteContent['services'] = [
  {
    title: 'Carports & RV Covers',
    body: 'Open-sided cover for vehicles, equipment, and anything that should not sit in the weather.',
  },
  {
    title: 'Garages & Workshops',
    body: 'Fully enclosed, with roll-up doors, walk-in doors, and windows placed where you want them.',
  },
  {
    title: 'Barns & Storage',
    body: 'Taller walls and wider spans for livestock, hay, tractors, and long-term storage.',
  },
];

/**
 * Custom CSS is injected into a <style> tag, so it is a script-injection vector
 * even though only an admin can set it: `</style><script>…` breaks straight out
 * of the element. The super-admin editor makes this field editable, which turns
 * "trusted source" into "one compromised admin account".
 *
 * Stripping `<` closes the hole completely and costs nothing: `<` is not valid
 * CSS syntax anywhere in a selector or declaration. The child combinator `>` is
 * untouched, so `.a > .b` still works.
 */
export function sanitizeCustomCss(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;

  // Stripping "<" is what stops the only serious attack here: without it a
  // dealer could close the <style> tag and open a <script>.
  let cleaned = raw.replace(/</g, '');

  // Beyond that, stop the CSS reaching off-site. @import and a remote url()
  // both fire a request from the VISITOR's browser to a host the dealer
  // chooses, which leaks who is looking at the page and lets a third party
  // restyle it later without touching this record (security review,
  // 2026-08-30). Neither is needed to theme a page.
  //
  // Relative and data: urls are left alone — those are the legitimate uses.
  cleaned = cleaned
    .replace(/@import[^;]*;?/gi, '')
    .replace(/url\(\s*(['"]?)\s*(?:https?:)?\/\/[^)]*\)/gi, 'url()');

  cleaned = cleaned.slice(0, 20_000);
  return cleaned.trim() ? cleaned : undefined;
}

export function resolveSite(dealer: DealerSettings): ResolvedSite {
  const raw = ((dealer as unknown as { site?: Partial<SiteContent> }).site ?? {}) as Partial<SiteContent>;
  const t = { ...DEFAULT_THEME, ...(dealer.theme ?? {}) };

  const name = dealer.name?.trim() || 'Steel Buildings';

  return {
    theme: {
      logoUrl: t.logoUrl || '',
      primaryColor: t.primaryColor || DEFAULT_THEME.primaryColor,
      secondaryColor: t.secondaryColor || DEFAULT_THEME.secondaryColor,
      backgroundColor: t.backgroundColor || DEFAULT_THEME.backgroundColor,
      headerStyle: t.headerStyle === 'light' ? 'light' : 'dark',
      fontFamily: t.fontFamily ?? null,
      showPoweredBy: t.showPoweredBy !== false,
      ...(() => {
        const css = sanitizeCustomCss((dealer.theme ?? {}).customCss);
        return css ? { customCss: css } : {};
      })(),
    },
    content: {
      headline: raw.headline?.trim() || `Metal buildings, priced while you design them.`,
      tagline:
        raw.tagline?.trim() ||
        `${name} builds carports, garages, barns and workshops — engineered, delivered and installed.`,
      about:
        raw.about?.trim() ||
        `${name} has been putting up steel buildings for customers who would rather see the ` +
          `price before the sales call. Design what you want, get a real number, and we will ` +
          `take it from there.`,
      services: raw.services?.length ? raw.services : DEFAULT_SERVICES,
      ctaLabel: raw.ctaLabel?.trim() || 'Design yours',
      quotePrompt:
        raw.quotePrompt?.trim() ||
        `Tell us what you need and we'll price it. Include the size and whether you want it open or enclosed.`,
    },
  };
}

/** Page <title> and description, so a generated site is not invisible to search. */
export function siteMetadata(dealer: DealerSettings) {
  const { content } = resolveSite(dealer);
  const name = dealer.name?.trim() || 'Steel Buildings';
  return {
    title: `${name} — Metal Buildings, Carports & Garages`,
    description: content.tagline.slice(0, 155),
  };
}
