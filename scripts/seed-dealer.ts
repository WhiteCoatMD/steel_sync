import { neon } from '@neondatabase/serverless';
import { DEFAULT_PRICING_RULES } from '../lib/building/defaultConfig';

/**
 * Contact details are REQUIRED, not optional.
 *
 * Both notification channels skip when the dealer row has no phone / no email
 * (see lib/notify/*). A dealer seeded with empty strings therefore receives
 * nothing at all — every lead for that dealer lands in the database and is
 * flagged `notify_failed`, and nobody is told. Fail here, loudly, rather than
 * inserting a dealer who is silently unreachable.
 *
 * Supply via env (DEALER_PHONE / DEALER_EMAIL, optionally DEALER_ID /
 * DEALER_NAME / DEALER_WEBSITE) or as positional arguments:
 *   tsx scripts/seed-dealer.ts <phone> <email> [website]
 */
function required(name: string, value: string | undefined): string {
  const v = (value ?? '').trim();
  if (!v) {
    console.error(
      `seed-dealer: ${name} is required and was empty.\n` +
      `A dealer with no ${name} receives no lead notifications at all.\n` +
      `Set ${name} in the environment or pass it as an argument:\n` +
      `  tsx scripts/seed-dealer.ts <phone> <email> [website]`,
    );
    process.exit(1);
  }
  return v;
}

async function main() {
  const [argPhone, argEmail, argWebsite] = process.argv.slice(2);

  const id = (process.env.DEALER_ID ?? 'tejasmex').trim().toLowerCase();
  const name = (process.env.DEALER_NAME ?? 'TejasMex Metal Buildings').trim();
  const phone = required('DEALER_PHONE', argPhone ?? process.env.DEALER_PHONE);
  const email = required('DEALER_EMAIL', argEmail ?? process.env.DEALER_EMAIL);
  const website = (argWebsite ?? process.env.DEALER_WEBSITE ?? '').trim();

  const sql = neon(process.env.DATABASE_URL!);

  // `manufacturerKey` points the dealer at a captured manufacturer price file
  // (lib/pricing/data/). When it resolves, calculatePrice ignores every per-sqft
  // field in DEFAULT_PRICING_RULES and quotes from the real table instead, so
  // adding a dealer of a known manufacturer needs no price entry at all.
  //
  // Set MANUFACTURER_KEY='' to seed a dealer with no captured price file. That
  // falls back to the per-sqft rules, which are INVENTED figures and not any
  // real manufacturer's prices — hence the _placeholder marker, kept so demo
  // data can never be mistaken for real pricing.
  const manufacturerKey = (process.env.MANUFACTURER_KEY ?? 'tejasmex').trim();
  const rules = manufacturerKey
    ? { ...DEFAULT_PRICING_RULES, manufacturerKey }
    : { ...DEFAULT_PRICING_RULES, _placeholder: true };
  // approved_at is stamped HERE, not left to the column default.
  //
  // A dealer added from this script is approved by definition — someone ran it
  // deliberately. Leaving approved_at NULL would file them under "pending",
  // which is the one state activeDealerForSession lets through with
  // active = false. Suspending such a dealer would then do nothing: they would
  // read as merely-not-yet-approved and keep their dashboard, their leads and
  // their profile-edit route until the next migration's backfill happened to
  // close it. See the three-state note in lib/db/dealerUsers.ts.
  //
  // Self-signup is the opposite case and correctly leaves it NULL — nobody has
  // looked at those yet.
  await sql`
    INSERT INTO dealers (id, name, phone, email, website, pricing_rules, show_pricing, approved_at)
    VALUES (${id}, ${name}, ${phone}, ${email}, ${website},
            ${JSON.stringify(rules)}::jsonb, true, now())
    -- Repair a row whose contact fields are blank, but never clobber details
    -- that were set out-of-band: the live tejasmex row's real phone/email were
    -- entered directly against the database, not through this script.
    ON CONFLICT (id) DO UPDATE SET
      phone = CASE WHEN NULLIF(dealers.phone, '') IS NULL
                   THEN EXCLUDED.phone ELSE dealers.phone END,
      email = CASE WHEN NULLIF(dealers.email, '') IS NULL
                   THEN EXCLUDED.email ELSE dealers.email END,
      -- Repairs a pre-existing row that predates the column, for the same
      -- reason. COALESCE so a dealer's original approval date is never reset.
      approved_at = COALESCE(dealers.approved_at, EXCLUDED.approved_at),
      updated_at = now()
  `;
  console.log(`seeded dealer: ${id}`);
}

main().catch(e => { console.error(e); process.exit(1); });
