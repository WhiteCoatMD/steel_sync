'use client';

import { useState } from 'react';
import type { DealerAccount } from '@/lib/dealer/data';

export default function ProfileForm({ account }: { account: DealerAccount }) {
  const [f, setF] = useState({
    name: account.name ?? '',
    email: account.email ?? '',
    phone: account.phone ?? '',
    website: account.website ?? '',
    serviceArea: account.serviceArea ?? '',
    policies: account.policies ?? '',
    offersRto: account.offersRto,
  });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof f) => (v: string | boolean) => setF(p => ({ ...p, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    setError(null);
    try {
      const res = await fetch('/api/dealer/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(f),
      });
      const data = await res.json();
      if (res.ok) setNote(data.message ?? 'Saved.');
      else setError(data.error ?? 'Could not save.');
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Text id="name" label="Business name" value={f.name} onChange={set('name')} />
      <Text id="email" label="Email for new leads" value={f.email} onChange={set('email')} />
      <Text id="phone" label="Phone" value={f.phone} onChange={set('phone')} />
      <Text id="website" label="Website" value={f.website} onChange={set('website')} />
      <Area
        id="serviceArea"
        label="Where you deliver"
        hint="Plain words. The assistant reads this to answer “do you deliver to…”."
        value={f.serviceArea}
        onChange={set('serviceArea')}
      />
      <Area
        id="policies"
        label="Facts the assistant may state"
        hint="Warranty terms, site prep, anything it should be able to answer without you."
        value={f.policies}
        onChange={set('policies')}
      />
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={f.offersRto}
          onChange={e => set('offersRto')(e.target.checked)}
        />
        We offer rent-to-own
      </label>

      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        Save
      </button>
      {note && <p className="text-sm text-green-700">{note}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}

function Text({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-700">{label}</label>
      <input
        id={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
      />
    </div>
  );
}

function Area({ id, label, hint, value, onChange }: { id: string; label: string; hint: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-700">{label}</label>
      <p className="text-xs text-gray-500">{hint}</p>
      <textarea
        id={id}
        rows={3}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
      />
    </div>
  );
}
