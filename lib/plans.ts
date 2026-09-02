/**
 * What a dealer's subscription lets them do.
 *
 * The plan is a LABEL on the dealer row; what it means lives here, next to the
 * gate that enforces it, so reading one tells you the other. Billing, when it
 * arrives, writes the label and nothing downstream changes.
 *
 * `starter` and `none` grant the same thing today. That is deliberate: they are
 * different BILLING states — unapproved or lapsed, versus paying without AI —
 * and keeping them apart now means a future paid capability has a tier to land
 * on without a data migration.
 */

export const PLAN_IDS = ['none', 'starter', 'pro'] as const;

export type Plan = (typeof PLAN_IDS)[number];

export type Capability = 'aiAutoReply';

const PLANS: Record<Plan, Record<Capability, boolean>> = {
  none: { aiAutoReply: false },
  starter: { aiAutoReply: false },
  pro: { aiAutoReply: true },
};

export function isPlan(v: unknown): v is Plan {
  return typeof v === 'string' && (PLAN_IDS as readonly string[]).includes(v);
}

/**
 * Fails CLOSED on anything unrecognised. `plan` is a hand-edited text column;
 * a typo must cost a dealer a feature they paid for — which someone will
 * report — rather than hand a feature to someone who did not.
 */
export function planAllows(plan: unknown, capability: Capability): boolean {
  if (!isPlan(plan)) return false;
  return PLANS[plan][capability] === true;
}
