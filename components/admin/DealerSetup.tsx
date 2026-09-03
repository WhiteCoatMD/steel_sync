'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The three steps that used to require a terminal: point a dealer at a price
 * list, connect their Facebook page, switch the bot on.
 *
 * `manufacturers` arrives as a PROP rather than from listManufacturers(). That
 * function imports the captured price tables, and lib/pricing/data/tejasmex.json
 * alone is 245 KB — importing it here would ship the entire price book to every
 * browser that opens the admin page.
 *
 * The page token is WRITE-ONLY. The server never sends it back (see
 * lib/admin/data.ts, which reports presence and nothing else), so the field is
 * always blank on load and an empty submit leaves the stored credential alone
 * rather than wiping a working one.
 */

export interface DealerSetupState {
  id: string;
  name: string;
  plan: string;
  manufacturerKey: string | null;
  placeholderPricing: boolean;
  facebookPageId: string | null;
  hasFacebookToken: boolean;
  autoReply: boolean;
}

export default function DealerSetup({
  dealer,
  manufacturers,
}: {
  dealer: DealerSetupState;
  manufacturers: string[];
}) {
  const router = useRouter();
  const [pageId, setPageId] = useState(dealer.facebookPageId ?? '');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    setNote(null);
    setError(null);
    try {
      const res = await fetch('/api/admin/dealers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealerId: dealer.id, ...patch }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setNote('Saved.');
        setToken('');
        router.refresh();
      } else {
        setError(data.error ?? 'Could not save.');
      }
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-gray-900">{dealer.name}</span>
        <span className="font-mono text-[11px] text-gray-400">{dealer.id}</span>
      </div>

      <div className="space-y-4">
        {/* ── Pricing ─────────────────────────────────────── */}
        <Row label="Price list">
          <select
            aria-label={`Price list for ${dealer.id}`}
            value={dealer.manufacturerKey ?? ''}
            disabled={busy}
            onChange={e => save({ manufacturerKey: e.target.value || null })}
            className="rounded border border-gray-300 px-2 py-1 text-xs"
          >
            <option value="">None — cannot quote</option>
            {manufacturers.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          {dealer.placeholderPricing && (
            <p className="mt-1 text-[11px] leading-snug text-amber-700">
              No real prices. Their assistant hands off every enquiry and their designer
              shows no figure, deliberately — the fallback numbers are invented.
            </p>
          )}
        </Row>

        {/* ── Facebook ────────────────────────────────────── */}
        <Row label="Facebook page">
          <div className="space-y-1.5">
            <input
              aria-label={`Facebook page id for ${dealer.id}`}
              value={pageId}
              onChange={e => setPageId(e.target.value)}
              placeholder="Page ID"
              className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
            />
            <input
              aria-label={`Facebook page token for ${dealer.id}`}
              value={token}
              onChange={e => setToken(e.target.value)}
              type="password"
              placeholder={dealer.hasFacebookToken ? 'Token stored — leave blank to keep' : 'Page access token'}
              className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
            />
            <button
              disabled={busy || !pageId.trim()}
              onClick={() => save({
                facebookPageId: pageId.trim(),
                ...(token.trim() ? { facebookPageToken: token.trim() } : {}),
              })}
              className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:border-gray-400 disabled:opacity-50"
            >
              {dealer.facebookPageId ? 'Update page' : 'Connect page'}
            </button>
            {!dealer.hasFacebookToken && dealer.facebookPageId && (
              <p className="text-[11px] leading-snug text-gray-500">
                Listening only. Messages are parsed and logged, and nothing is sent until
                a token is stored.
              </p>
            )}
          </div>
        </Row>

        {/* ── Auto-reply ──────────────────────────────────── */}
        <Row label="Bot replies">
          <label className="flex items-center gap-2 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={dealer.autoReply}
              disabled={busy}
              onChange={e => save({ autoReply: e.target.checked })}
            />
            Let the assistant answer Messenger for them
          </label>
          {dealer.autoReply && dealer.plan !== 'pro' && (
            <p className="mt-1 text-[11px] leading-snug text-amber-700">
              Their plan is <strong>{dealer.plan}</strong>, so the assistant will not
              answer regardless — this switch controls sending, the plan controls
              whether it thinks at all.
            </p>
          )}
        </Row>
      </div>

      {note && <p className="mt-3 text-xs text-green-700">{note}</p>}
      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] items-start gap-3">
      <span className="pt-1 text-xs font-medium text-gray-500">{label}</span>
      <div>{children}</div>
    </div>
  );
}
