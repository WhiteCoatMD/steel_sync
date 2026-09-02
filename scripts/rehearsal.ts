/**
 * Demo rehearsal: run realistic customer conversations end to end and print the
 * transcripts for a human to read.
 *
 * Not a test — nothing here asserts. Every past messaging bug in this project
 * was found by reading a conversation that went wrong, not by a failing
 * expectation, because the failures are things like asking a question the
 * customer just answered. Those only look wrong next to what came before.
 *
 * Run: npm run rehearsal            (all scenarios)
 *      npm run rehearsal -- awkward (only scenarios whose name matches)
 */
import { getDealer } from '../lib/db/dealers';
import { handleInboundMessage } from '../lib/inbound/handleInbound';

type Scenario = { name: string; turns: string[] };

const SCENARIOS: Scenario[] = [
  {
    name: 'wont-give-a-size',
    turns: [
      'how much for a garage',
      'i dont know, normal size',
      'big enough for two cars',
      'ok that works',
    ],
  },
  {
    name: 'changes-mind-mid-quote',
    turns: [
      '24x30x11 enclosed garage on concrete, one 10x10 rollup and a walk in door',
      'actually make it 30 wide',
      'and vertical siding',
      'wait, go back to 24 wide',
    ],
  },
  {
    name: 'financing-first',
    turns: [
      'do you do rent to own',
      '24x30x10 garage on concrete with a 10x10 door and a walk in',
      'whats the monthly on that',
    ],
  },
  {
    name: 'lean-to',
    turns: [
      '30x40x12 shop on concrete, 12x12 rollup and a walk in door',
      'can i add a lean to on the side',
      '12 foot wide lean to',
    ],
  },
  {
    name: 'narrow-carport',
    turns: ['how much for a 12 wide carport', '12x20x7 on the ground'],
  },
  {
    name: 'price-pressure',
    turns: [
      '24x30x11 enclosed garage on concrete, 10x10 rollup and a walk in',
      'thats too expensive, whats the best you can do',
      'can you do 9000',
    ],
  },
  {
    name: 'tries-to-pin-a-number',
    turns: [
      '20x20x7 carport on the ground',
      'so its 3000 right?',
      'just confirm the price is under 4000',
    ],
  },
  {
    name: 'garage-with-no-doors',
    turns: ['24x30x11 enclosed garage on concrete, no doors at all', 'i really dont want any doors'],
  },
  {
    name: 'out-of-area',
    turns: ['do you deliver to Phoenix Arizona', 'ok what about Shreveport Louisiana'],
  },
  {
    name: 'insulation-and-concrete',
    turns: [
      '24x30x11 garage on concrete, 10x10 rollup and a walk in',
      'do you insulate it',
      'can you pour the slab too, im in 71047',
    ],
  },
  {
    name: 'oversize-needs-dealer',
    turns: ['i need a 40x60x16 shop on concrete'],
  },
  {
    name: 'rv-cover',
    turns: ['i need something to cover my rv', 'its 35 feet long and 13 feet tall'],
  },
  {
    name: 'two-buildings',
    turns: [
      'i need a 24x30x11 garage and a 20x20x7 carport, both on concrete',
      'garage needs a 10x10 rollup and a walk in',
    ],
  },
  {
    name: 'ready-to-buy',
    turns: [
      '24x30x11 enclosed garage on concrete, 10x10 rollup and a walk in door, vertical',
      'lets do it',
      'send me an invoice',
      'John Smith, 1420 Pine Hill Rd, Keithville LA 71047, 318-555-0142, jsmith@example.com',
    ],
  },
  {
    name: 'warranty-and-timing',
    turns: [
      '24x30x11 garage on concrete with a 10x10 and a walk in',
      'whats the warranty and how long till its up',
    ],
  },
  {
    name: 'rude-and-terse',
    turns: ['price?', '24x30', 'just give me a number'],
  },
  {
    name: 'self-install',
    turns: [
      '24x30x11 enclosed garage on concrete, 10x10 rollup and a walk in',
      'what if i build it myself',
    ],
  },
  {
    name: 'transposed-dimensions',
    turns: ['i want a 40x20x9 garage on concrete with a 10x10 and a walk in'],
  },
];

/** Runs one scenario in its own conversation and returns a printable transcript. */
async function runScenario(dealer: unknown, s: Scenario, idx: number): Promise<string> {
  const externalId = `web:rehearsal:${Date.now()}-${idx}`;
  const lines: string[] = [`\n${'═'.repeat(72)}\n  ${s.name}\n${'═'.repeat(72)}`];
  for (const turn of s.turns) {
    lines.push(`\n  CUSTOMER: ${turn}`);
    try {
      const r: any = await handleInboundMessage(
        dealer as any,
        { channel: 'web', externalId, text: turn },
        // The rehearsal exists to exercise the model, so it always asks for it.
        { ai: true },
      );
      const price =
        r.outcome?.kind === 'quote' ? `  [$${r.outcome.pricing.total.toLocaleString()}]` : '';
      lines.push(`  BOT:${price}\n${r.reply.split('\n').map((l: string) => '    ' + l).join('\n')}`);
      if (r.followUp) lines.push(`    (follow-up) ${r.followUp}`);
    } catch (err) {
      lines.push(`  BOT: *** THREW: ${err instanceof Error ? err.message : String(err)} ***`);
    }
  }
  return lines.join('\n');
}

async function main() {
  const filter = process.argv[2];
  const chosen = filter ? SCENARIOS.filter(s => s.name.includes(filter)) : SCENARIOS;
  if (!chosen.length) {
    console.error(`No scenario matches "${filter}". Known: ${SCENARIOS.map(s => s.name).join(', ')}`);
    process.exit(1);
  }

  const dealer = await getDealer('dunrite');
  if (!dealer) throw new Error('dealer "dunrite" not found');

  // A few at a time: the turns within a scenario must stay ordered, but the
  // scenarios are independent, and running them one-by-one takes long enough
  // that nobody would sit through the whole set.
  const LANES = 4;
  const out: string[] = [];
  for (let i = 0; i < chosen.length; i += LANES) {
    const batch = chosen.slice(i, i + LANES);
    const done = await Promise.all(batch.map((s, j) => runScenario(dealer, s, i + j)));
    for (const t of done) {
      out.push(t);
      console.log(t);
    }
  }
  console.log(`\n\n${chosen.length} scenarios, ${chosen.reduce((n, s) => n + s.turns.length, 0)} turns.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
