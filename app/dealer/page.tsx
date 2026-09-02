import Link from 'next/link';
import { requireDealer } from '@/lib/dealer/guard';
import { dealerQuotes, dealerConversations, dealerAccount } from '@/lib/dealer/data';
import { planAllows } from '@/lib/plans';

/**
 * A dealer's own dashboard.
 *
 * requireDealer() FIRST on every page under /dealer, and every query takes the
 * dealer id it returns. There is no route here that names a dealer, so there is
 * nothing to tamper with.
 */
export const dynamic = 'force-dynamic';

const money = (cents: number | null) =>
  cents == null ? '—' : `$${Math.round(cents / 100).toLocaleString()}`;

const when = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export default async function DealerDashboard() {
  const { dealerId, email } = await requireDealer();

  // One failing panel must not take the whole dashboard down.
  const [account, quotes, conversations] = await Promise.all([
    dealerAccount(dealerId).catch(e => {
      console.error('[dealer] account query failed', e);
      return null;
    }),
    dealerQuotes(dealerId).catch(e => {
      console.error('[dealer] quotes query failed', e);
      return [];
    }),
    dealerConversations(dealerId).catch(e => {
      console.error('[dealer] conversations query failed', e);
      return [];
    }),
  ]);

  const aiOn = planAllows(account?.plan, 'aiAutoReply');

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <span className="text-base font-bold tracking-tight text-gray-900">
            {account?.name ?? 'Steel Sync'}
          </span>
          <div className="flex items-center gap-4">
            <span className="hidden text-xs text-gray-500 sm:block">{email}</span>
            <Link href="/dealer/settings" className="text-xs text-blue-600 hover:underline">
              Settings
            </Link>
            <form action="/api/dealer/logout" method="post">
              <button className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-gray-400">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-5 py-8">
        {/* Pending, not merely switched off. A suspended dealer never reaches
            this page at all — requireDealer() redirects them — so keying the
            banner on `active` would only ever have mislabelled someone. */}
        {account && account.approvedAt === null && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <strong className="font-semibold">Your account is awaiting approval.</strong> Your
            public site and automated replies stay switched off until it is approved.
          </div>
        )}

        <section className="grid gap-4 sm:grid-cols-3">
          <Stat label="Quotes" value={String(quotes.length)} />
          <Stat label="Conversations" value={String(conversations.length)} />
          <Stat label="AI replies" value={aiOn ? 'On your plan' : 'Not on your plan'} />
        </section>

        <Panel title="Your quotes">
          <Table head={['Customer', 'Contact', 'Total', 'Status', 'When']}>
            {quotes.map(q => (
              <tr key={q.id} className="border-t border-gray-100">
                <td className="py-2.5 pr-4 font-medium text-gray-900">{q.customerName || '—'}</td>
                <td className="py-2.5 pr-4 text-gray-600">{q.customerEmail || q.customerPhone || '—'}</td>
                <td className="py-2.5 pr-4 text-gray-900">{money(q.totalCents)}</td>
                <td className="py-2.5 pr-4 text-gray-600">{q.status}</td>
                <td className="py-2.5 text-gray-600">{when(q.createdAt)}</td>
              </tr>
            ))}
            {!quotes.length && <Empty colSpan={5}>No quotes yet.</Empty>}
          </Table>
        </Panel>

        <Panel title="Messages">
          <Table head={['Channel', 'Last message', 'Turns', 'Outcome', 'Updated']}>
            {conversations.map(c => (
              <tr key={c.id} className="border-t border-gray-100">
                <td className="py-2.5 pr-4 font-medium text-gray-900">{c.channel}</td>
                <td className="max-w-xs truncate py-2.5 pr-4 text-gray-600">{c.lastMessage ?? '—'}</td>
                <td className="py-2.5 pr-4 text-gray-600">{c.turns}</td>
                <td className="py-2.5 pr-4 text-gray-600">{c.lastOutcome ?? '—'}</td>
                <td className="py-2.5 text-gray-600">{when(c.updatedAt)}</td>
              </tr>
            ))}
            {!conversations.length && <Empty colSpan={5}>No messages yet.</Empty>}
          </Table>
        </Panel>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="text-xs font-medium uppercase tracking-wider text-gray-500">{label}</div>
      <div className="mt-1.5 text-2xl font-bold tracking-tight text-gray-900">{value}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <h2 className="border-b border-gray-100 px-5 py-3 text-sm font-semibold text-gray-900">
        {title}
      </h2>
      <div className="overflow-x-auto px-5 pb-4">{children}</div>
    </section>
  );
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <table className="w-full min-w-[36rem] text-sm">
      <thead>
        <tr className="text-left text-xs uppercase tracking-wider text-gray-500">
          {head.map(h => (
            <th key={h} className="py-2.5 pr-4 font-medium">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function Empty({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr className="border-t border-gray-100">
      <td colSpan={colSpan} className="py-6 text-center text-sm text-gray-400">
        {children}
      </td>
    </tr>
  );
}
