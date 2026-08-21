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
