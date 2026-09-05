# Combo pricing — what we need measured

Updated 2026-09-05 after mining the raw capture. **The earlier framing was too
optimistic.** This is not one assumption to spot-check; the vendor's rule for a
combo's enclosed section is not in our data at all.

## What the capture actually contains

TejasMex models a combo's enclosed part as **storage at a given depth**, not as
walls. `options.raw.json` carries the depth options themselves —
`5-deep-storage`, `10-deep-storage`, `15-deep-storage`, in the same 5ft steps
our depth buttons use — and every one of them is marked `hasExpr: 1` with **no
price attached**. They are computed client-side, like the enclosed-wall figures
(662 / 763 / 2545) that had to be measured off the live app in the first place.

The capture's own `notModelled` list names this: *"Lean-tos, colours/premium
colour tiers, gauge/brace/truss/frame-spacing/roof-pitch deltas, **storage and
tack rooms**."*

And `walls.raw.json` has exactly one wall type across all 1020 rows,
`fully-enclosed-wall`. There is no partial-wall, dividing-wall or storage-wall
price in it.

## What we ship today, and why it is a guess

`lib/pricing/manufacturer/engine.ts` prices a combo as the frame at full size,
plus two side walls bracketed at the **enclosed depth**, plus two end walls (one
the closed outer end, one the divider). Every one of those numbers comes from
the `fully-enclosed-wall` tables.

That is the closest thing the captured data can express. It is not what the
vendor does. Their line is "storage, N ft deep"; ours is "four walls".

## The seven numbers that would settle it

One building, one axis. In `https://design.tejasmex.com/?dealer=Columbia`:

**24 wide x 30 long x 9 legs, vertical roof, concrete, horizontal siding.**

| # | Configuration | Their total | Ours |
|---|---|---|---|
| 1 | Standard Carport (no enclosure) | | $4,699 |
| 2 | End Combo, storage **5ft** | | |
| 3 | End Combo, storage **10ft** | | $7,819 |
| 4 | End Combo, storage **15ft** | | |
| 5 | End Combo, storage **20ft** | | $7,819 |
| 6 | End Combo, storage **25ft** | | |
| 7 | Garage (fully enclosed) | | $8,027 |

Change one thing at a time and read the total off. Rows 1 and 7 are the anchors;
2-6 are the curve.

## What the numbers will tell us

The differences between consecutive rows decode the rule directly:

- **Even steps** (each +5ft costs the same) — storage is priced per foot of
  depth. We replace the wall lookup with a rate.
- **Steps that jump then flatten** — it is banded like the wall tables, and we
  keep a bracket lookup but on the vendor's storage bands rather than ours.
- **A big first step then small ones** — there is a fixed cost for enclosing at
  all (the divider, most likely) plus a depth rate. That is two terms, and rows
  1 and 2 give us the fixed part.
- **Row 3 and row 5 identical, as ours are** — the banding happens to match what
  we already do, and the current approximation is closer than it deserves to be.

Rows 1 and 7 also tell us whether our base price and our fully-enclosed price
still agree with theirs at all, which is worth knowing on its own.

## Where the code changes

The wall block in `lib/pricing/manufacturer/engine.ts`, guarded by
`enclosedDepthFt > 0 && enclosedDepthFt < lengthFt` — the combo case. Whatever
shape the rule turns out to be, it goes in a new table in
`lib/pricing/data/tejasmex.json` built the way every other measured table was,
and the engine reads it rather than deriving from wall rows.

## Until then

A combo produces a confident number that is an approximation of unknown
accuracy. Everything else in this product refuses to show a customer a figure it
did not derive from a real price book, and by that standard this does not yet
qualify.
