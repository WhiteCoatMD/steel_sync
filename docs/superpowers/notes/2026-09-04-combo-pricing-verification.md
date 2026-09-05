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

## MEASURED 2026-09-05 — and we are under by about a thousand dollars

Read off `design.tejasmex.com/?dealer=Columbia`, **End Combo, 24 x 30 x 9**,
changing only the storage depth in one pass so the rest of the configuration is
held constant.

| Storage depth | TejasMex | Ours | We are under by | Their step | Our step |
|---|---|---|---|---|---|
| 5ft | $8,321 | $7,414 | $907 | — | — |
| 10ft | $8,477 | $7,414 | $1,063 | +$156 | $0 |
| 15ft | $8,613 | $7,414 | $1,199 | +$136 | $0 |
| 20ft | $8,719 | $7,414 | $1,305 | +$106 | $0 |
| 25ft | $8,823 | $7,518 | $1,305 | +$104 | +$104 |

**Their depth options are exactly 5 / 10 / 15 / 20 / 25 on a 30ft building** —
the same 5ft steps stopping one short of the length that `comboDepthOptions`
already produces. The control is right. The price is not.

### The shape is wrong, not just the level

Ours is **flat** from 5ft to 20ft. That is the `sideWalls` length brackets
showing through: `[0,20]` covers every depth up to 20, so four visibly different
buildings price identically. Theirs rises at every step.

So this is not an offset we could correct with a constant. The rule has a
different form.

### A caution about method

An earlier reading of the 10ft case gave $9,482, and the same configuration
later gave $8,477. The difference was the door package: changing the width
carried over a roll-up door that the later pass did not have. **Any further
measurement has to hold doors and windows constant**, and cross-style
comparisons (carport vs combo vs garage) are only meaningful if the openings
match. The five rows above are one uninterrupted pass and are internally
consistent; the anchors are not yet measured because the style control needs its
accordion open and the attempt silently did nothing.

## What is still needed

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

---

## Geometry check — done, 2026-09-05

The pricing above is still open. The geometry is not: it was checked by eye in
the running designer at `localhost:3001/designer`, which had been blocked all
of the previous session by two browser MCP servers being down.

Verified on a 24x30x10 combo:

- The enclosure renders at the **rear**. The camera sits at `[30, 25, -40]`
  looking at a group centred on `-L/2`, so screen-right is the building's
  front; the walled block is on screen-left.
- The dividing wall draws with its gable pitched into the enclosure, and the
  open half is framed rather than empty — the defect where `FrameMeshes` gated
  on `isOpen` and left the carport half as bare ground is gone.
- The roof runs the full length over both halves.
- Cycling the depth buttons 5 -> 25 moves the divider and both side-wall runs
  together, and the hint text tracks it exactly (`5` -> "25ft open" ...
  `25` -> "5ft open").
- The depth control appears for `combo` and for no other type. `warehouse` is
  gone from the picker.
- Garage, Barn and Shop all still quote $9,818; Carport and RV Cover both
  $6,086. Combo at $9,584 sits between them, as it should.

The estimate readings also reproduce the pricing defect this note is about,
from the UI rather than from a test: depths 5, 10, 15 and 20 all quote
**$9,584** — one flat `[0,20]` sideWalls bracket — and only 25 moves, to
$9,702. TejasMex's own curve over the same range climbs on every step.

## wallFrame is combo-aware — done, 2026-09-05

`wallFrame` used to report a combo's side walls as running the whole building,
so `lib/store/designerStore.ts` asked `comboSpan` itself and the two had to be
kept in step by hand. The frame now answers: `lengthFt` stays the full frame
(the roofline, eave trim and lean-tos genuinely do run it) and new
`runStartFt` / `runLengthFt` fields carry the stretch that actually carries
wall. `openingFitsOnWall`, `validateOpening`, `findOpenSlot`, `buildWallPanels`
and the sidebar all read the run; the store's workaround is a two-line
delegation. Covered by `lib/building/__tests__/wallFrameCombo.test.ts`.
