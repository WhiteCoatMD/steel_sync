# Combo pricing verification (2026-09-04)

## What this checks, and why

The combo engine (`lib/pricing/manufacturer/engine.ts`, via `enclosedDepthFt` in
`lib/building/combo.ts`) prices a combo's walls as: two side walls run only
across the enclosed depth, and **two end walls at full price** — the outer
gable end and the interior dividing wall. Everything about that is derived
from the captured TejasMex price tables (base price by size, side-wall price
by width/length/height bracket, end-wall price by width/height) *except* one
thing: **whether TejasMex actually charges the interior dividing wall as a
full end wall at the building's width.** There is no captured data point for
a divider — every row in the captured tables describes an outer wall. The
engine currently assumes the divider costs the same as an outer end wall,
because that is the simplest reading of "one dividing wall," but it has never
been checked against the manufacturer's own configurator. This note captures
our side of that check precisely (computed straight from `calculatePrice` /
`quoteFromTable` against the real `tejasmex.json` table, not read off a
screen) and leaves a table for the owner to fill in from
`design.tejasmex.com` in about ten minutes.

All figures below use: vertical roof, concrete anchor, horizontal siding,
engineered certification (140mph wind / 25psf snow — the same reference
inputs `lib/db/__tests__/dealerPricingLive.test.ts` uses for the live
`tejasmex` dealer row), no openings, no lean-tos.

## Our figures

| Building | Our total | Our base price | Our wall lines | TejasMex total | Difference (ours − theirs) |
|---|---|---|---|---|---|
| 24x30x9 combo, 10ft enclosed | **$7,819** | $3,941 | Left Side: $346<br>Right Side: $346<br>Closed End: $1,214<br>Dividing Wall: $1,214 | _____ | _____ |
| 24x30x9 combo, 20ft enclosed | **$7,819** | $3,941 | Left Side: $346<br>Right Side: $346<br>Closed End: $1,214<br>Dividing Wall: $1,214 | _____ | _____ |
| 20x40x10 combo, 15ft enclosed | **$8,318** | $4,202 | Left Side: $385<br>Right Side: $385<br>Closed End: $1,090<br>Dividing Wall: $1,090 | _____ | _____ |

The 10ft and 20ft enclosures on the 24x30x9 combo price identically. That is
not a bug — it's the captured side-wall table doing its job: TejasMex's
side-wall price is banded by length, and both 10ft and 20ft fall in the same
`[0, 20]` band for a 24ft-wide, 9ft-leg building. (A 25ft-deep enclosure would
land in the next band, `[21, 25]`, and cost more — see
`comboPricing.test.ts`, "prices the side walls from the depth bracket.")

"Closed End" and "Dividing Wall" above are the two full-price end-wall lines
the engine charges on a combo: the outer gable end, and the interior divider.
They are priced identically because the engine currently treats the divider as
an ordinary end wall — that is the assumption under test. The quote itself now
says so, in the divider's own line ("Dividing Wall: Interior, priced as an end
wall"), so a dealer reading a combo quote can see which of its four wall lines
is the assumption rather than a measured figure.

## Comparison anchors (24x30x9 only)

A combo is partway between fully open and fully enclosed, so its total must
sit strictly between these two:

| Building | Total | Wall lines |
|---|---|---|
| 24x30x9 **garage** (fully enclosed) | **$8,027** | Left Side: $450<br>Right Side: $450<br>Front End: $1,214<br>Back End: $1,214 |
| 24x30x9 **carport** (fully open) | **$4,699** | (none) |

Check: $4,699 < $7,819 < $8,027. **Both combo totals fall between the anchors.**
No finding to flag here — the between-anchors sanity check holds.

(Base price is identical across all three 24x30x9 variants — $3,941 — because
type doesn't change the base-price lookup, only whether/how much wall gets
charged. That matches `comboPricing.test.ts`'s "does not change the base
price" assertion.)

## Owner's half: pricing the same three at TejasMex

1. Open `https://design.tejasmex.com/?dealer=Columbia`.
2. Choose **End Combo** as the building style.
3. Build, in turn, each of the three buildings below, matching these exact
   settings (vertical roof, concrete floor, horizontal siding, no doors/
   windows/lean-tos — same bare-bones spec used for our figures above):
   - 24 wide x 30 long x 9 leg, dividing wall at **10ft** from one end
     (the rest, 20ft, open)
   - 24 wide x 30 long x 9 leg, dividing wall at **20ft** from one end
     (the rest, 10ft, open)
   - 20 wide x 40 long x 10 leg, dividing wall at **15ft** from one end
     (the rest, 25ft, open)
4. For each, record the **total** their configurator shows and write it into
   the "TejasMex total" column above. Fill in the "Difference" column as
   (our total − their total).
5. If their configurator itemizes a wall or divider line, jot it down too —
   it's not required for the check but it would settle the "part of an end
   wall" case below immediately instead of needing the arithmetic.

## What each outcome means

- **Their total equals ours (difference = $0 on all three rows).** The
  assumption held: TejasMex prices the interior divider the same as a full
  end wall. Nothing in `engine.ts` changes.
- **Their total is exactly one end-wall price lower than ours** (i.e. the
  difference matches the "Closed End"/"Dividing Wall" line amount for that
  building — $1,214 for the 24x30x9 rows, $1,090 for the 20x40x10 row). The
  divider is not charged at all. Fix: in `lib/pricing/manufacturer/engine.ts`,
  push only **one** end-wall line (the outer gable end) when the enclosure is
  partial, instead of the current two.
- **Their total is lower, but by less than a full end wall.** The divider is
  charged, just not at the outer end-wall rate — probably as a cheaper
  interior partition. Record the measured per-building difference in this
  note, then price the divider line in `engine.ts` from that measured figure
  rather than reusing the end-wall lookup.
- **Their total is higher than ours, or the three differences aren't
  consistent with each other in one of the three shapes above.** Something
  else is off (siding/roof/leg mismatch between the two configurators, or a
  captured-table gap) — don't patch `engine.ts` blind; re-check the inputs
  against what TejasMex actually built before concluding anything about the
  divider.

## Where the code lives

`lib/pricing/manufacturer/engine.ts`, the wall block starting around the
`enclosedDepthFt` handling (the two end-wall `lines.push(..., 'wall', ...)`
calls, labelled `Closed End: Fully Enclosed` / `Dividing Wall: Interior,
priced as an end wall` when only part of the length is enclosed). That's the
only place a fix from this checkpoint would land. No pricing code was changed
to produce this note, and none has been since — the labels above were made
honest, the amounts behind them are untouched. The assumption can't be settled
without the manufacturer's numbers above, and guessing at it would defeat the
point of the checkpoint.

## How the "our" figures were computed

Computed directly from the real pricing path — `calculatePrice` (from
`lib/pricing/calculatePrice.ts`) against `mergePricingRules({ manufacturerKey:
'tejasmex', basePricePerSqft: 8.5 })` (the live `tejasmex` dealer row shape,
per `lib/db/__tests__/dealerPricingLive.test.ts`), plus `quoteFromTable`
directly (from `lib/pricing/manufacturer/engine.ts`) against the same
`tejasmex.json` table to pull the categorized `wall` line items, the way
`lib/pricing/manufacturer/__tests__/comboPricing.test.ts` does. Both paths
agreed on every total. No UI reading, no database, no network calls. The
throwaway script used to run these was deleted before committing this note.
