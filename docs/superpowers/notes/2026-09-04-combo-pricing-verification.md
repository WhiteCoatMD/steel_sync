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

## Measurement session, 2026-09-05

Re-measured on `design.tejasmex.com/?dealer=Columbia` with a scripted driver
(set width/length/height by typing into the labelled inputs, read the estimate
off the header). Recorded here so the next pass does not start from scratch.

### The earlier 5-point curve is confirmed clean

The previous session's worry that a stray roll-up door had contaminated the
readings was wrong. Clearing every wall on both sections (`Center Section` and
`Center Inner Storage`, four walls each) on a 24x30x9 End Combo at depth 15
gives **$8,613** — exactly the earlier reading. The doors visible in the
earlier screenshot were a stale render, not a priced item. So this stands:

| Depth | TejasMex | Ours |
|-------|---------:|-----:|
| 5ft  | $8,321 | $7,414 |
| 10ft | $8,477 | $7,414 |
| 15ft | $8,613 | $7,414 |
| 20ft | $8,719 | $7,414 |
| 25ft | $8,823 | $7,518 |

Steps of +156, +136, +106, +104 per 5ft — climbing and decelerating. Ours is
flat across 5-20 and steps once at 25. Both the level and the shape are wrong.

Wainscot appears on the enclosed part by default and is a colour choice, not a
priced line (it is absent from `Materials`, which carries every priced
upgrade).

### Carport and garage anchors, 24 wide, 9ft legs

| Length | Standard Carport | Garage | Difference |
|--------|-----------------:|-------:|-----------:|
| 20ft | $3,128 | $9,398 | $6,270 |
| 25ft | $3,760 | $9,634 | $5,874 |
| 30ft | $4,699 | $11,177 | $6,478 |

**The difference is not monotonic in length**, which rules out the tempting
hypothesis that a garage is a carport plus walls and that storage could
therefore be priced as the wall cost of a WxD box. They are different base
products with different base prices. Do not build the storage rule on that
assumption.

### Why the snapshot cannot answer this

Checked again directly. Every one of the 1020 rows in `walls.raw.json` carries
the key `fully-enclosed-wall` and no other wall type exists in the file. The
storage prices live in `options.raw.json` under `t: "wall-footprint"` —
`front-storage-wall-footprint`, `back-storage-wall-footprint` and friends —
and every one of them is `hasExpr: 1` with no price recorded. The capture
stored the fact that an expression exists and dropped the expression. No
amount of re-reading the snapshot will produce the rule.

### Why a short wall cannot be observed any other way

Our `sideWalls` table brackets on `[0,20]` because **no building is shorter
than 20ft**, so a whole-building measurement can never produce a 5ft or 10ft
side wall. A combo's storage is the only configuration in the product that
exposes one. That is why the bracket is flat, and why the flatness was
invisible until combos existed.

### What is still needed

The curve above is one width, one length, one leg height. Generalising it to
other widths and heights would be a guess. Either:

1. **A measurement grid** across widths and leg heights. Practical but slow:
   the configurator collapses its panel on most interactions and the CDP
   bridge stalls whenever the 3D view re-renders, so it runs at roughly one
   reading per two calls with verification.
2. **Ask TejasMex for the storage expression.** They have it — it is the
   `*-storage-wall-footprint` expression the capture dropped. One answer
   replaces the whole grid.

Until one of those lands, a combo quotes a confident number that is $900-$1,300
low at 24x30x9 and of unknown accuracy elsewhere.

---

## Everything measured before 2026-09-05 is void

Two independent contaminations, both found only once the measurement moved off
the live browser.

**A $900 roll-up door was in every reading.** The End Combo ships with doors,
windows and a roll-up. Clearing them is per-wall AND per-section: `Center
Section` has four walls, `Center Inner Storage` has two more (its front wall is
the divider, its back wall the closed gable end). In the live browser the panel
collapsed under automation often enough that the storage section's back wall
was never actually cleared — the bottom reachable there was $7,094 on a
20x30x9 d10, where a fully cleared build is **$6,194**. So the
$8,321/$8,477/$8,613/$8,719/$8,823 curve recorded twice as "clean" carried a
$900 door throughout. Discard it.

**The vendor's price is path-dependent.** The same building configured two ways
quotes two different numbers:

| Path to 24x30x9, 10ft enclosure | Quote |
|---|---:|
| Fresh page, configured directly | **$7,577** |
| Same config, reached after stepping through other sizes | $8,007 |

The Redux `options.present.selection` is byte-for-byte identical between the
two — compared as the full nested structure, not a flattened first-wins map —
and re-clearing every wall afterwards moves neither number. Some state outside
the option selection accumulates as sizes change. $7,577 is the trustworthy
figure: it is what a customer configuring from defaults sees, and it equals the
old live reading of $8,477 minus exactly the $900 door found above.

**Consequence for method:** a long sweep through many sizes in one page cannot
be trusted. Each (width, leg height) group gets a FRESH PAGE, and a depth-only
sweep inside it, with the first depth re-measured at the end as an integrity
check.

## The vendor's own curve is not monotonic

Reproduced with two independent confirmations per reading, on a 20ft-wide
building with 10ft legs at length 30:

| Depth | 15ft | 20ft |
|---|---:|---:|
| Quote | $6,971 | **$6,853** |

A deeper enclosure costs less. This is in their price book, not in the
measurement — the table we build has to reproduce it rather than smooth it out.

## Measurement rig

`scripts/probe-tejasmex.js` is the right tool and was written for exactly this.
Two things make it work where hand-driving the DOM did not:

- `hideGL()` shrinks the WebGL canvases to 1x1. A config change goes from ~40s
  to ~500ms. Pricing is computed from the Redux store, not the renderer.
- Controls are driven through their React fiber `onOptionSelected` handlers
  using real option keys (`24-wide`, `30-deep`, `9-tall`, `5-deep-storage`),
  so none of the MUI dropdown handling matters.

Style keys come from the snapshot: `metal-endcombo` is End Combo. The style
picker is card-based and is NOT an options list, so `controlByKey` cannot find
it — click the card by its label instead.

It is driven headlessly through Puppeteer rather than the user's browser:
repeatedly reloading a WebGL app crashed Chrome's GPU process enough times that
Chrome disabled WebGL browser-wide, after which the app died at boot with
`THREE.WebGLRenderer: Error creating WebGL context`. A separate headless
Chromium launched with `--enable-unsafe-swiftshader --use-angle=swiftshader`
has its own GPU process and boots fine.

## No engine schema change is needed

`sideWalls` rows are already keyed `(siding, widthBand, length bracket,
heightFt)` and the combo path already looks the wall up with
`inBracket(enclosedDepthFt, r.length)`. Short-run rows drop straight into
`lib/pricing/data/tejasmex.json`. The reason no such row exists yet is that no
building is shorter than 20ft, so a whole-building measurement can never
produce a side wall under 20ft — a combo's storage is the only configuration
that exposes one.

## The actual source of the noise: clearing is flaky, not the pricing

Everything above about "path dependence" was chasing a symptom. The decisive
test: the SAME config, same code, two consecutive fresh pages.

```
20x30x8, 20ft enclosure  ->  $6,067
20x30x8, 20ft enclosure  ->  $6,967
```

$900 apart, which is exactly the roll-up door. Clearing a wall means clicking
its tab and then its Clear button; when the tab has not re-rendered yet the
Clear lookup misses, that wall keeps its openings, and the build silently
carries the door. It fails intermittently, so runs disagreed with each other
and with themselves.

That single bug explains every earlier contradiction — the "hidden state that
accumulates as sizes change", the sweep that would not return to its starting
value, the three runs that produced three different level sets. There is no
mysterious hysteresis in the vendor's app. There was a flaky clear.

**First fix, and why it was not enough.** Repeating the clearing pass until the
TOTAL stopped changing still let contaminated rows through: two passes that
both miss the same wall agree with each other and look perfectly stable while
the door is still on the building. A run under that rule produced
`20x30x8 d25 = 7051`, which is $900 above its neighbours and was reported
`passes=2 OK`.

**The real fix is a positive check.** Openings live in
`options.present.selections` -- PLURAL, not the `selection` the probe harness
reads -- as paths carrying a `component` step:

```
section:center-section > storage:back-storage > position:front >
  position:slot-1 > component:walk-in-door-36-80-res
```

`clearVerified()` now repeats until that count is zero, which is the only
evidence the build is actually empty. Confirmed on the config that was
flapping: `20x30x8 d25` needed 1 pass one time and 3 the next, and returned
$6,151 both times. Under the old rule the 3-pass case would have been recorded
as $7,051.

Reproducible results:

| Config | Result |
|---|---|
| 20x30x8 d20, twice | $6,067 both times |
| 20x30x8 d25, twice (1 and 3 passes) | $6,151 both times |
| 20x30x9 d10, twice | $6,194 both times |
| 24x30x9 d10 | $7,577 |

The two anchors are unchanged from the values derived independently, so those
two readings were clean by luck rather than by construction.

**Standing rule for this rig:** verify emptiness by COUNTING the components in
`options.present.selections`, never by watching the total settle. A stable
total only proves two passes failed the same way. And never accept a run whose
repeat of one config disagrees with the original.

## The decomposition is confirmed

Only the two side walls vary with enclosure depth, so

```
sideWall(d) = sideWall(20) + [ total(d) - total(20) ] / 2
```

with `sideWall(20)` the existing `[0,20]` bracket price. The model predicts the
d20->d25 step as `2 x ([21,25] - [0,20])`, and that matches the measured step
at every leg height tested:

| Legs | predicted | measured |
|---|---:|---:|
| 8ft  | 2 x (362-320) = 84  | 84 |
| 9ft  | 2 x (398-346) = 104 | 104 |
| 10ft | 2 x (444-385) = 118 | 118 |
| 12ft | 2 x (522-486) = 72  | 72 |

So the grid of totals converts directly into `sideWalls` rows, anchored on
prices already in the table.

## Scope limit worth stating

`endWalls` covers widths 0-30 only and `sideWalls` has bands [12,24] and
[26,30]. Widths of 32ft and up have no enclosed-wall price at all today, for
garages as much as combos. Extending past 30ft needs its own end-wall
measurement pass and is not part of this work.

---

# The grid is measured, and the combo fix is in — 2026-09-06

## The method is settled

The one-page depth sweep, which the path-dependence scare had ruled out, is
sound once the clear is verified by counting components. It reproduces the
one-config-at-a-time readings exactly, checked four separate times:

| Config | one at a time | swept in one page |
|---|---|---|
| 20x30x9, all five depths | 6038 6194 6330 6436 6540 | identical |
| 20x30x8, all five depths | 5721 5877 6013 6067 6151 | identical |
| 24x30x9 d10 | 7577 | 7577 |
| 20x30x6 vertical, all five | — | repeated a second run exactly |

So a (width, leg height) group is one fresh page and one depth sweep, which is
what made a 14-group grid affordable at all.

## The $405 that was never there

Every combo, every garage AND a plain carport all came out $405 under the
vendor. A carport has no walls, so it could not be a wall price — that is the
only reason it was caught before being folded into one.

`$405 = $450 x 0.9`: the 27-31ft certification with the vendor's -10% width
surcharge on it. **The vendor page defaults to certified**
(`certified-140mph-30-20`, confirmed by reading the Materials control), and the
comparison was passing `engineered: false`. The engine was right and the
harness was wrong.

Anything comparing against this vendor must pass `engineered: true`, and that is
now written into the parity test rather than into anyone's memory.

## The measured curves

Fourteen groups, lengths fixed at 30ft, every reading on a build cleared to zero
opening components, each sweep re-reading a depth at the end to prove it did not
drift.

| Legs | 20 wide: 5 / 10 / 15 / 20 / 25 | 30 wide: 5 / 10 / 15 / 20 / 25 |
|---|---|---|
| 6ft  | 5109 5253 5383 5429 5493 | 9318 9462 9592 9658 9718 |
| 7ft  | 5511 5667 5803 5767 5857 | 9835 9991 10127 10075 10195 |
| 8ft  | 5721 5877 6013 6067 6151 | 10207 10363 10499 10499 10683 |
| 9ft  | 6038 6194 6330 6436 6540 | 10592 10748 10884 10976 11146 |
| 10ft | 6429 6677 6971 6853 6971 | 11120 11368 11662 11524 11792 |
| 11ft | 6821 7069 7363 7355 7487 | 11499 11747 12041 12001 12277 |
| 12ft | 7499 7747 8041 8125 8197 | 15021 15269 15563 15641 15915 |

24x30x9 was measured as a band check: 7421 7577 7713 7819 7923.

**Their curve really is non-monotonic.** At 10ft and 11ft legs, both widths, a
20ft enclosure prices BELOW a 15ft one. It reproduced on every run. The table
reproduces it rather than smoothing it, and that is deliberate.

## The rows, and why they can be trusted

`sideWall(d) = sideWall(20) + [total(d) - total(20)] / 2`, anchored on the
existing `[0,20]` price. The check is d25, which is measured AND already in the
table from the original wall measurement: the model has to reproduce `[21,25]`
without being told it. **It does, for all 14 curves.** A curve failing that
check emits no rows at all.

| Legs | 1-5ft | 6-10ft | 11-15ft |
|---|---:|---:|---:|
| 6ft | 75 | 147 | 212 |
| 7, 8, 9ft | 147 | 225 | 293 |
| 10, 11, 12ft | 173 | 297 | 444 |

Identical across BOTH width bands, and 24-wide independently reproduces
20-wide's row. The short-wall price turns out to depend only on a coarse height
tier, which is why one width per band was enough.

## What changed in the data

42 rows added, and the 14 matching horizontal `[0,20]` rows narrowed to
`[16,20]`.

The narrowing is not cosmetic. `inBracket(5, [0,20])` is true, so leaving
`[0,20]` in place makes a 5ft enclosure match two rows and lets `Array.find`
take whichever is listed first. Narrowing makes the brackets disjoint. (The
engine has a `mostSpecific` helper for the vendor's own catch-all rows, but this
catch-all was ours, so it was removed rather than tolerated.)

Nothing is stranded: the 28 `[0,20]` rows are 2 sidings x 2 bands x 7 heights,
and the merge refuses to run if a narrowing would leave a depth unpriceable.

## Where we now stand against the manufacturer

`lib/pricing/__tests__/vendorParity.test.ts` asserts our total equals the
vendor's **to the dollar** at 77 measured points — combos at every depth,
carports, and garages. 67 pass exactly. The 10 that do not are all 12ft legs,
and are described below.

Before this change, a 24x30x9 combo with a 10ft enclosure quoted $7,819 against
the vendor's $7,577. It now quotes $7,577.

## Open: 12ft legs, and it is not a combo bug

Every enclosed building at 12ft legs is short by a constant that does not move
with enclosure depth: **$287 at 20 wide, $692 at 30 wide** (length 30).

It is not the combo, and this change did not cause it. A plain **garage** at
12ft — priced entirely from rows this change never touched — is short by the
same amount:

| 12ft legs | vendor | ours | short by |
|---|---:|---:|---:|
| carport 20x20 | 2802 | 2802 | — |
| carport 20x30 | 4112 | 4112 | — |
| carport 20x40 | 5682 | 5682 | — |
| carport 30x30 | 6885 | 6885 | — |
| garage 20x20 | 6789 | 6528 | 261 |
| garage 20x30 | 8393 | 8106 | 287 |
| garage 20x40 | 10477 | 10034 | 443 |
| combo 20x30 d5..d25 | — | — | 287 at every depth |

Carports at 12ft are exact at four sizes, so base price, certification and the
leg-height charge are all correct. The gap is entirely in the walls.

**But it cannot be a merely wrong wall price.** With base/cert/leg exact, the
wall money the vendor charges is 3987 / 4281 / 4795 at lengths 20 / 30 / 40 —
all **odd** — while `2 x side + 2 x end` is even for any integer wall prices.
No set of four integer walls can produce those totals. Checked and ruled out:

- Not a forced material upgrade. Read the vendor's Materials selections for a
  carport and a garage at 20x30x12: both `14-gauge-framing`,
  `certified-140mph-30-20`, `29-gauge-sheet-metal`, `colored-screws-none`,
  `none-im`. The only difference is that the garage has a siding control at all.
- Not leftover openings. Every reading is on a build cleared to zero components.
- Not the Skytrack fee, which we already apply at 30 wide and which leaves the
  30-wide gap at $692 regardless.

The likely explanation is in this note already: the vendor computes wall prices
from an **expression** (every wall option is `hasExpr` with no price attached),
and our table is a measured integer approximation of it. At 6-11ft legs those
integers reproduce the expression exactly, at 12ft they stop.

Fixing it is a wall-price measurement pass — the same shape of work as vertical
siding below — not a combo change. The 12ft points are `it.skip` in
`vendorParity.test.ts` with their measured values kept, so they turn green on
their own when the wall prices are fixed.

**One honest consequence of landing the rows at 12ft.** The derived 12ft rows
are anchored on the same wrong `[0,20]` price, so they inherit its error
uniformly. A 20x30x12 combo used to be +$339 at d5 and +$91 at d10; it is now
-$287 at every depth. d10 is numerically worse. That is deliberate: the shape is
now right and the residual is a single constant that one fix removes, rather
than an error that changes sign with depth.

## Vertical siding is wrong at the source

Vertical siding was measured too, and it does not survive the d25 check at any
height. It is not a combo problem either:

| 20x30x6 vertical | vendor | ours | short by |
|---|---:|---:|---:|
| combo d5 | 7023 | 6377 | 646 |
| combo d10 | 7167 | 6377 | 790 |
| combo d15 | 7297 | 6377 | 920 |
| combo d20 | 7637 | 6377 | 1260 |
| combo d25 | 7857 | 6507 | 1350 |
| **garage (full)** | **8089** | **6649** | **1440** |

A plain vertical **garage** is $1,440 under. There is no combo logic in that
number at all. For comparison the horizontal equivalents match to the dollar.

The stored vertical rows are only ~11% above horizontal, while the vendor
charges roughly 40% more for vertical siding on the same building. So
**every vertical-sided enclosed building we quote is over a thousand dollars
light** — garages included, and that predates combos entirely.

No vertical short-depth rows were added. Adding them would paper over a bigger
defect with numbers derived from a broken anchor, so the vertical `[0,20]` rows
are left exactly as they were: no new failure mode, and the real problem stays
visible. Fixing it means re-measuring vertical wall prices from garages across
lengths, which is its own pass.

Measured vertical curves, kept so that pass does not start from scratch:

| Legs | 20 wide: 5 / 10 / 15 / 20 / 25 | 30 wide: 5 / 10 / 15 / 20 / 25 |
|---|---|---|
| 6ft | 7023 7167 7297 7637 7857 | 11934 12078 12208 12664 12878 |
| 7ft | 7423 7579 7715 7971 8219 | 12449 12605 12741 13083 13353 |
| 8ft | 7633 7789 7925 8271 8513 | — |

## The rig, for whoever picks this up

`scripts/probe-tejasmex.js` plus a small driver. Three things that cost real
time to learn:

- **Panels toggle.** `P.tab('Size')` on an already-open panel COLLAPSES it, and
  a collapsed panel is unmounted, so `sizeControl` returns null and every read
  comes back as nulls. Retry the toggle until the control is actually there
  rather than tracking panel state.
- **Read the size back before leaving the Size tab**, for the same reason.
- **Do not run two probe browsers at once.** The clearing pass is driven by
  wall-clock sleeps, so CPU contention makes it miss walls and report "clear
  unstable". A grid at CONC=2 is fine on its own; adding a third browser broke
  four groups in a row.

---

# Vertical siding, measured properly — 2026-09-06

Following the defect above. The headline: **the vertical premium is real, large,
and structured — but it is NOT height-independent, and the cheap fix does not
exist.** Recorded in detail so the next pass starts from evidence.

## Individual wall prices cannot be measured, and do not need to be

The Sides & Ends tab has a Walls control taking `fully-enclosed` / `gable` /
`none`, which looks like it decomposes a building into its walls. It does not
give our table's split:

| 20x30x9 horizontal | total |
|---|---:|
| Walls: none | 3786 (equals the carport exactly) |
| Walls: gable | 5136 |
| Walls: fully-enclosed | 6644 |

That implies 675 per end and 754 per side. Our table uses 979 per end and 450
per side. **Both partitions sum to the same 2858 of wall money**, and the vendor
total is all that is observable.

This is the important structural point: every enclosed configuration in this
product — garage, barn, shop, combo — uses exactly two side walls and two end
walls, so moving money between `side` and `end` cancels everywhere. The split is
unobservable and arbitrary. Only `walls = garage - carport` is real.

**Do not cycle the Walls control on one page.** Setting none -> gable ->
fully-enclosed left `fully-enclosed` at 7720 where a fresh page gives 6644.
One mode per boot.

## The vertical premium, and how far it generalises

`premium = vertical total - horizontal total` at the same size. From the combo
curves (which hold the base constant), the premium is **flat in enclosure depth
up to 15ft** and then climbs:

| 20 wide, 30 long | d5 | d10 | d15 | d20 | d25 | full 30 |
|---|---:|---:|---:|---:|---:|---:|
| premium | 1914 | 1914 | 1914 | 2208 | 2364 | 2516 |

Flat below 15ft means the vendor charges nothing extra for vertical siding on a
short storage SIDE wall; the whole premium there is the two end walls. It is the
same story at 7ft and 8ft legs (1912, flat) and at 30 wide (2616 flat at 6ft,
2614 at 7ft).

That suggested the premium might not depend on leg height at all, which would
have collapsed 126 vertical rows into 18 numbers. It predicted a vertical garage
at 20x30x9 of 9158 — **measured 9160**, and at h6 it predicts 8089 —
**measured 8089, exact**.

**Then it failed.** At 11ft legs it predicts 10159 and the real answer is
**10453**, a miss of 294 (= 2 x 147). So:

| 20x30 garage premium | 6ft | 9ft | 11ft |
|---|---:|---:|---:|
| | 2516 | 2516 | **2810** |

There is height structure, it is weak, and it steps somewhere between 9ft and
11ft. A single premium constant is wrong.

## What a real fix costs

`walls_v(L, W, h) = garage_v - carport`, with the carport side already verified
exact. Because the side/end split is free, rows can be written as
`end_v(W,h) = end_h + a(W,h)` and `side_v(L,band,h) = side_h + b(L,band,h)`.

The measurement is bounded but not small:

- `endWalls` is keyed by EXACT width (0..30), not by band, so `a` needs a width
  sweep, not one width per band.
- `sideWalls` has 9 length brackets x 2 bands.
- Both need enough leg heights to pin the step found above — at minimum 6, 9,
  10, 11, 12.

Call it 40-60 fresh-page garage measurements at roughly 4 minutes each: 3-4
hours of machine time, unattended, one browser at a time. Everything needed to
run it is in this note and in `walls.mjs` / `anchors.mjs`.

Until then the vertical rows are left exactly as they were. They are wrong by
$1,400 on a plain garage, which is bad, but they are wrong in a way that is now
measured, understood and written down rather than silently approximated.
