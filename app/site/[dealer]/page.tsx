import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getDealer } from '@/lib/db/dealers';
import { resolveSite, siteMetadata } from '@/lib/site/siteContent';
import QuoteRequestForm from '@/components/site/QuoteRequestForm';

/**
 * The generated dealer website.
 *
 * Everything on this page comes from the dealer row — name, branding, copy,
 * contact details — so onboarding a dealer produces a finished site with no
 * per-dealer code. lib/site/siteContent.ts fills every unset field from the
 * dealer's own name, because a half-branded page reads worse than no page.
 *
 * The quote form posts to /api/inbound/web, the same pipeline the Facebook
 * channel will use, so the rule about when a price may be shown is not
 * re-decided per surface.
 */

export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ dealer: string }>;
}): Promise<Metadata> {
  const { dealer: slug } = await params;
  try {
    const dealer = await getDealer(slug.toLowerCase());
    if (dealer) return siteMetadata(dealer);
  } catch {
    // Metadata must never be the thing that takes the page down.
  }
  return { title: 'Metal Buildings' };
}

export default async function DealerSitePage({
  params,
}: {
  params: Promise<{ dealer: string }>;
}) {
  const { dealer: slug } = await params;

  let dealer = null;
  try {
    dealer = await getDealer(slug.toLowerCase());
  } catch (err) {
    console.error('[site] dealer lookup failed', err);
    // A DB blip is not the same as an unknown dealer. Fall through to a 500
    // rather than telling a real dealer their site does not exist.
    throw err;
  }

  // Unlike the designer, an unknown slug does NOT fall back to a default
  // dealer: serving one dealer's branding under another's URL would be worse
  // than a 404.
  if (!dealer) notFound();

  const { content, theme } = resolveSite(dealer);
  const accent = theme.primaryColor;
  const designerHref = `/designer?dealer=${encodeURIComponent(dealer.id)}`;

  return (
    <div style={{ backgroundColor: theme.backgroundColor }} className="min-h-screen">
      {theme.customCss ? <style dangerouslySetInnerHTML={{ __html: theme.customCss }} /> : null}

      {/* ── Header ─────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-20 border-b backdrop-blur"
        style={{
          backgroundColor: theme.headerStyle === 'dark' ? accent : '#ffffff',
          borderColor: theme.headerStyle === 'dark' ? 'rgba(255,255,255,.12)' : '#e5e7eb',
        }}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <div className="flex items-center gap-3">
            {theme.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={theme.logoUrl} alt={dealer.name} className="h-9 w-auto object-contain" />
            ) : (
              <span
                className={`text-lg font-bold tracking-tight ${
                  theme.headerStyle === 'dark' ? 'text-white' : 'text-gray-900'
                }`}
              >
                {dealer.name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-4">
            {dealer.phone && (
              <a
                href={`tel:${dealer.phone.replace(/[^\d+]/g, '')}`}
                className={`hidden text-sm font-medium sm:block ${
                  theme.headerStyle === 'dark' ? 'text-white/90 hover:text-white' : 'text-gray-700 hover:text-gray-900'
                }`}
              >
                {dealer.phone}
              </a>
            )}
            <Link
              href={designerHref}
              className="rounded-lg bg-white/95 px-4 py-2 text-sm font-semibold shadow-sm transition hover:bg-white"
              style={{ color: accent }}
            >
              {content.ctaLabel}
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 pb-16 pt-20 text-center sm:pt-28">
        <h1 className="mx-auto max-w-3xl text-4xl font-bold leading-[1.1] tracking-tight text-gray-900 sm:text-6xl">
          {content.headline}
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-gray-600 sm:text-lg">
          {content.tagline}
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href={designerHref}
            style={{ backgroundColor: accent }}
            className="w-full rounded-lg px-8 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 sm:w-auto"
          >
            {content.ctaLabel}
          </Link>
          <a
            href="#quote"
            className="w-full rounded-lg border border-gray-300 px-8 py-3.5 text-sm font-semibold text-gray-800 transition hover:border-gray-400 sm:w-auto"
          >
            Get a price by message
          </a>
        </div>
      </section>

      {/* ── What they build ────────────────────────────────── */}
      <section className="border-t border-gray-100 bg-gray-50/60 py-16">
        <div className="mx-auto max-w-6xl px-5">
          <div className="grid gap-6 sm:grid-cols-3">
            {content.services.map(s => (
              <div key={s.title} className="rounded-xl border border-gray-200 bg-white p-6">
                <div className="h-1 w-10 rounded-full" style={{ backgroundColor: accent }} />
                <h3 className="mt-4 text-base font-semibold text-gray-900">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Quote by message ───────────────────────────────── */}
      <section id="quote" className="scroll-mt-16 py-20">
        <div className="mx-auto max-w-6xl px-5">
          <h2 className="mb-3 text-center text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
            Get a price without the phone call
          </h2>
          <p className="mx-auto mb-9 max-w-xl text-center text-sm leading-relaxed text-gray-600">
            Describe what you need in your own words. If we can price it, you get the number right
            here.
          </p>
          <QuoteRequestForm
            dealerId={dealer.id}
            accent={accent}
            prompt={content.quotePrompt}
          />
        </div>
      </section>

      {/* ── About ──────────────────────────────────────────── */}
      <section className="border-t border-gray-100 bg-gray-50/60 py-16">
        <div className="mx-auto max-w-3xl px-5 text-center">
          <h2 className="text-xl font-bold tracking-tight text-gray-900">About {dealer.name}</h2>
          <p className="mt-4 text-sm leading-relaxed text-gray-600">{content.about}</p>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────── */}
      <footer style={{ backgroundColor: accent }} className="py-12 text-white">
        <div className="mx-auto max-w-6xl px-5">
          <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
            <div>
              <div className="text-base font-semibold">{dealer.name}</div>
              <div className="mt-2 space-y-1 text-sm text-white/80">
                {dealer.phone && (
                  <div>
                    <a href={`tel:${dealer.phone.replace(/[^\d+]/g, '')}`} className="hover:text-white">
                      {dealer.phone}
                    </a>
                  </div>
                )}
                {dealer.email && (
                  <div>
                    <a href={`mailto:${dealer.email}`} className="hover:text-white">
                      {dealer.email}
                    </a>
                  </div>
                )}
                {dealer.website && <div className="text-white/70">{dealer.website}</div>}
              </div>
            </div>
            <Link
              href={designerHref}
              className="rounded-lg bg-white px-6 py-3 text-sm font-semibold shadow-sm transition hover:bg-white/90"
              style={{ color: accent }}
            >
              {content.ctaLabel}
            </Link>
          </div>
          {theme.showPoweredBy && (
            <div className="mt-9 border-t border-white/15 pt-5 text-xs text-white/50">
              Powered by Steel Sync
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}
