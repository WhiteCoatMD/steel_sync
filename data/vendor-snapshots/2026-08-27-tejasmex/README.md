# TejasMex / IdeaRoom vendor pricing — RAW snapshot

**Captured:** 2026-08-27
**Source:** `design.tejasmex.com/?dealer=Columbia` (public configurator, no login)
**Authorisation:** TejasMex stated they have no price sheet and directed us to pull pricing from
their designer. This is the manufacturer's own pricing, from their own public app, at their
direction.
**Vendor bundle:** `d47df5e20205df970356` · server `2.6.113` · clientId `carportview-tejasmex`

RAW capture per `docs/superpowers/specs/2026-08-20-dealer-pricing-notes.md` §5.3.
**Do not hand-edit.** Transformation happens in `scripts/build-pricing-table.cjs`, so a parsing
bug is fixed by re-running the compile, never by re-scraping.

## How it was obtained

Pricing is computed 100% client-side, so the whole price file is resident in browser memory. The
Redux store was reached through the React fiber tree (it is not a global); the `vendorData` slice
is **5.35 MB**. Extraction ran in fixed-size chunks through `console.log` and was reassembled with
byte-exact length verification — every file below matched its declared length with no chunk
missing.

`getFullVendorData()` still 403s from S3; this route does not need it.

## Files

| file | rows | contents |
|---|---|---|
| `conditions.raw.json` | 2373 | all pricing conditions: base price, leg heights, anchors, fees |
| `walls.raw.json` | 1020 | enclosed-wall pricing (horizontal/vertical siding) |
| `options.raw.json` | 1068 | every non-dealer option record + component prices |
| `pricing-config.raw.json` | — | surcharge rules, region, deposit schedule |
| `option-conditions.raw.json` | 1188 | per-option applicability + price overrides (see below) |
| `walls-measured.json` | 62 | enclosed walls, MEASURED from the live app |

Abbreviations: `p` price · `lbl` label · `len`/`w` inclusive `[min,max]` brackets · `keys`
hyphenated vendor identifiers parsed from the applicability expression · `refs` fields the
expression reads · `hp`/`vp` horizontal/vertical siding price.

### Deliberately not captured

- **142 dealer records** carrying names, addresses, phone numbers and email addresses. Out of
  scope for pricing. (The roster exists, which is useful for onboarding other dealers later.)
- `optionConditions` (1188 rows) — option applicability rules, not prices.

## The pricing model

### 1. Base price is a size-lookup TABLE, keyed on ROOF length

```json
{"label":"24x26","width":[23,24],"roofLength":[22,26],"price":3509}
```

Width comes in coarse **bands**; length brackets key on the **roof** length, not the building
length. The product ships a 6" overhang per end, so a 25' building is a 26' roof and prices as
"24x26". Confirmed by the vendor's own debug helper: `actualLength 25 → actualRoofLength 26 →
baseSizeLabel "24x26"`.

This bites at bracket edges: a 21' building has a 22' roof and crosses `[0,21]` into `[22,26]`.

### 2. Roof style selects a different base table — it is not an adder

24x26 list: regular **2857** · boxed-eave **3118** · vertical **3509** · boxed-eave-lean 3183 ·
vertical-lean 3618. The vertical−regular gap is 652 here and is not constant across sizes, so no
per-sqft "roof style modifier" can represent it.

### 3. A −10% line-item surcharge, conditional on width

```json
{ "percentChange": -0.1, "roundTo": 1,
  "categories": ["base-price","structure"],
  "conditions": [{ "type":"width", "minimum":3, "maximum":30 }] }
```

Applies to base price, leg height, certification and anchor package. **Only for widths 3–30** —
above 30 ft, full list price. Applying it unconditionally under-quotes every wide building by
~11%; omitting it over-quotes every narrow one.

**It does NOT apply to components or walls.** Measured, not inferred:

| line item | list | charged | |
|---|---|---|---|
| base (vertical 24x26) | 3509 | 3158 | surcharged |
| certification 140/35 | 350 | 315 | surcharged |
| leg height 9' | 319 | 287 | surcharged |
| anchor (asphalt) | 180 | 162 | surcharged |
| component (6x6 roll-up) | 670 | **670** | NOT surcharged |
| wall (side, enclosed) | 578 | **578** | NOT surcharged |

The component figure is a live A/B: adding a 6x6 roll-up moved the total by exactly 670, not 603.

### 4. Leg height uses DIFFERENT length brackets from base price

Keyed on width band × **building** length × height × leg type. The reference build resolves to
`12-24-wide`, length `[21,25]`, `9-tall`, `standard-legs` → **319**. Note `[21,25]` versus base
price's `[22,26]`: the two bracket sets are not interchangeable.

Leg types: `standard-legs`, `double-legs`, `deluxe-legs`. Heights 5–20 ft.

### 5. Installation surface is a priced input

It selects the anchor package, which bills as its own line:

| surface | package | list by length `[20,25] [26,40] [41,50] [51,60]` |
|---|---|---|
| Cement | Concrete Wedges (included) | 0 |
| Asphalt | Asphalt Anchors | 180 / 240 / 300 / 420 |
| Ground | Mobile Home Anchors | 180 / 240 / 300 / 420 |

### 6. Deposit is PER DEALER and tiered on subtotal

`vendor.depositAmount` says 10, but the dealer record overrides it. Columbia:

```
subtotal >= 30000 -> 21%   >= 20000 -> 20%   >= 3000 -> 18%   >= 1000 -> 12%
```

$3,760 → 18% → $676.80 due today, $3,083.20 on delivery. Matches the app exactly.

**This corrects §2 of the pricing notes** ("only sales tax varies per dealer"): the deposit
schedule varies per dealer too, and there is a vendor-level surcharge on top of list prices.

### 7. Tax is not quoted

Consistent with notes §3. `regions` is a single default region covering AR, LA, MS, OK, TX with
`priceColumn: "price"` — the region price columns in the wall data are all null, so there is
currently one price column in play.

## Parity baseline

Standard Carport **24x25x9**, Vertical, Cement, single/standard legs, Certified 140 MPH - 35 PSF,
14-gauge, 29-gauge sheet metal, galvanized screws:

```
Base Price: 24'x25'                      $3,158.00
Engineer Certified: 140 MPH - 35 PSF       $315.00
Leg Height: 9'                             $287.00
Total Estimate                             $3,760
Due Today (18%)                            $676.80
Due Upon Delivery                        $3,083.20
```

Identical to the figures recorded on 2026-08-20 — pricing did not drift in a week.

Further live-measured totals, all reproduced by the engine:

| variation | total | |
|---|---|---|
| Regular Style | 3173 | measured |
| Boxed Eave Style | 3408 | measured |
| Vertical + asphalt surface | 3922 | measured |
| Vertical + ground surface | 3922 | measured |
| Vertical + 6x6 roll-up door | 4430 | derived — the +670 door delta was measured on the enclosed build (8128 → 8798), not on this one |

And the fully enclosed build, vertical siding, 6x6 roll-up — the enclosed half is now
reproduced by the engine (the $670 door is a separate component line):

```
Base 3158 · Cert 315 · Legs 287 · Left 578 · Right 578 · Front 1606 · Back 1606 · Door 670
Total $8,798   Due Today (18%) $1,583.64
```

## Enclosed walls: measured, because the data does not contain them

Wall prices are computed client-side. Searching the entire 5.35 MB payload for
values read off the live estimate — 662, 763, 2545 — returns **nothing**. They are
not in any table, so this half of the model is a measurement captured with
`scripts/probe-tejasmex.js` into `walls-measured.json` (62 rows).

Structure established by probing:

| line item | depends on | notes |
|---|---|---|
| side wall (spans LENGTH) | width **band**, length **bracket**, height | 18/20/24ft all price identically; 21/22/23/25ft all price identically |
| end wall (spans WIDTH) | **exact** width, height | constant across length: 1155/1305/1606/2094/2545 at 18/20/24/26/30ft |

Every captured row satisfies `total = base + cert + leg + 2*side + 2*end` exactly,
which is what makes them safe to use as ground truth.

### What probing corrected in the derived model

- **Certification is a LENGTH bracket, not a wind/snow rating.** All six tiers share
  the label "Certified 140 MPH - 35 PSF"; [0,21]->300, [22,26]->350, [27,31]->450,
  [32,36]->500, [37,41]->600. Keying it on snow load was wrong on most quotes.
- **Catch-all rows must lose to specific ones.** Leg height at 24ft wide / 12ft tall
  matches both a `[0,999]` row at 2400 and a `[36,40]` row at 1044; taking the first
  match more than doubled the leg line.
- **Base price keys on the exact width bracket, not the band.** 18/20/24ft all sit in
  the 12-24 band but price at 2375/2636/3158.
- **The derived leg table is only right for heights 6-11 at lengths <= 40.** At 12ft
  it says 418 where the app charges 679 (and 679/0.9 is not an integer, so the 12ft
  leg line is not a single surcharged row). Past 40ft it has no bracket at all.
  Measured values are used there instead; outside both, the engine refuses.
- **Past ~41ft the vendor prices by COMBINING lengths** (its debug output exposes an
  "Is combining multiple lengths" flag). Base price, certification and leg height
  all run out together at that boundary. 45/50/55/60ft work only because they were
  measured; 44ft is refused.

## Coverage today

Verified exactly against the live app:

- **Open structures** — base price, roof style, leg height, certification, anchor
  package, components, surcharge and deposit, for widths 12-30 at heights 6-11 and
  lengths up to 41 (plus measured 45-60).
- **Enclosed** — every one of the 62 measured configurations, reproduced line for
  line. That is width 24 at heights 6-12 across lengths 20-60, width 30 at height 8,
  and widths 18/20/26 at height 9.

## The applicability layer (`optionConditions`)

1,188 rows carrying `optionKey`, `visible`, `price`, `priceCalculation`,
`priceExpression` and a gating `expression`. This is what decides whether an option
is offered at all and what it costs at a given size — and it was the piece missing
from the first extraction. 292 rows carry a price:

| type | rows | prices |
|---|---|---|
| corner-style | 157 | 0 / 50 / 100 |
| component | 77 | per-size overrides of the component list |
| gauge | 16 | 12-gauge upgrade: 250-450 (12-24 wide), 350-550 (26-30), 1000-1800 (32-60) |
| wainscot | 16 | 350-650 |
| additional | 12 | `colored-screws` 3% of base (min 350), `self-install-diy` -15% of subtotal |
| insulation | 12 | 1.6 / 2.2 |

**Not yet usable, and NOT recoverable from this snapshot.** Verified 2026-08-28:
within a band, the rows are byte-identical apart from the price.

    12-24 band gauge rows:  p=250..450, every one refs=["width"] nums=[1,0,12,24]
    vertical wainscot:      p=350..650, every one refs=["width","style","wall"]
                                        nums=[12,24,26,30,32,60,0]
    7 rows, 1 distinct signature once price is ignored.

The capture reduced each expression to `keys`/`nums`/`refs`, and for these rows
that reduction is **lossy** — the discriminating term is simply gone. So
re-running the same extraction produces the same unusable rows. The mapping can
only come from (a) a re-capture that walks the expression structure instead of
flattening it, (b) measurement, or (c) the vendor.

Note also that the earlier guess in this file — that the five gauge prices differ
by a *length* condition — is contradicted by the data: `refs` names `width`, and
`nums` carries no length brackets. Do not build on that guess.

One hypothesis worth testing cheaply: the 12-24 band offers exactly five
"standard" widths (12, 18, 20, 22, 24) and carries exactly five gauge prices
(250/300/350/400/450), ascending. The 26-30 band has five prices too. If gauge is
simply keyed per offered width, a five-probe width sweep per band settles it.

**Colours carry no price anywhere** — all 109 colour rows are unpriced, so the
"29 Gauge Premium Color" upcharge is computed like the walls are.

### Wainscot: only the VERTICAL one is priced

Per the owner (2026-08-28), and confirmed in the data:

- **Horizontal wainscot is appearance only, free.** `option-conditions[871]` —
  `horizontal-siding` + `steel-30-inch` wainscot — is explicitly **`p: 0`**.
  The `wainscot` option record is a `color-group`, and colours are unpriced.
- **Vertical wainscot costs extra**: `vert-wainscot-group` is an
  `additional-group`, and rows 872-878 price `vertical-siding` at 350-650.
  (Rows 864-870 repeat the same seven for the green-house variants.)

So wainscot needs no *discovery*, only *disambiguation* — which of the seven
known prices applies where. That is a much smaller question than the walls were.

**But it CANNOT be measured through this dealer's designer.** Confirmed live
2026-08-28: there is no wainscot control on any tab (Style, Size, Sides & Ends,
Materials, Doors & Windows, Colors, Estimate), enclosed or open, on vertical
siding, and on barn/garage building types. The live option record says why:

```json
{"type":"wainscot","key":"steel-30-inch","price":0,
 "priceType":"ends-and-sides","wainscotType":"steel-36-inch",
 "tags":"[\"12-24-wide\",\"26-30-wide\",\"32-60-wide\"]"}
```

…and its group is `vert-wainscot-group`, labelled **"Vertical Wainscot (not
displayed)"**. The base record carries `price: 0` (the real money is in the
seven `optionConditions` rows), and the group is deliberately hidden, so the
configurator never offers it and no probe can price it.

Two useful facts did come out of the live record:

- `priceType: "ends-and-sides"` — wainscot is charged per end **and** per side,
  the same shape as the enclosed walls. So the seven prices are very likely a
  per-wall rate, not a whole-building total.
- `tags` spans all three width bands, so the seven rows cover 12-60ft, not just
  the 12-24 band. The tempting "7 prices = 7 widths at 2ft steps across 12-24"
  coincidence is therefore probably wrong — do not build on it.

**Only the vendor can settle this one.** The question is now precise: "for
30-inch steel wainscot on vertical siding, which of 350/400/450/500/550/600/650
applies, and is it per wall or per building?"

## The Skytrack lift fee — MEASURED 2026-08-28, now ACTIVE

A real vendor rule — `conditions[2945]`, a flat 2400 gated on height, width and leg
type with thresholds at 13 and 15 — billed in its own "Service Fees" category after
the subtotal. It is now modelled as `table.serviceFees` and applied by the engine.

**The trigger is width-dependent, exactly as the 13/15 pair suggested.** Measured
live on open, standard-leg, vertical builds at length 25:

| width | 12ft | 13ft | 14ft | 15ft |
|---|---|---|---|---|
| 24 | no | no | no | **FEE** |
| 26 | no | **FEE** | | |
| 28 | | **FEE** | | |
| 30 | | **FEE** | | |
| 40 | | **FEE** | | |

So: **width ≥ 26 trips at 13ft; width ≤ 24 trips at 15ft.** That reconciles both
earlier observations — the owner's "14ft up" report and the clean 24x25x14 — because
a *narrow* build genuinely does not trip until 15ft, while the 40ft-wide one trips
at 13.

The engine reproduces all six measured totals exactly. Because only `standard-legs`
was measured and the rule's own `refs` name `leg`, fee-range geometry on any other
leg type is reported `unpriceable` rather than guessed either way.

### Correction: the fee is NOT in the deposit base

An earlier note in this file said it was. It is not. At 30x25x13 the vendor charged
18% of the **6208 subtotal** (1117.44), not of the 8608 total, and took the fee in
the balance (7490.56). Same at 40x25x13: 1799.64 = 18% of the 9998 subtotal. So:

    deposit = pct x subtotal (excluding fees)
    balance = total - deposit (including fees)

### A second bug this uncovered

`conditions[2945]` is *shaped* like a leg-height row — same condition type, a
`-tall` key, a `-legs` key and a width band — so the compiler was emitting it into
the ladder as "12ft standard legs, width 12-24, length [0,999] = 2400". That
`[0,999]` bracket was the only one covering lengths past 40ft, so it silently won
the lookup and quoted a **$2,160 leg height** (2400 less the 10% width surcharge) on
a 24x45x12 build whose true leg price is ~$1,044 — with no `unpriceable` flag. The
compiler now excludes it by `gi`, and those builds correctly report that the ladder
has no row instead.

## Size increments (owner, 2026-08-28)

**Width is built in 2ft increments; an odd width is priced at the next one up** —
a 21ft building prices as a 22ft. Mostly this already fell out of the vendor's
own width bands (27 lands in `[26,30]` and prices as 28, 29 as 30), but **width
25 fell in the hole between `[12,24]` and `[26,30]`**: no base row, no
certification tier, no leg-height row — and it still returned a non-zero total
(4104) alongside the unpriceable flags, which is the worst possible shape for a
money bug. The engine now normalises width up to the next even foot before every
lookup, so 25 quotes as 26 and nothing in 12-30 is unpriceable.

**Length is described the same way, in 5ft increments — but this is NOT yet
implemented, because the vendor's own data does not clearly agree.** The two
disagree by exactly one certification step:

- base price keys on **roof** length, so a 21ft building is a 22ft roof, lands in
  bracket `[22,26]`, and prices like a 25;
- certification keys on **building** length, so 21 lands in `[0,21]` and charges
  270 where a 25 charges 315.

Net: 24x21 quotes 3715, 24x25 quotes 3760. Only lengths 20/25/30/35/40 were ever
measured live, so which one the vendor actually bills for a 21ft build is
**unverified**. One probe settles it. Until then the engine keeps the vendor's
own bracket rather than guessing, and the behaviour is pinned in
`__tests__/increments.test.ts` as an observation.

## A trap worth knowing: leg-type drift

The configurator silently switches leg type — a width change to 40ft flips the build
to double legs and the choice STICKS. An entire height-12 sweep was captured that
way, and 861 briefly looked like evidence that enclosing a building changes its leg
price. It is simply the double-leg ladder (957 x 0.9). The derived ladder was right
all along and matches the live app at 12/13/14ft (536/842/920) on an open build.

`scripts/classify-measured-legs.cjs` labels every measured row with the leg type it
was actually captured under, by matching the recorded amount against the ladder. Any
future probe run should pin the leg type explicitly.

## Known gaps

The engine reports each of these as `unpriceable` rather than guessing:

- **Enclosed walls outside the measured grid** — the 26-30 width band has only width
  30 at height 8; heights 13+ are unmeasured.
- **Widths over 30ft** — multi-section "Triple Wide" builds.
- **Leg heights above 14ft** — the ladder has no row past 14.
- **Gauge, wainscot, insulation, corner style, colours** — present in the data but
  not resolvable without either the raw expressions or measurement.
- **The Skytrack fee on non-standard leg types** — the trigger is measured for
  `standard-legs` only; `double-legs` / `deluxe-legs` in fee range are refused.
- **Leg heights past the ladder at long lengths** — e.g. 24x45x12: the ladder's
  width 12-24 band stops at length 40. (Previously masked by the fee row; see above.)
- **Lean-tos, storage and tack rooms.**
- Enclosed measurements are all **vertical roof**.

## Re-running the probe

`scripts/probe-tejasmex.js` documents the method. Two things make it practical:
hiding the WebGL canvases (a config change blocks the main thread ~10s otherwise,
~27s enclosed), and grabbing each control's React `onOptionSelected` prop rather
than dispatching Redux actions, which the app reverts or crashes on.

The app degrades as it runs — throughput falls from ~4s per probe to ~35s after a
couple of dozen changes, and eventually the estimate panel stops re-rendering while
`getTotalPrice()` keeps updating, which silently desyncs what you read from what you
set. Reload every ~10-15 probes, and cross-check the panel's own size label against
the size you asked for. Results are written to `localStorage.__probeG` every few
probes so a reload never loses them.
