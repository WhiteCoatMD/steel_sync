# Roof profile differentiation (feat/roof-profiles)

## Problem

The three roof styles (`regular`, `aframe`, `vertical`) rendered almost
identically. Two causes, both diagnosed in the task brief:

1. `RoofMeshes` in `components/designer/ThreeScene.tsx` built roof vertices
   inline. The `regular` branch placed the eave at `H - DROOP` (6" below wall
   height), leaving the top 6" of wall exposed above the roof edge as a
   visible colour stripe. Its "rounded" profile was a two-segment polyline
   (eave -> transition at 12% -> ridge) — a kink, not a radius — and it had
   zero lateral eave overhang (`eaveOvh = 0`).
2. `lib/building/trim.ts`'s `buildTrim` never read `config.roofStyle`, so
   ridge/eave/corner/base/rake trim was identical across all three styles.

## What changed

### `lib/building/roof.ts` — new pure `buildRoofProfile`

Added `RoofProfile` (`{ positions, uvs, indices }`) and
`buildRoofProfile(config: BuildingDimensions, overhangFt: number): RoofProfile`,
which branches on `config.roofStyle`:

- **`aframe` / `vertical`** (`buildStraightRoofProfile`): unchanged geometry —
  a single quad per slope from a flat eave overhang (`overhangFt` past the
  wall face) up to the ridge.
- **`regular`** (`buildRegularRoofProfile`): the panel now meets the wall
  **at** `H` (fixes the exposed-wall stripe), then wraps outward and down
  around the corner as a tessellated quarter-round before terminating past
  the wall face.

**Eave radius and segment count chosen:** radius = **0.5 ft (6")**, tessellated
into **6 segments**. Rationale:
- 0.5 ft sits in the middle of the realistic 0.5–0.75 ft band given in the
  brief for a wrapped-panel bend radius, and matches the scale of the other
  eave-related constant already in the file (`ROOF_OVERHANG_FT = 0.5`), so
  it reads as an intentional, coherent dimension rather than a new magic
  number.
- 6 segments turns the curve into a visibly rounded profile instead of a
  kink, without over-tessellating what's a small corner detail relative to
  the building's overall scale.

The curve is parameterized by `theta` from `-PI/2` (outer tip, past the wall
face, below `H`) to `0` (shoulder, exactly at the wall face, at `H`), circle
centered at `(-r, H)` relative to the left wall face; the right slope mirrors
the same offsets outward from `x = W`.

**UV convention preserved:** U runs across the slope from eave (U=0) to
ridge (U=1); V runs along the building length front (V=0) to back (V=1) —
unchanged from the original inline code. For the regular wrap, U is arc-length
parameterized (`arcLen / totalLen`, where `totalLen = curveArc + slopeLen`)
so texture/rib spacing stays even across the bend and the straight slope
rather than being distorted at the transition. `aframe`/`vertical` keep the
exact original 4-vertex-per-side UV layout (0/1 at eave, 1/0 or 1/1 at ridge).

`components/designer/ThreeScene.tsx`'s `RoofMeshes` was rewritten to call
`buildRoofProfile(building, ovh)` and only build the `BufferGeometry` from the
returned flat arrays (`position`/`uv` attributes + index), removing ~70 lines
of inline vertex math. `RoofMeshes` now takes a `building: BuildingDimensions`
prop instead of a bare `roofStyle` string.

### `lib/building/trim.ts` — style-aware `buildTrim`

`buildTrim` already received the full `BuildingDimensions` (including
`roofStyle`) but ignored it. Now:

- **`regular`**: no `eave` fascia pieces, no `rake` pieces. Corner and base
  trim unchanged. (The wrapped panel *is* the edge — the absence is what
  reads as the economy profile.)
- **`aframe`**: unchanged — eave fascia + rake trim on gable ends (already
  present, now gated on `!isRegular` alongside vertical).
- **`vertical`**: ridge cap scaled 1.8x (both width and height) relative to
  the other styles' ridge cap, making it visibly larger/more prominent; keeps
  eave fascia and rake trim like `aframe`.

`TrimPiece`'s shape and categories (`ridge | eave | corner | base | rake`)
are untouched — no new type system introduced.

## Constraints honored

- `'aframe'` member name untouched (still keys `roofStyleModifiers`).
- Did not modify `lib/pricing/calculatePrice.ts`, `lib/building/wallFrame.ts`,
  `lib/db/**`, or `lib/notify/**`.
- No price logic touched — roof geometry/trim are purely cosmetic.

## TDD: tests written first, confirmed failing, then made to pass

Created `lib/building/__tests__/roof.test.ts` (5 tests) and
`lib/building/__tests__/trim.test.ts` (3 tests) before any implementation
changes. Ran them against the pre-fix code:

```
npx vitest run lib/building/__tests__/roof.test.ts lib/building/__tests__/trim.test.ts
```

Result before implementing `buildRoofProfile`/style-aware `buildTrim`:
**7 failed, 1 passed (8)** — all 5 `roof.test.ts` tests failed with
`TypeError: buildRoofProfile is not a function` (function didn't exist yet);
2 of 3 `trim.test.ts` tests failed (`regular` still emitted `eave`/`rake`,
and `vertical`'s ridge cap was the same size as `aframe`'s — 0.48 was not
greater than 0.48). The one passing trim test ("aframe gets eave + rake")
was already true pre-fix, as expected since that behavior wasn't being
changed.

After implementing `buildRoofProfile` and the style-aware `buildTrim`, the
same command:

```
npx vitest run lib/building/__tests__/roof.test.ts lib/building/__tests__/trim.test.ts
```

```
 RUN  v4.1.11 C:/Users/13183/steel_sync

 Test Files  2 passed (2)
      Tests  8 passed (8)
```

## Full suite and typecheck

```
npm test
```

```
> steel-sync@0.1.0 test
> vitest run


 RUN  v4.1.11 C:/Users/13183/steel_sync


 Test Files  18 passed (18)
      Tests  147 passed (147)
   Start at  18:47:47
   Duration  29.36s (transform 5.92s, setup 0ms, import 23.56s, tests 7.81s, environment 32.05s)
```

18 files / 147 tests passed (16 files / 139 tests baseline + 2 new files / 8
new tests), zero warnings — pristine, as required.

```
npx tsc --noEmit
```

No output — clean.

Also ran `npm run build` (Next.js production build) as an extra sanity check
beyond what was required: compiled successfully, all routes generated, no
type errors.

## Golden pricing confirmation

`lib/building/__tests__/pricing.golden.test.ts` is untouched and passed in
the full `npm test` run above (part of the 147). It exercises the default
config (`roofStyle: 'vertical'`) through `calculatePrice`; roof geometry and
trim are not inputs to pricing, so no golden values changed for any of the
three styles. `roofStyleModifiers` in `lib/building/defaultConfig.ts` was not
touched.

## Fix round 1 — ridge point offset sign bug

Post-review, the coordinator measured `buildRoofProfile` directly on the
default 24x30x10 building and found `regular`'s x range was `[-12, 36]` —
48 ft wide on a 24 ft building, extending a full `hw` (half-width, 12 ft)
past each wall instead of the intended `r` (eave radius, 0.5 ft).

**Root cause:** in `buildRegularRoofProfile`, the ridge point was built as
`{ x: -hw, y: H + rise, u: 1 }`. Every other point in `pts` uses the
convention "offset added to `xBase`" (handled in `addSide`), where the curve
points' offsets are bounded by `r` (`xOffset = r * (Math.cos(theta) - 1)`,
range `[-r, 0]`). The ridge point should follow the same convention with
offset `+hw` (so left side: `0 + hw = hw`; right side, mirrored:
`W - hw = hw` — both sides' ridge vertices land on the same point, `x = hw`).
Instead it used `-hw`, which for the left side gave `0 + (-hw) = -hw = -12`,
and for the right side (mirrored) gave `W - (-hw) = W + hw = 36` — exactly
the reported `[-12, 36]`. The curve points themselves were never wrong; only
this one ridge-point offset had the wrong sign.

**Fix:** changed `{ x: -hw, ... }` to `{ x: hw, ... }` in
`lib/building/roof.ts`'s `buildRegularRoofProfile`.

**Verified the fix actually catches the class of bug**, not just this one
instance: before restoring the fix, the two new bounded/regression tests
below were run against the reintroduced `-hw` bug and both failed as
expected (`-12 to be close to -0.5, difference 11.5`; footprint span
`23` vs. the `< 1` threshold), then passed once the fix was restored.

**Test changes** (`lib/building/__tests__/roof.test.ts`):

- Replaced the old direction-only assertion ("wraps ... outward past the
  wall face", which only checked `minX < 0` and `maxX > W` — `-12` satisfies
  that just as well as `-0.5` does, which is why it missed this bug) with
  two new tests:
  - `bounds the regular eave wrap by the eave radius, not the half-width` —
    pins `minX` to `-0.5` and `maxX` to `24.5` (`toBeCloseTo`, 5 decimal
    places), plus explicit `>=`/`<=` bounds against `radius + tolerance`.
  - `gives regular nearly the same x-footprint as aframe (differs in
    profile, not size)` — asserts `|regularWidth - aframeWidth| < 1` ft.
    This is the single assertion the coordinator specifically called out as
    the one that would have caught the bug; it fails loudly (`23 not < 1`)
    against the buggy code.
- Corrected the wall-capping test. The original task spec asked for an
  assertion that "regular's eave y >= H, never below it" — that wording is
  wrong: a wrapped panel legitimately comes down the outside face below the
  eave line (y dips to `H - r` at the wrap's outer tip, confirmed by the
  coordinator's own measurement showing `y:[9.5, 14]`). The test file
  already only checked vertices exactly at the wall face (`x` within `1e-6`
  of `0` or `W`, i.e. the shoulder point), so it was not actually asserting
  the overreaching "y >= H everywhere" claim — but the name and comment
  were rewritten (renamed to `caps the wall top at the wall face for
  regular`) to make that scoping explicit and prevent a future reader from
  assuming it means the stronger, incorrect claim.

## Measured x ranges (default 24x30x10 building, overhang/radius = 0.5 ft)

| style    | before fix (x range) | after fix (x range) |
|----------|-----------------------|----------------------|
| regular  | `[-12, 36]`           | `[-0.5, 24.5]`       |
| aframe   | `[-0.5, 24.5]`        | `[-0.5, 24.5]` (unchanged) |
| vertical | `[-0.5, 24.5]`        | `[-0.5, 24.5]` (unchanged) |

All three styles now share the same outer x footprint (`[-0.5, 24.5]`),
differing in the profile of the eave (curved wrap vs. flat overhang), not in
overall building width — as intended.

`npm test` after the fix: 18 test files, 148 tests passed (one more than the
147 reported before this round, from the new footprint-comparison test),
pristine. `npx tsc --noEmit`: clean.

## Fix round 2 — eave radius increased for visual legibility (product decision)

The geometry fix in round 1 was confirmed correct: all three styles measured
x:[-0.5, 24.5] on the 24ft default building, the wall was capped, and the
curve had 6 segments. But at normal viewer zoom, Regular and Boxed Eave
(`aframe`) still looked nearly identical — a 0.5ft (6") wrap radius is
physically accurate but visually invisible on a 24ft+ building, and the
reference product's Regular Style has an obviously, deliberately exaggerated
rounded eave.

**This is a product/legibility decision, not a defect fix.** The owner chose
legibility over literal accuracy: a configurator exists to help a customer
tell options apart, and a difference nobody can see does not do that.

**Chosen radius: 1.25 ft (15").** Reasoning:
- Sits centrally in the requested 1.0-1.5ft band.
- Large enough relative to a 24-30ft-wide, 10-16ft-tall building that the
  curve is unmistakable at default zoom, matching the reference product's
  obviously-rounded look.
- Segment count (6) was left unchanged — it already produced a smooth-
  reading arc; only the radius needed to grow to make that arc visible.
- The vertical drop at the wrap's outer tip is the same 1.25ft as the
  horizontal travel (still a plain quarter-circle — no need for an
  elliptical/non-circular curve). Checked this stays "modest": on a 10ft
  leg height, the tip sits at y=8.75 (12.5% below the eave line), and
  critically that dip only happens at x<0 or x>W — outside the wall
  panel's footprint (walls only span x in [0,W]) — so there is no odd
  overlap with the wall panel. The wall is still capped exactly at H at the
  wall face (x=0/x=W), unchanged by the radius (the shoulder point's y only
  depends on H, not r).

**Named-constant separation from `ROOF_OVERHANG_FT` made explicit in code**
(`lib/building/roof.ts`): `REGULAR_EAVE_RADIUS_FT` now carries a comment
explaining it is a *deliberately exaggerated* visual-legibility choice,
distinct from the dimensionally-accurate flat overhang (`ROOF_OVERHANG_FT`,
0.5ft) used by `aframe`/`vertical`, specifically warning a future reader not
to "fix" it back down to match that constant.

**Footprint assertion updated deliberately, not deleted/loosened**
(`lib/building/__tests__/roof.test.ts`): round 1 added a test asserting
Regular's x-span was within ~1ft of aframe's, which was correct only because
radius == overhang (both 0.5ft) at the time. With radius=1.25ft and
overhang=0.5ft, Regular's footprint is now legitimately wider on both sides
by `(radius - overhang)` each, so the test was rewritten to pin the *exact*
expected difference rather than loosen the tolerance:

```
expectedDiff = 2 * (REGULAR_EAVE_RADIUS_FT - OVERHANG) // = 1.5 ft
expect(regularWidth - aframeWidth).toBeCloseTo(expectedDiff, 5);
```

Verified this still catches the round-1 half-width regression: temporarily
reintroduced the `-hw` ridge-offset bug and reran — both the pinned-range
test and this footprint test failed loudly (`-12` vs. expected `-1.25`;
footprint difference `23` vs. expected `1.5`), then both passed again once
the fix was restored. The local `REGULAR_EAVE_RADIUS_FT` test constant was
also bumped to `1.25` to match, with a comment noting it deliberately
mirrors (but does not import) the implementation's constant.

## Measured x ranges after round 2 (default 24x30x10 building, overhang=0.5ft, radius=1.25ft)

| style    | x range           | y range (min, max) |
|----------|-------------------|---------------------|
| regular  | `[-1.25, 25.25]`  | `[8.75, 14]`        |
| aframe   | `[-0.5, 24.5]`    | `[10, 14]`          |
| vertical | `[-0.5, 24.5]`    | `[10, 14]`          |

Regular is now visibly wider and lower at the eave than aframe/vertical —
the intended, legible distinction — while the wall is still capped at
y=H=10 exactly at the wall face for all three styles, and ridge height
(y=14) is identical across all three.

`npm test`: 18 test files, 148 tests passed, pristine. `npx tsc --noEmit`:
clean.

## Fix round 3 — real overhang before the curl (owner-reported defect)

The owner zoomed into the deployed eave and reported: *"the ends of the roof
do not curve out, it just goes down the side of the building with no
overhang."* Round 2 made the curve big enough to *see*, but never fixed the
actual shape: `buildRegularRoofProfile`'s curl started **at the wall face**
(`theta=0` → `x=0, y=H`, the shoulder) and swept straight down to its tip
(`theta=-PI/2` → `x=-r, y=H-r`). That tip was simultaneously the vertex with
the minimum `x` (outermost) **and** the minimum `y` (lowest) — i.e. the
panel's widest point was the bottom of the curl. From any normal viewing
angle that reads as "the roof flares/hugs down the side of the wall," not
"the roof projects out, then curls." The `x:[-1.25, 25.25]` measurement from
round 2 was real but misleading — it only proved *some* geometry existed
past the wall face, not that it stood proud of the wall as a projecting
overhang.

**What changed** (`lib/building/roof.ts`, `buildRegularRoofProfile`): the
profile is now three stages, ridge to outer edge:

1. main slope descends to the eave line **at** the wall face (`x=0`/`x=W`,
   `y=H`) — unchanged, and this is what caps the wall (see round 3b below).
2. a new flat overhang stage, reusing `ROOF_OVERHANG_FT` (0.5ft) — the exact
   same length aframe/vertical already use for their flat overhang. Chose to
   reuse rather than invent a separate constant: there's no reason regular's
   flat run should be a different length than aframe's, and one fewer magic
   number is one fewer thing to keep in sync.
3. only at the *outer end* of that overhang does the tessellated curl begin
   (still 6 segments, `REGULAR_EAVE_SEGMENTS` unchanged).

**Radius shrunk from 1.25ft to 1.0ft** (`REGULAR_EAVE_RADIUS_FT`). The round-2
comment explaining why 1.25 was deliberately exaggerated (vs. the physically
accurate ~0.5ft) is preserved verbatim in the code, with a new paragraph
appended explaining the shrink: now that a real 0.5ft overhang stage exists
and does part of the "this clearly projects past the wall" visual work, the
curl doesn't have to carry that burden alone, so it was allowed to shrink —
while staying explicitly *not* returned anywhere near 0.5ft (1.0ft is still
double the physically-accurate wrap and reads as unmistakably rounded).

**Curl geometry:** circle centered at `(-overhangFt, H - r)`. The curl sweeps
**135° (3π/4)**, from `theta=90°` (top of the circle — tangent is horizontal
here, so it continues the flat overhang with no visible kink at the joint)
through `theta=180°` (the circle's leftmost point — this is the panel's true
outermost point) to `theta=225°`, where it ends. Stopping the sweep at
exactly 180° (a plain quarter-round, what round 1/2 effectively did once
shifted) would put the outermost point and the curl's lowest point back at
the *same* vertex — reproducing the exact bug. Sweeping 45° past 180° is
what makes the tip strictly lower **and** strictly more inboard than the
widest point, matching a real rolled/crimped eave hem. 135°/6 segments = 22.5°
per segment, chosen so segment 4 of 6 lands exactly on `theta=180°` — this
gives the pinned `minX` test value a clean closed form (`-(overhang + r)`)
rather than an approximation of the true circle minimum.

**Wall-color line at the roof/wall junction:** separately, the owner's zoom
also showed a thin sliver of wall color above the roof edge. This was **not**
a roof-profile bug — the roof's wall-face ("shoulder") vertex was already
sitting at exactly `y=H` in both the old and new code. The actual cause was
in `components/designer/ThreeScene.tsx`'s `PanelPanel`: each wall segment's
`boxGeometry` is inflated by `0.02ft` in height (`h + 0.02`) and centered on
`y + h/2`, so it overflows `0.01ft` *above* its nominal top **and** `0.01ft`
below its nominal bottom. That symmetric inflation exists so stacked segments
(sill/header/etc.) overlap at their seams instead of leaving hairline gaps —
but for the topmost, full-height wall segment, the "top" IS the eave line
(`y=wallHeight`), so the `+0.01` above pushed the wall `0.01ft` past the
roof's wall-face vertex, showing as a colored sliver above/through the roof
edge. Fixed by shifting the mesh's center down by `0.01ft`
(`y + h/2 - 0.01`, box height unchanged) so the same total `0.02ft` of overlap
margin is preserved but entirely below the segment's top — the topmost
segment's top now lands exactly at `y=wallHeight`, matching the roof's
shoulder vertex with no gap. This fix is in the shared wall-rendering code
path, not per-roof-style, so it applies uniformly to `regular`, `aframe`, and
`vertical` alike, without touching either straight-profile function.

### New assertions added, confirmed failing against the pre-fix code first

Per the task brief, before restoring the fix I stashed only
`lib/building/roof.ts` (keeping the new/updated tests) and ran:

```
npx vitest run lib/building/__tests__/roof.test.ts
```

against the old (bug-reproducing) implementation. Result: **5 failed, 4
passed (9)**.

- `bounds the regular eave wrap by the overhang + eave radius, not the
  half-width` — failed: `expected -1.2499999999999998 to be close to -1.5`
  (old code has no overhang stage, so its reach was still just the old
  radius, 1.25, not the new `overhang + radius` = 1.5).
- `gives regular a wider footprint than aframe by exactly the radius` —
  failed: `expected 1.5 to be close to 2` (old footprint delta was
  `2*(1.25-0.5)=1.5`; new expected delta is `2*radius=2*1.0=2`).
- `has roof geometry above the eave line that projects outside the wall
  face (a real overhang, not just a downward curl)` — **failed outright**
  (`expected false to be true`): this is the assertion that most directly
  encodes the owner's complaint. The old code has no vertex with `y >= H`
  and `x < 0` simultaneously — the curve only reaches `y=H` exactly at
  `x=0` (the shoulder itself), never before it.
- `has a widest point on the left slope that is not the curl's lowest
  point` — **failed outright** (`expected 8.75 to not be close to 8.75,
  difference 0`): in the old code the widest vertex and the lowest vertex
  are the literal same point (`x=-1.25, y=8.75`). This is the assertion
  that most precisely distinguishes "projects out then curls" from "flares
  down the wall."
- `gives regular an overhang above the eave line comparable to aframe's` —
  failed: `expected 0.5 to be less than 0.15` (old code's overhang-above-eave
  was `0`, vs. aframe's `0.5`; difference `0.5` blew through the `0.15`
  tolerance).

After un-stashing the fix and rerunning the same command: **9 passed (9)**.

### Measured x/y ranges — before vs. after this round (default 24x30x10 building)

| style    | x range (before)  | x range (after)   | y range (after)         |
|----------|-------------------|-------------------|--------------------------|
| regular  | `[-1.25, 25.25]`  | `[-1.5, 25.5]`    | `[8.293, 14]`            |
| aframe   | `[-0.5, 24.5]`    | `[-0.5, 24.5]` (unchanged) | `[10, 14]` (unchanged) |
| vertical | `[-0.5, 24.5]`    | `[-0.5, 24.5]` (unchanged) | `[10, 14]` (unchanged) |

Key regular vertices after the fix (left side, `H=10`, `overhang=0.5`, `r=1.0`):
shoulder `(0, 10)` → overhang-end `(-0.5, 10)` → widest/outermost
`(-1.5, 9)` → tip `(-1.207, 8.293)` → ridge `(12, 14)`. The widest point
(`x=-1.5`) is now strictly above the tip/bottom (`y=9` vs `y=8.293`), and
strictly outboard of it (`x=-1.5` vs `x=-1.207`) — the roof projects out to
`-1.5`, then curls down *and back in* to `-1.207`, rather than flaring
straight down to its outermost point.

### Full verification

```
npm test
```

```
> steel-sync@0.1.0 test
> vitest run


 RUN  v4.1.11 C:/Users/13183/steel_sync


 Test Files  18 passed (18)
      Tests  151 passed (151)
   Start at  20:12:36
   Duration  29.34s (transform 5.26s, setup 0ms, import 24.71s, tests 8.38s, environment 31.11s)
```

18 files / 151 tests passed (148 baseline + 3 net-new assertions: the two
existing pinned tests were updated in place, not counted as new), zero
warnings — pristine.

```
npx tsc --noEmit
```

No output — clean.

`lib/building/__tests__/pricing.golden.test.ts` (2 tests) passed unchanged
within the full run above — confirms no price changed. Neither
`lib/pricing/calculatePrice.ts`, `lib/building/wallFrame.ts`, `lib/db/**`,
nor `lib/notify/**` were touched. The `'aframe'` `RoofStyle` member name is
untouched. The UV convention (U across slope eave→ridge, V along length) is
unchanged — only the vertex positions and the `u` arc-length parameterization
were reworked; the `V` (front/back) coordinates and the `addSide` mirroring
logic are untouched.
