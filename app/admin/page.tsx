import Link from 'next/link';
import { requireAdmin } from '@/lib/admin/guard';
import { listDealers, recentQuotes, recentConversations } from '@/lib/admin/data';
import DealerControls from '@/components/admin/DealerControls';

/**
 * Super-admin dashboard.
 *
 * Every page under /admin calls requireAdmin() FIRST. There is no client-side
 * check anywhere: a client guard hides the UI but still ships the data, and
 * this page carries dealer pricing and customer contact details.
 */
export const dynamic = 'force-dynamic';

const money = (cents: number | null) =>
  cents == null ? '—' : `$${Math.round(cents / 100).toLocaleString()}`;

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';

export default async function AdminPage() {
  const email = await requireAdmin();

  // One failing panel must not take the whole dashboard down.
  const [dealers, quotes, conversations] = await Promise.all([
    listDealers().catch(e => {
      console.error('[admin] dealers query failed', e);
      return [];
    }),
    recentQuotes().catch(e => {
      console.error('[admin] quotes query failed', e);
      return [];
    }),
    recentConversations().catch(e => {
      console.error('[admin] conversations query failed', e);
      return [];
    }),
  ]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <div>
            <span className="text-base font-bold tracking-tight text-gray-900">Steel Sync</span>
            <span className="ml-2 rounded bg-gray-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
              Admin
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden text-xs text-gray-500 sm:block">{email}</span>
            <form action="/api/admin/logout" method="post">
              <button className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-gray-400">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-5 py-8">
        <section className="grid gap-4 sm:grid-cols-3">
          <Stat label="Dealers" value={String(dealers.length)} />
          <Stat label="Recent quotes" value={String(quotes.length)} />
          <Stat label="Conversations" value={String(conversations.length)} />
        </section>

        {dealers.some(d => !d.active) && (
          <Panel title="Awaiting approval">
            <Table head={['Dealer', 'Contact', 'Signed up', 'Plan']}>
              {dealers.filter(d => !d.active).map(d => (
                <tr key={d.id} className="border-t border-gray-100">
                  <td className="py-2.5 pr-4">
                    <div className="font-medium text-gray-900">{d.name}</div>
                    <div className="text-xs text-gray-500">{d.id}</div>
                  </td>
                  <td className="py-2.5 pr-4 text-gray-600">{d.email || d.phone || '—'}</td>
                  <td className="py-2.5 pr-4 text-gray-600">{when(d.createdAt)}</td>
                  <td className="py-2.5">
                    <DealerControls dealerId={d.id} plan={d.plan} active={d.active} />
                  </td>
                </tr>
              ))}
            </Table>
          </Panel>
        )}

        <Panel title="Dealers">
          <Table head={['Dealer', 'Contact', 'Quotes', 'Last quote', 'Plan', 'Site']}>
            {dealers.map(d => (
              <tr key={d.id} className="border-t border-gray-100">
                <td className="py-2.5 pr-4">
                  <div className="font-medium text-gray-900">{d.name}</div>
                  <div className="text-xs text-gray-500">{d.id}</div>
                </td>
                <td className="py-2.5 pr-4 text-gray-600">{d.email || d.phone || '—'}</td>
                <td className="py-2.5 pr-4 text-gray-600">{d.quoteCount}</td>
                <td className="py-2.5 pr-4 text-gray-600">{when(d.lastQuoteAt)}</td>
                <td className="py-2.5 pr-4">
                  <DealerControls dealerId={d.id} plan={d.plan} active={d.active} />
                </td>
                <td className="py-2.5">
                  <Link href={`/site/${d.id}`} className="text-blue-600 hover:underline">
                    View
                  </Link>
                </td>
              </tr>
            ))}
            {!dealers.length && <Empty colSpan={6}>No dealers yet.</Empty>}
          </Table>
        </Panel>

        <Panel title="Recent quotes">
          <Table head={['Customer', 'Dealer', 'Total', 'Status', 'When']}>
            {quotes.map(q => (
              <tr key={q.id} className="border-t border-gray-100">
                <td className="py-2.5 pr-4 font-medium text-gray-900">{q.customerName || '—'}</td>
                <td className="py-2.5 pr-4 text-gray-600">{q.dealerId}</td>
                <td className="py-2.5 pr-4 text-gray-900">{money(q.totalCents)}</td>
                <td className="py-2.5 pr-4 text-gray-600">{q.status}</td>
                <td className="py-2.5 text-gray-600">{when(q.createdAt)}</td>
              </tr>
            ))}
            {!quotes.length && <Empty colSpan={5}>No quotes yet.</Empty>}
          </Table>
        </Panel>

        <Panel title="Inbound conversations">
          <Table head={['Channel', 'Dealer', 'Turns', 'Last outcome', 'Updated']}>
            {conversations.map(c => (
              <tr key={c.id} className="border-t border-gray-100">
                <td className="py-2.5 pr-4 font-medium text-gray-900">{c.channel}</td>
                <td className="py-2.5 pr-4 text-gray-600">{c.dealerId}</td>
                <td className="py-2.5 pr-4 text-gray-600">{c.turns}</td>
                <td className="py-2.5 pr-4 text-gray-600">{c.lastOutcome ?? '—'}</td>
                <td className="py-2.5 text-gray-600">{when(c.updatedAt)}</td>
              </tr>
            ))}
            {!conversations.length && <Empty colSpan={5}>No inbound messages yet.</Empty>}
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
