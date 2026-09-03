import Link from 'next/link';
import type { Metadata } from 'next';
import { Archivo, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import { STANDARD_COLORS } from '@/lib/building/defaultConfig';
import styles from './page.module.css';

/**
 * The front door.
 *
 * This was a dev stub — a wordmark and a "Launch Designer" button — from when
 * dealers were created by running a script on a laptop. Now that they can sign
 * themselves up, a dealer who hears about Steel Sync and types in the address
 * has to be able to find the thing they came for.
 *
 * The palette is not invented: every color on this page is one the product
 * actually sells, taken from STANDARD_COLORS. Barn Red is the default wall
 * color of every building the configurator opens with. A dealer should
 * recognize this page as belonging to their trade before they read a word of it.
 *
 * Fonts are scoped to THIS page rather than the root layout. The designer, the
 * admin dashboard and every dealer site share that layout and none of them
 * asked to be restyled a week before a beta.
 */

const display = Archivo({ subsets: ['latin'], weight: ['600', '700'], variable: '--font-display' });
const body = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-body' });
const data = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-data' });

export const metadata: Metadata = {
  title: 'Steel Sync — your lot answers at 9pm',
  description:
    'Steel Sync replies to your Facebook and website messages with real prices from your price book, then texts you the lead.',
};

/**
 * A real quote from the captured TejasMex price table, not a number chosen to
 * look good: a 24x30x9 vertical-roof garage on concrete, priced by
 * calculatePrice() at $9,297 with an 18% deposit.
 *
 * Everything else in this product refuses to show a customer a figure it did
 * not derive from a real price book. The marketing page holds to the same rule.
 */
const QUOTE = { total: '$9,297', deposit: '$1,673', balance: '$7,624' };

/** The eight the configurator opens with — enough to read as a chart, not a rainbow. */
const CHART = ['barn-red', 'burnished-slate', 'forest-green', 'tan', 'ocean-blue', 'clay', 'charcoal', 'galvalume'];

export default function HomePage() {
  const swatches = CHART.map(id => STANDARD_COLORS.find(c => c.id === id)!).filter(Boolean);

  return (
    <div
      className={`${display.variable} ${body.variable} ${data.variable} min-h-screen bg-[#E8EAE7] text-[#1C1C1C]`}
      style={{ fontFamily: 'var(--font-body)' }}
    >
      {/* ── Top bar ─────────────────────────────────────────── */}
      <header className="border-b border-[#B2BEB5]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
          <span
            className="whitespace-nowrap text-lg font-bold tracking-tight"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            STEEL SYNC
          </span>
          <nav className="flex items-center gap-5 text-sm">
            <Link
              href="/dealer/login"
              className="whitespace-nowrap text-[#36454F] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7B2D26]"
            >
              Sign in
            </Link>
            <Link
              href="/dealer/signup"
              className="hidden whitespace-nowrap rounded-sm bg-[#7B2D26] px-4 py-2 font-semibold text-white hover:bg-[#6a271f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1C1C1C] sm:inline-block"
            >
              Create your account
            </Link>
          </nav>
        </div>
      </header>

      <main>
        {/* ── Hero ──────────────────────────────────────────── */}
        <section className="mx-auto max-w-5xl px-5 pb-16 pt-14 sm:pt-20">
          <div className="grid gap-12 lg:grid-cols-[1fr_26rem] lg:gap-16">
            <div>
              <h1
                className="text-[2.75rem] font-bold leading-[0.95] tracking-tight sm:text-6xl"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Your lot answers
                <br />
                at 9pm.
              </h1>
              <p className="mt-6 max-w-md text-[1.0625rem] leading-relaxed text-[#36454F]">
                Steel Sync replies to your Facebook and website messages with real prices
                from your price book, then texts you the lead. You pick it up in the
                morning knowing the size and the number.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
                <Link
                  href="/dealer/signup"
                  className="rounded-sm bg-[#7B2D26] px-6 py-3 text-sm font-semibold text-white hover:bg-[#6a271f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1C1C1C]"
                >
                  Create your account
                </Link>
                <Link
                  href="/designer"
                  className="text-sm font-medium text-[#36454F] underline underline-offset-4 hover:text-[#1C1C1C] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7B2D26]"
                >
                  Try the designer first
                </Link>
              </div>
            </div>

            {/* ── The signature: the exchange itself ─────────── */}
            <div className="rounded-md bg-[#1C1C1C] p-5 text-white shadow-sm">
              <div
                className="mb-5 flex items-center justify-between border-b border-white/15 pb-3 text-[11px] uppercase tracking-widest text-[#B2BEB5]"
                style={{ fontFamily: 'var(--font-data)' }}
              >
                <span>Messenger</span>
                <span>9:14 PM</span>
              </div>

              <div className={`${styles.msg} ${styles.msgIn} flex justify-end`}>
                <p className="max-w-[15rem] rounded-md rounded-br-sm bg-[#36454F] px-3.5 py-2.5 text-sm">
                  how much for a 24x30 garage
                </p>
              </div>

              <div className={`${styles.msg} ${styles.msgOut} mt-3 flex justify-start`}>
                <p className="max-w-[17rem] rounded-md rounded-bl-sm bg-white px-3.5 py-2.5 text-sm text-[#1C1C1C]">
                  A 24x30x9 garage would be{' '}
                  <span className="font-semibold tabular-nums">{QUOTE.total}</span>
                  . It&rsquo;d be{' '}
                  <span className="font-semibold tabular-nums">{QUOTE.deposit}</span> down to
                  order it and{' '}
                  <span className="font-semibold tabular-nums">{QUOTE.balance}</span> due at
                  delivery.
                </p>
              </div>

              <p
                className={`${styles.msg} ${styles.msgTail} mt-5 border-t border-white/15 pt-3 text-[11px] leading-relaxed text-[#B2BEB5]`}
                style={{ fontFamily: 'var(--font-data)' }}
              >
                Priced from your own table. Never a guess &mdash; when the price
                isn&rsquo;t certain, it hands the customer to you.
              </p>
            </div>
          </div>
        </section>

        {/* ── What it does ──────────────────────────────────── */}
        <section className="border-y border-[#B2BEB5] bg-white">
          <div className="mx-auto grid max-w-5xl gap-px bg-[#B2BEB5] sm:grid-cols-3">
            <Point title="It answers, with your prices">
              Facebook Messenger and your website, from the price book you actually sell
              from. It asks what it needs to and quotes when it can.
            </Point>
            <Point title="It texts you the lead">
              A message and an email the moment someone starts talking to you &mdash; once
              per customer, not once per reply.
            </Point>
            <Point title="It gives you a website">
              A branded site with a 3D designer on it, so a customer can build the thing
              they want before they ever call.
            </Point>
          </div>
        </section>

        {/* ── The color chart ──────────────────────────────── */}
        <section className="mx-auto max-w-5xl px-5 py-16">
          <div className="grid gap-10 lg:grid-cols-[22rem_1fr] lg:items-center lg:gap-16">
            <div>
              <h2
                className="text-3xl font-bold leading-tight tracking-tight"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                They pick the colors themselves.
              </h2>
              <p className="mt-4 text-[#36454F]">
                Your customer sets the size, the roof, the doors and the colors in 3D, and
                the price moves as they go. What reaches you is a finished spec, not a
                voicemail saying &ldquo;something like a 24 by 30&rdquo;.
              </p>
              <Link
                href="/designer"
                className="mt-5 inline-block text-sm font-medium text-[#7B2D26] underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7B2D26]"
              >
                Open the designer
              </Link>
            </div>

            {/* The real chart, from the product's own STANDARD_COLORS. */}
            <ul className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
              {swatches.map(c => (
                <li key={c.id} className="flex items-center gap-2.5">
                  <span
                    aria-hidden
                    className="h-7 w-7 shrink-0 rounded-sm border border-[#B2BEB5]"
                    style={{ backgroundColor: c.hex }}
                  />
                  <span className="text-[13px] leading-tight text-[#36454F]">{c.name}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── Close ─────────────────────────────────────────── */}
        <section className="border-t border-[#B2BEB5] bg-[#C0C5C1]">
          <div className="mx-auto max-w-5xl px-5 py-14 text-center">
            <h2
              className="text-3xl font-bold tracking-tight sm:text-4xl"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Set it up in an afternoon.
            </h2>
            <p className="mx-auto mt-3 max-w-md text-[#36454F]">
              Create your account and we&rsquo;ll get your prices loaded and your page
              connected.
            </p>
            <Link
              href="/dealer/signup"
              className="mt-7 inline-block rounded-sm bg-[#1C1C1C] px-7 py-3 text-sm font-semibold text-white hover:bg-[#36454F] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7B2D26]"
            >
              Create your account
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#B2BEB5]">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-xs text-[#36454F]">
          <span className="font-semibold tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
            STEEL SYNC
          </span>
          <div className="flex gap-5">
            <Link href="/dealer/login" className="underline-offset-4 hover:underline">
              Dealer sign in
            </Link>
            <Link href="/admin/login" className="underline-offset-4 hover:underline">
              Staff
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Point({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white px-6 py-8">
      <h3 className="text-base font-semibold tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
        {title}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-[#36454F]">{children}</p>
    </div>
  );
}
