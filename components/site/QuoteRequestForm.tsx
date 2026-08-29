'use client';

import { useCallback, useState } from 'react';

/**
 * The quote form on a generated dealer site.
 *
 * Wired to /api/inbound/web, which is the SAME pipeline the Facebook channel
 * will use — so the rule about when a price may be shown lives in one place
 * rather than being re-decided here.
 *
 * Three outcomes, and the difference matters to the customer:
 *   quote    — a real number, with the breakdown
 *   clarify  — we need something before we can price it, so we ask
 *   handoff  — we understood, cannot price it automatically, a human follows up
 */

interface LineItem {
  label: string;
  amount: number;
}

interface Reply {
  kind: 'quote' | 'clarify' | 'handoff' | 'error';
  reply: string;
  total?: number;
  lineItems?: LineItem[];
  questions?: string[];
  /** Roof-style comparison, sent with the question that needs it. */
  imageUrl?: string;
}

/**
 * Keeps the thread together across turns so a follow-up answer lands in the
 * same conversation. Only a conversation key, never an authorisation — the
 * server treats it as untrusted.
 */
function sessionId(): string {
  const KEY = 'steelsync_site_session';
  try {
    const existing = window.localStorage.getItem(KEY);
    if (existing) return existing;
    const fresh = `s_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    window.localStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    // Private mode, or storage disabled. A per-load id still works for a
    // single-sitting exchange, which is the common case.
    return `s_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  }
}

export default function QuoteRequestForm({
  dealerId,
  accent,
  prompt,
}: {
  dealerId: string;
  accent: string;
  prompt: string;
}) {
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [reply, setReply] = useState<Reply | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (!message.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/inbound/web', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dealerId,
          message: message.trim(),
          sessionId: sessionId(),
          name,
          email,
          phone,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setReply(data as Reply);
      // Clear only the message: a clarifying answer is the next message, but
      // the customer should not have to retype their contact details.
      setMessage('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [message, name, email, phone, dealerId, loading]);

  const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  return (
    <div className="mx-auto w-full max-w-2xl">
      <p className="mb-4 text-sm leading-relaxed text-gray-600">{prompt}</p>

      <textarea
        value={message}
        onChange={e => setMessage(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="e.g. 24x30 enclosed garage, 10ft walls, one roll-up door and a side door"
        className="w-full resize-none rounded-lg border border-gray-300 px-3.5 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
      />

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Name"
          maxLength={80}
          className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm placeholder:text-gray-400 focus:border-gray-900 focus:outline-none"
        />
        <input
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="Email"
          type="email"
          maxLength={120}
          className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm placeholder:text-gray-400 focus:border-gray-900 focus:outline-none"
        />
        <input
          value={phone}
          onChange={e => setPhone(e.target.value)}
          placeholder="Phone"
          maxLength={40}
          className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm placeholder:text-gray-400 focus:border-gray-900 focus:outline-none"
        />
      </div>

      <button
        onClick={submit}
        disabled={loading || !message.trim()}
        style={{ backgroundColor: accent }}
        className="mt-4 w-full rounded-lg px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {loading ? 'Pricing…' : 'Get my price'}
      </button>

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

      {reply && (
        <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-5">
          {reply.kind === 'quote' && reply.total != null ? (
            <>
              <div className="text-3xl font-bold tracking-tight text-gray-900">
                {money(reply.total)}
              </div>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-gray-700">
                {reply.reply}
              </p>
              {reply.lineItems?.length ? (
                <table className="mt-4 w-full text-xs">
                  <tbody>
                    {reply.lineItems.map((l, i) => (
                      <tr key={i} className="border-t border-gray-200">
                        <td className="py-1.5 pr-4 text-gray-600">{l.label}</td>
                        <td className="py-1.5 text-right font-medium text-gray-900">
                          {money(l.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </>
          ) : (
            // clarify / handoff / error all share this shape: a message, and
            // deliberately no number.
            <>
              {/* Picture above the question it explains, matching Messenger. */}
              {reply.imageUrl ? (
                <img
                  src={reply.imageUrl}
                  alt="Regular, boxed eave and vertical roof styles compared"
                  className="mb-4 w-full rounded-lg border border-gray-200"
                />
              ) : null}
              <p className="whitespace-pre-line text-sm leading-relaxed text-gray-800">
                {reply.reply}
              </p>
            </>
          )}

          {reply.kind === 'clarify' && (
            <p className="mt-3 text-xs text-gray-500">
              Answer above and send again — we&rsquo;ll keep what you already told us.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
