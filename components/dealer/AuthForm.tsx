'use client';

import { useState } from 'react';

interface AuthResponse {
  ok?: boolean;
  message?: string;
  error?: string;
}

/**
 * Signup and sign-in are the same form with one extra field, so they are one
 * component. Two would drift, and the half that drifted would be the half
 * handling the server's error.
 */
export default function AuthForm({ mode }: { mode: 'signup' | 'login' }) {
  const signup = mode === 'signup';
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(signup ? '/api/dealer/signup' : '/api/dealer/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signup ? { businessName, email, phone } : { email }),
      });
      const data = (await res.json()) as AuthResponse;
      if (res.ok) setMessage(data.message ?? 'Check your email.');
      else setError(data.error ?? 'Something went wrong. Try again.');
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {signup && (
        <Field id="businessName" label="Business name" value={businessName} onChange={setBusinessName} />
      )}
      <Field id="email" label="Email" type="email" value={email} onChange={setEmail} />
      {signup && <Field id="phone" label="Phone (optional)" value={phone} onChange={setPhone} />}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {signup ? 'Create account' : 'Send sign-in link'}
      </button>

      {message && <p className="text-sm text-green-700">{message}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = 'text',
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-700">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
      />
    </div>
  );
}
