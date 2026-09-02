'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PLAN_IDS, isPlan } from '@/lib/plans';

/**
 * Approve, re-plan or switch off one dealer.
 *
 * Client-side only because it posts and refreshes; the authority is the route,
 * which calls requireAdmin() before reading the body.
 */
export default function DealerControls({
  dealerId,
  plan,
  active,
}: {
  dealerId: string;
  plan: string;
  active: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: { plan?: string; active?: boolean }) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/dealers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealerId, ...patch }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Could not save.');
      }
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <select
          aria-label={`Plan for ${dealerId}`}
          value={isPlan(plan) ? plan : 'none'}
          disabled={busy}
          onChange={e => save({ plan: e.target.value })}
          className="rounded border border-gray-300 px-1.5 py-1 text-xs"
        >
          {PLAN_IDS.map(p => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <button
          disabled={busy}
          onClick={() => save({ active: !active })}
          className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:border-gray-400 disabled:opacity-50"
        >
          {active ? 'Deactivate' : 'Approve'}
        </button>
      </div>
      {error && <p className="max-w-[12rem] truncate text-xs text-red-600" title={error}>{error}</p>}
    </div>
  );
}
