import { getSql } from '../lib/db';

/**
 * The facts the bot is allowed to state on a dealer's behalf.
 *
 * These live in the database because they are per-dealer and change without a
 * deploy — but that also means they exist nowhere else, so this script is the
 * copy under version control. Anything the bot can say about warranty, timing,
 * delivery or what is included is here or it is not said at all: a dealer with
 * no policies gets an honest "someone will follow up" instead.
 *
 * Run:  DEALER_ID=dunrite npm run dealer:facts
 */

interface DealerFacts {
  serviceArea: string;
  policies: string;
  offersRto: boolean;
}

/** Dunrite's, as given by the owner on 2026-08-29. */
const DUNRITE: DealerFacts = {
  serviceArea: 'Texas, Arkansas, Mississippi and Louisiana',
  offersRto: true,
  policies: [
    'What the quoted price includes: delivery, installation and anchoring.',
    'There is nothing extra for those.',
    'Warranty: 90 day workmanship warranty covering any installation issues,',
    'and a 10 year manufacturer warranty on materials.',
    'Installation timing: 3 to 4 weeks from purchase, weather permitting.',
    'Payment methods: card, check or money order.',
    'Used buildings: we do not sell used — everything is new.',
    'Self-install (we supply the material and the customer builds it): only',
    'about 10% less than the installed price, so it is usually not worth it.',
    'Say roughly 10% and let someone confirm the exact figure — do not work out',
    'a self-install price yourself.',
    'Concrete: we DO pour concrete pads in some areas but not all, so it depends',
    'where they are. Ask for their zip code and tell them someone will confirm',
    'whether we cover it — never promise concrete before that is checked.',
    'What we build: metal buildings — carports, garages, shops, RV covers, and',
    'barndominium SHELLS. We do not do the interior finish-out of a home',
    '(framing, plumbing, electrical, fixtures) — the shell only.',
  ].join(' '),
};

const FACTS: Record<string, DealerFacts> = { dunrite: DUNRITE };

async function main() {
  const dealerId = (process.env.DEALER_ID ?? 'dunrite').trim().toLowerCase();
  const facts = FACTS[dealerId];
  if (!facts) {
    console.error(
      `No facts recorded for "${dealerId}". Add them to this file rather than ` +
        'writing them straight to the database, so they survive it.',
    );
    process.exit(1);
  }

  const sql = getSql();
  const rows = (await sql`
    UPDATE dealers
       SET service_area = ${facts.serviceArea},
           policies     = ${facts.policies},
           offers_rto   = ${facts.offersRto}
     WHERE id = ${dealerId}
    RETURNING id, name
  `) as Array<Record<string, unknown>>;

  if (!rows.length) {
    console.error(`No dealer "${dealerId}". Create one with dealer:add first.`);
    process.exit(1);
  }

  console.log(`facts written for ${rows[0].id} (${rows[0].name})`);
  console.log(`  delivers to : ${facts.serviceArea}`);
  console.log(`  rent-to-own : ${facts.offersRto}`);
  console.log(`  policies    : ${facts.policies.length} chars`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
