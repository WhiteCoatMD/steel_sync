/**
 * Point a dealer row at a captured manufacturer price file.
 *
 * WHY THIS EXISTS
 * ---------------
 * The seeded dealer carries INVENTED per-square-foot pricing marked
 * `_placeholder: true`. Real pricing comes from a captured manufacturer table
 * (lib/pricing/data/), which calculatePrice() uses only when the dealer's
 * pricing_rules name it via `manufacturerKey`. Until that key is on the row,
 * production quotes placeholder numbers with nothing erroring — so this is the
 * step that actually switches a dealer onto real prices.
 *
 * Dry run by default. Nothing is written without --apply.
 *
 *   node scripts/set-dealer-manufacturer.mjs                      # show current state
 *   node scripts/set-dealer-manufacturer.mjs --apply              # set tejasmex on dealer 'tejasmex'
 *   node scripts/set-dealer-manufacturer.mjs --dealer=X --key=Y --apply
 *
 * The update is a targeted jsonb edit: it sets `manufacturerKey`, drops the
 * `_placeholder` marker, and leaves every other rule untouched. The per-sqft
 * fields are deliberately left in place — they are ignored while a manufacturer
 * key resolves, and keeping them means removing the key cleanly reverts.
 */
import { readFileSync } from 'fs';
import { neon } from '@neondatabase/serverless';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const arg = (name, fallback) => {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const dealerId = arg('dealer', 'tejasmex');
const manufacturerKey = arg('key', 'tejasmex');

// Fail loudly rather than writing a key no table answers to: an unknown key
// silently falls back to the placeholder per-sqft path, which is the exact
// failure this script exists to end.
const table = JSON.parse(readFileSync('lib/pricing/data/tejasmex.json', 'utf8'));
const known = new Set([table.manufacturer]);
if (!known.has(manufacturerKey)) {
  console.error(`No captured price table for '${manufacturerKey}'. Known: ${[...known].join(', ')}`);
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

const show = (label, pr) => {
  console.log(`  ${label}`);
  console.log(`    manufacturerKey : ${pr?.manufacturerKey ?? '(absent)'}`);
  console.log(`    _placeholder    : ${pr?._placeholder ?? '(absent)'}`);
  console.log(`    basePricePerSqft: ${pr?.basePricePerSqft ?? '(absent)'}  <- ignored once a key resolves`);
};

const before = await sql`SELECT id, name, active, pricing_rules FROM dealers ORDER BY id`;
console.log(`dealers: ${before.length}\n`);
for (const r of before) {
  console.log(`- ${r.id}  (${r.name}${r.active ? '' : ', INACTIVE'})`);
  show('current:', r.pricing_rules || {});
}

const target = before.find(r => r.id === dealerId);
if (!target) {
  console.error(`\nNo dealer row with id '${dealerId}'.`);
  process.exit(1);
}

console.log(`\n=> would set manufacturerKey='${manufacturerKey}' and drop _placeholder on '${dealerId}'`);
console.log(`   price table: ${table.manufacturer} captured ${table.capturedAt}, vendor ${table.sourceVersion}`);

if (!apply) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply to commit.');
  process.exit(0);
}

const [updated] = await sql`
  UPDATE dealers
  SET pricing_rules = (pricing_rules - '_placeholder')
                        || jsonb_build_object('manufacturerKey', ${manufacturerKey}::text),
      updated_at = now()
  WHERE id = ${dealerId}
  RETURNING id, pricing_rules
`;

console.log('\nAPPLIED');
show('now:', updated.pricing_rules);
