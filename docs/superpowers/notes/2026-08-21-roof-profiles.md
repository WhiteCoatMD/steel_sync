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
