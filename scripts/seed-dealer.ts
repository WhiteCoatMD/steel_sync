import { neon } from '@neondatabase/serverless';
import { DEFAULT_PRICING_RULES } from '../lib/building/defaultConfig';

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  // PLACEHOLDER PRICING. These are invented $/sqft figures, NOT TejasMex prices.
  // Replace before any quote is presented to a customer as a real price.
  const rules = { ...DEFAULT_PRICING_RULES, _placeholder: true };
  await sql`
    INSERT INTO dealers (id, name, phone, email, website, pricing_rules, show_pricing)
    VALUES ('tejasmex', 'TejasMex Metal Buildings', '', '', '',
            ${JSON.stringify(rules)}::jsonb, true)
    ON CONFLICT (id) DO UPDATE SET updated_at = now()
  `;
  console.log('seeded dealer: tejasmex');
}

main().catch(e => { console.error(e); process.exit(1); });
