# Opening size editing (2026-08-21)

## Gap

Doors/windows could be dragged, re-walled, and repositioned, but not resized
— the sidebar showed `{widthFt}x{heightFt}ft` as static text. Free-form size
input was rejected by design: `calculatePrice` looks up an opening's price by
the exact key `${type}_${widthFt}x${heightFt}`; any size without a match
silently falls through to `widthFt * heightFt * 15` labelled `"Estimated"`.
On a quoting product, an unpriced size masquerading as a real number is worse
than no size editor at all.

## What changed

### 1. `lib/building/openingSizes.ts` (new)

`availableSizes(type, rules)` parses the keys of `rules.openingPrices`
(`${type}_${w}x${h}`, e.g. `rollup_10x10`) via
`/^(walkin|rollup|window|frameout)_(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/`, keeps
only keys whose type matches and whose parsed width/height are finite and
positive, and returns them sorted by width then height.

**Malformed input handling:** any key that doesn't fully match the pattern
(no separator, non-numeric dimensions, wrong/extra type prefix, trailing
garbage) is silently skipped — `Object.keys` + regex test, no parsing that
can throw. A dedicated test feeds a mixed bag of malformed keys
(`'not-a-key'`, `'rollup_abcxdef'`, `'rollup_10x'`, `'rollup10x10'` — missing
underscore, `'garagerollup_10x10'` — extra prefix that must not match
`rollup`) alongside one valid key and asserts only the valid one survives,
with no throw.

**Empty-dealer fallback:** if a dealer's `openingPrices` yields zero sizes
for the requested type, `availableSizes` falls back to
`DEFAULT_PRICING_RULES`'s sizes for that type, so the dropdown is never
empty even for a dealer whose hand-entered `pricing_rules` JSON omits a
type entirely.

Because the dropdown's contents ARE the priced keys (not a second
hand-maintained list), every size it can ever offer resolves to a real
`openingPrices` entry by construction — verified directly by a test that
builds a one-opening config for every size `availableSizes` returns, across
all four opening types, runs it through `calculatePrice`, and asserts the
resulting line item's `detail` is never `'Estimated'`.

### 2. `lib/store/designerStore.ts` — clamping, not the UI

Added `clampOpening(opening, building)`, mirroring the existing
`clampLeanToLength` precedent: takes `wallFrame(opening.wall, building).lengthFt`
(no re-derived `wall === 'front' ? ... : ...` ternary), clamps `positionFt`
to `[0, wallLengthFt - widthFt]`, and clamps `heightFt` down to
`building.legHeightFt`.

Wired in at every point an opening's fields or the building can change:

- `updateOpening(id, partial)` now clamps the **merged** opening (`{...o, ...partial}`)
  before storing it — so a size change re-clamps position, a wall change
  re-clamps position against the new wall's length, and a direct
  `heightFt`/`positionFt` write is clamped too. One code path covers all
  four cases the spec called out.
- `updateBuilding(partial)` — **yes, I re-clamped existing openings here**,
  the same way it already re-clamps lean-tos. It was a one-line addition
  (`openings: config.openings.map(o => clampOpening(o, nextBuilding))`)
  using the same `nextBuilding` already computed for the lean-to clamp, so it
  was not invasive — shrinking width/length/legHeightFt can strand an
  existing opening exactly the way it can strand a lean-to, and the fix is
  structurally identical.
- `applyAIConfig` — clamped in two places: existing openings are re-clamped
  when `ai.building` shrinks the building (paralleling the lean-to
  re-clamp already there), and newly-constructed `ai.openings` entries are
  now run through `clampOpening` against the (possibly just-updated)
  building before being stored, instead of being written through verbatim.
  This is the "covers the AI-config path too" guarantee from the design doc.

### 3. `components/designer/BuildingDesigner.tsx` — sidebar UI

- Replaced the static `<span>{op.widthFt}x{op.heightFt}ft</span>` with a
  `<select>` populated from `availableSizes(op.type, pricingRules)`,
  formatted `WxH ft`, calling `updateOpening(op.id, { widthFt, heightFt })`
  on change.
- `pricingRules` is read as `dealerSettings?.pricing ?? DEFAULT_PRICING_RULES`
  (the same fallback `withPricing` in the store uses).
- The position `<input>` gained `max={Math.max(0, wallLengthFt - op.widthFt)}`,
  where `wallLengthFt = wallFrame(op.wall, building).lengthFt` — closing the
  pre-existing gap where the input had `min={0}` and no `max`, so a customer
  could already type a door past the end of its wall (the store now clamps
  the stored value regardless, but the input's own bound keeps the spinner
  and native validation honest).
- No restyling; only the one `<select>` and the `max` attribute were added.

## Tests — written first, confirmed failing pre-implementation

- `lib/building/__tests__/openingSizes.test.ts` (new, 6 tests) — failed with
  `Cannot find module '../openingSizes'` before the module existed.
- `lib/store/__tests__/designerStore.test.ts` — added a
  `describe('designerStore opening clamping')` block (6 tests). Ran against
  the pre-fix store: 5 of 6 failed (widening-near-wall-end, move-to-shorter-wall,
  height-clamp-on-update, re-clamp-on-building-shrink for both position and
  height); the "leaves a valid opening untouched" test passed both before and
  after, as expected since it exercises no clamping.

## Test command and full output (after implementation)

```
$ npx vitest run lib/building/__tests__/openingSizes.test.ts

 RUN  v4.1.11 C:/Users/13183/steel_sync


 Test Files  1 passed (1)
      Tests  6 passed (6)
```

```
$ npx vitest run lib/store/__tests__/designerStore.test.ts

 RUN  v4.1.11 C:/Users/13183/steel_sync


 Test Files  1 passed (1)
      Tests  18 passed (18)
```

Full suite:

```
$ npm test

> steel-sync@0.1.0 test
> vitest run

 RUN  v4.1.11 C:/Users/13183/steel_sync

 Test Files  16 passed (16)
      Tests  128 passed (128)
   Start at  16:27:53
   Duration  30.91s (transform 11.83s, setup 0ms, import 34.03s, tests 11.62s, environment 33.37s)
```

128 = 116 pre-existing + 6 (`openingSizes.test.ts`) + 6 (new `designerStore`
opening-clamping tests). Zero warnings, pristine output. The golden pricing
test (`pricing.golden.test.ts`) is included and unchanged.

## `tsc --noEmit`

Clean — no output, exit 0.

## Constraints honored

- `RoofStyle['aframe']` untouched.
- `lib/building/wallFrame.ts`, `lib/pricing/calculatePrice.ts`, `lib/db/**`,
  `lib/notify/**` untouched (read-only).
- No custom/free-form sizes, no drag-to-resize handles, no framing-bay
  snapping, no sidebar auto-scroll — none of that was built.
- No `vercel`, `db:seed`, or `db:migrate` commands run.

## Deviations

None. `updateBuilding` re-clamping openings was explicitly left as a
"do it if straightforward" call — it was straightforward (same pattern,
same already-computed `nextBuilding`), so it's included.
