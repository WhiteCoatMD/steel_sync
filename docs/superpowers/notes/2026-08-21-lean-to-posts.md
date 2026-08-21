# Lean-to support posts (2026-08-21)

## Bug

An open lean-to (the default) rendered as a roof with nothing holding it up:
`buildLeanTo` in `lib/building/leanTo.ts` only ever emitted `slab` and `roof`
meshes, gating the wall meshes behind `leanTo.walls === 'enclosed'`. There was
no post/column part at all, open or enclosed. The `LeanToMesh['part']` union
had no member for it, and the only relevant test (`leanTo.test.ts`) asserted
walls were *absent* for an open lean — never that something else stood in
for them.

## Fix

1. `lib/building/leanTo.ts`
   - Added `'post'` to the `LeanToMesh['part']` union.
   - Added constants: `POST_SIZE = 0.25` (3in square tube steel),
     `MAX_POST_BAY_FT = 5` (industry-standard 5' OC frame spacing — the
     reference product's spec sheet reads "Frame Spacing: 5' OC"), and
     `DEFAULT_FRAME_COLOR = '#d8d8d4'` (fallback trim/frame colour, matching
     the main building's hardcoded frame member colour in `ThreeScene.tsx`,
     used only when a caller doesn't supply a real trim colour).
   - Added `postXPositions(extentFt)`: always places a post at each end of
     the lean's extent, then divides evenly so every bay is <= 5ft. Rule:
     `bays = ceil(extentFt / 5)`, posts = `bays + 1`, each bay length =
     `extentFt / bays`. This avoids the "6 bays of 5ft + a stub" failure
     mode — a 30ft lean gets exactly 6 equal 5ft bays -> 7 posts, not 6
     posts with an odd leftover span.
   - Posts are emitted **unconditionally** (both open and enclosed), sitting
     on the lean's outer edge (local `Z = projectionW`), spanning
     `y = 0` to `y = leanTo.heightFt` (the outer eave height) — this is the
     edge the roof actually needs holding up; the parent-wall edge is
     already carried by the building.
   - `buildLeanTo` gained an optional third parameter `trimColorHex` (default
     `DEFAULT_FRAME_COLOR`) so posts use the lean's trim/frame colour rather
     than the wall colour, without breaking any existing 2-arg call site.

2. `lib/building/buildBuilding.ts`
   - Wired the real trim colour through: `buildLeanTo(lt, b, config.colors.trim.hex)`.

3. `components/designer/ThreeScene.tsx`
   - `LeanToMeshes` now gives `part === 'post'` the frame-member material
     treatment (`metalness 0.5, roughness 0.4`, matching `FrameBox`) instead
     of the flat slab treatment (`metalness 0, roughness 0.92`) or the
     existing wall/roof treatment (`0.35 / 0.65`). No renderer redesign —
     just extended the existing ternaries.

## Tests

Added to `lib/building/__tests__/leanTo.test.ts` (new `describe('lean-to support posts')` block, 5 tests):

- `an open lean emits at least one post` — the direct regression guard for
  the shipped bug.
- `an enclosed lean also emits posts (walls hide them, they still hold the roof up)`.
- `posts sit on the outer edge (local Z = projection width), not the parent-wall edge`.
- `spaces posts at 5ft max bay, with a post at each end of the extent` —
  asserts a post at extent-start and extent-end, every adjacent gap <= 5ft,
  and that a 30ft lean yields exactly 7 posts.
- `every post spans from the ground to the lean's outer eave height` —
  asserts each post's centered-box y-extent covers `[0, heightFt]` exactly,
  so a zero-height or floating post fails.

**Confirmed each new test fails before the fix.** Ran
`npx vitest run lib/building/__tests__/leanTo.test.ts` against the
pre-fix code (part union unchanged, no post emission): all 5 new tests
failed (`expected 0 to be greater than 0`, and a `NaN` from indexing into an
empty posts array), while the 10 pre-existing tests in the file passed.
After implementing the fix, all 15 tests in the file pass.

### Test command and full output (after the fix)

```
$ npx vitest run lib/building/__tests__/leanTo.test.ts

 RUN  v4.1.11 C:/Users/13183/steel_sync


 Test Files  1 passed (1)
      Tests  15 passed (15)
   Start at  15:17:58
   Duration  867ms (transform 123ms, setup 0ms, import 197ms, tests 14ms, environment 0ms)
```

Full suite:

```
$ npm test

> steel-sync@0.1.0 test
> vitest run

 RUN  v4.1.11 C:/Users/13183/steel_sync

 Test Files  15 passed (15)
      Tests  116 passed (116)
   Start at  15:18:29
   Duration  16.22s (transform 2.97s, setup 0ms, import 13.49s, tests 3.13s, environment 18.28s)
```

116 = 111 pre-existing + 5 new. Zero warnings, pristine output. The golden
pricing test (`pricing.golden.test.ts`) is included in that pass, unchanged —
posts carry no price; `calculatePrice` still prices a lean purely by
`widthFt * lengthFt`.

## `tsc --noEmit`

Clean — no output, exit 0.

## Constraints honored

- `RoofStyle['aframe']` untouched.
- `lib/building/wallFrame.ts`, pricing, `lib/db/`, `lib/notify/` untouched.
- No price change: posts add no cost; golden pricing test unchanged and passing.
- No `vercel`, `db:seed`, or `db:migrate` commands run.
