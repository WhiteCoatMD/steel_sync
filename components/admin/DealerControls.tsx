'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PLAN_IDS } from '@/lib/plans';

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

  async function save(patch: { plan?: string; active?: boolean }) {
    setBusy(true);
    try {
      await fetch('/api/admin/dealers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealerId, ...patch }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select
        aria-label={`Plan for ${dealerId}`}
        value={PLAN_IDS.includes(plan as any) ? plan : 'none'}
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
  );
}
