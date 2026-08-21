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

---

## Fix round 1 (2026-08-21)

Code review found two holes in the central guarantee ("an unpriced size can
never reach a customer through the UI"):

### Finding 1 — adding an opening bypassed the mechanism entirely

`handleAdd` in `components/designer/BuildingDesigner.tsx` wrote hardcoded
literal sizes (`rollup` 10x10, `walkin` 3x7, `window` 3x3, `frameout` 10x10)
straight through `addOpening`, never consulting `availableSizes`.
`clampOpening` only clamps position/height, not size. For a dealer whose
`openingPrices` lacks those exact literals, a newly-added opening priced as
`'Estimated'` immediately, and its size `<select>` rendered with no option
matching the stored WxH.

**Fix:** added `defaultOpeningSize(type, rules)` to
`lib/building/openingSizes.ts` — returns `availableSizes(type, rules)[0]`,
falling back to a `LAST_RESORT_SIZE` literal only if `availableSizes`
somehow returns nothing (defensively unreachable in practice, since
`DEFAULT_PRICING_RULES` always has at least one priced size per type — kept
only so opening creation can never throw). `handleAdd` now calls
`defaultOpeningSize(type, pricingRules)` for width/height instead of a
literal; wall/position defaults per type are unchanged (those were never
part of the pricing guarantee).

### Finding 2 — the parse/rebuild round-trip was breakable

`availableSizes` parsed a key to numbers; `calculatePrice` independently
*rebuilds* the key as `` `${type}_${widthFt}x${heightFt}` ``. Those only
agree when the dealer's key is already in that canonical form. A hand-typed
`rollup_08x08` parsed to `{8,8}` and rebuilt to `rollup_8x8` — no match,
silent `'Estimated'`. Same for `rollup_10.50x8` → rebuilds to `rollup_10.5x8`.
Both passed the malformed-key regex filter, so they reached the dropdown
looking legitimate.

**Fix:** in `sizesForType` (`lib/building/openingSizes.ts`), after parsing a
key to `{widthFt, heightFt}`, the canonical key is rebuilt exactly as
`calculatePrice` does and the size is only kept if
`prices[canonicalKey] != null`. `lib/pricing/calculatePrice.ts` was not
touched — it remains the single authority on key construction;
`availableSizes` conforms to it rather than the reverse.

This surfaced a second-order bug while writing the "canonical alongside
non-canonical" test: a non-canonical key (e.g. `rollup_010x10`) can rebuild
to the SAME canonical key as another entry already in the map (e.g.
`rollup_10x10`) and pass the `prices[canonicalKey] != null` check without
itself equaling the canonical key — producing a duplicate `{10,10}` entry in
the offered list. Fixed by deduping on the canonical key string
(`seenCanonicalKeys` Set) inside `sizesForType`, so a canonical/non-canonical
pair that resolves to the same size yields exactly one dropdown entry.

### New tests — confirmed failing before the fix

Ran `npx vitest run lib/building/__tests__/openingSizes.test.ts` against the
pre-fix code: **5 of 5 new tests failed**, 6 pre-existing passed:

- `rejects a non-canonical zero-padded key (rollup_08x14) even though it
  parses cleanly` — failed (`08x14` was offered; pre-fix code had no
  canonical check at all).
- `rejects a non-canonical decimal key (rollup_10.50x8) even though it
  parses cleanly` — failed (`10.5x8` was offered).
- `offers only the canonical key when a canonical and a non-canonical key
  parse to the same size` — failed (both `rollup_10x10` and
  `rollup_010x10` were offered as two `{10,10}` entries; the array had length
  2, expected 1).
- `seeds every opening type from availableSizes rather than a hardcoded
  literal...` (in the new `defaultOpeningSize` describe block) — failed with
  `TypeError: defaultOpeningSize is not a function` (didn't exist yet).
- `falls back to a sane literal if availableSizes ever returns nothing...`
  — same `TypeError`, function didn't exist.

After implementing both fixes, all 11 tests in the file pass (6 original + 5
new).

One test-authoring correction worth recording: the first attempt at the
zero-padded-key test used `rollup_08x08`, asserting `{8,8}` was not offered.
That assertion was wrong on its own terms — `DEFAULT_PRICING_RULES` already
has a *canonical* `rollup_8x8` entry, so `{8,8}` legitimately appears in the
result via the fallback path regardless of the `08x08` key's rejection,
making the assertion pass or fail for the wrong reason. Reworked to
`rollup_08x14`, a size absent from `DEFAULT_PRICING_RULES`'s rollup sizes, so
its absence from the result can only mean the non-canonical key was
correctly rejected.

## Updated test command and full output

```
$ npx vitest run lib/building/__tests__/openingSizes.test.ts

 RUN  v4.1.11 C:/Users/13183/steel_sync


 Test Files  1 passed (1)
      Tests  11 passed (11)
```

Full suite:

```
$ npm test

> steel-sync@0.1.0 test
> vitest run

 RUN  v4.1.11 C:/Users/13183/steel_sync


 Test Files  16 passed (16)
      Tests  133 passed (133)
   Start at  17:15:47
   Duration  13.10s (transform 2.36s, setup 0ms, import 11.23s, tests 2.48s, environment 14.75s)
```

133 = 128 from the initial implementation + 5 new (11 total in
`openingSizes.test.ts`, up from 6). Zero warnings, pristine output.

## `tsc --noEmit` (after fix round 1)

Clean — no output, exit 0.

## Constraints honored

- `lib/pricing/calculatePrice.ts` untouched — remains the sole authority on
  key construction.
- `RoofStyle['aframe']`, `lib/building/wallFrame.ts`, `lib/db/**`,
  `lib/notify/**` untouched.
- No `vercel`, `db:seed`, or `db:migrate` commands run.

---

## Fix round 2 (2026-08-21) — found by browser verification, not by tests

The coordinator found this bug by clicking through the running app, not
from a test failure or code review comment. Numerically confirmed:
rollup 12x10 (after clamping) priced with total=14628 and a line item of
{amount:1800, detail:"Estimated"}.

Why two rounds of tests missed it: round 1's "every offered size prices
without Estimated" test called calculatePrice directly on an opening built
from an availableSizes entry -- it never routed the size through
clampOpening. calculatePrice has no concept of "this was just clamped"; it
prices whatever widthFt/heightFt it is handed. So a size that priced
correctly in isolation was never checked after going through the one piece
of code (clampOpening) that could still mutate it. The dropdown itself
correctly offered rollup_12x12 (real price, $1,100) -- the bug only appeared
once a customer actually selected it on a building with legHeightFt 10:
clampOpening clamped heightFt to 10, producing an unpriced 12x10 that fell
through to the widthFt * heightFt * 15 estimate branch ($1,800), a real $700
overcharge silently labelled Estimated. The size select then could not find
a matching option for 12x10 either, so it rendered its first option (8x8),
misreporting what was actually configured.

### Fix -- two halves, both required

Half 1 -- availableSizes now filters by physical fit.
lib/building/openingSizes.ts gained an OpeningFit type
({ legHeightFt: number; wallLengthFt?: number }) and an optional third
parameter on availableSizes(type, rules, fit?). Sizes taller than
fit.legHeightFt, or (when fit.wallLengthFt is given) wider than the wall,
are excluded -- applied inside sizesForType alongside the existing
canonical-key filter from round 1, so both guarantees compose rather than
one replacing the other. Omitting fit reproduces the pre-round-2 behaviour
exactly (a dedicated test locks this down). defaultOpeningSize also takes
fit now, so a newly-added opening is seeded already fitting.

Added largestFittingSize(type, rules, fit): the largest (by width, then
height) priced size for type that satisfies fit, or null if none do. This
is what the clamp (half 2) snaps to.

components/designer/BuildingDesigner.tsx: the size select now calls
availableSizes(op.type, pricingRules, { legHeightFt: building.legHeightFt,
wallLengthFt }), and handleAdd computes the same fit (from the type's
placement wall) before calling defaultOpeningSize.

Half 2 -- the clamp snaps to a priced size instead of clamping a dimension.
lib/store/designerStore.ts's old clampOpening is split into two composed
functions:

- clampOpeningPosition(opening, building) -- unchanged position-clamping
  logic, exactly as round 1 left it.
- resizeOpeningToFit(opening, building, rules) -- new. If the opening's
  current size already fits (heightFt <= legHeightFt and
  widthFt <= wallLengthFt), it is returned untouched. Otherwise it is
  replaced wholesale by largestFittingSize(...) -- never by clamping just
  heightFt (or widthFt) to an arbitrary number. If no priced size fits at
  all (rare -- DEFAULT_PRICING_RULES has an 8ft-tall rollup, but a dealer
  could still have nothing that small, or a leg height below every priced
  size, as the existing legHeightFt: 7 test now demonstrates), it falls
  back to the old direct height-clamp as a last resort and console.warns,
  rather than crashing or leaving the opening un-clamped.
- clampOpening(opening, building, rules) composes the two:
  clampOpeningPosition(resizeOpeningToFit(opening, building, rules), building).

clampOpening now takes rules as a third argument, so its three call sites
(updateOpening, updateBuilding, applyAIConfig) each compute
dealerSettings?.pricing ?? DEFAULT_PRICING_RULES (the same fallback
withPricing uses) and pass it through. lib/pricing/calculatePrice.ts was
not touched.

One existing round-1 test -- "re-clamps an existing opening's height when
the building leg height shrinks" (building leg height 10 to 7) -- now
legitimately exercises the last-resort console.warn branch, since no rollup
in DEFAULT_PRICING_RULES is 7ft tall or shorter. Rather than let that print
during the run, the test now spies on console.warn
(vi.spyOn(console, 'warn').mockImplementation(() => {})), asserts it was
called, and restores it -- keeping npm test output pristine while still
covering the branch.

### Tests -- written first, confirmed failing against the pre-round-2 code

To verify this honestly (the round-2 source fix was written before the new
tests were confirmed against pre-fix code), the three fixed files
(lib/building/openingSizes.ts, lib/store/designerStore.ts,
components/designer/BuildingDesigner.tsx) were stashed with
`git stash push -- <files>` to restore the round-1 (post-fix-round-1) code,
leaving the new test files in place, then restored with `git stash pop`
after confirming failures.

Ran `npx vitest run lib/building/__tests__/openingSizes.test.ts
lib/store/__tests__/designerStore.test.ts` against that pre-round-2 code:
5 of 5 new tests failed, 30 pre-existing passed:

- "excludes a size taller than fit.legHeightFt (does not offer 12x12 on a
  10ft-leg building)" -- failed; 12x12 was still offered (the fit parameter
  did not exist yet, so it was silently ignored as an extra argument).
- "excludes a size wider than fit.wallLengthFt when supplied" -- failed for
  the same reason.
- "re-clamps an existing opening's height when the building leg height
  shrinks" -- failed: expected "warn" to be called at least once (no
  console.warn existed pre-fix; the direct clamp was silent).
- "selecting every size the (fit-filtered) dropdown offers, on a
  10ft-leg-height building, never prices as Estimated" -- failed at the
  very first assertion: 12x12 was still offered by the unfiltered
  availableSizes.
- "shrinking the building leg height from 12ft to 10ft converts an existing
  12x12 roll-up into a PRICED fitting size, not 12x10" -- failed with the
  bug's exact reproduction: the stored opening was exactly the unpriced
  12x10 the bug report describes (assertion diff showed "no visual
  difference" between the actual value and the forbidden {widthFt:12,
  heightFt:10}).

The "not-Estimated" test also caught a bug in itself while iterating: its
first draft indexed config.openings[0] and searched line items by
`li.label.includes('Roll-Up')` without first removing createDefaultConfig's
seeded door_ru_1 rollup, so the assertions could accidentally match the
seeded opening's line item instead of the one under test. Fixed by clearing
door_ru_1 and win_1 at the start of each test in that describe block
(a freshConfigWithNoOpenings helper), isolating the opening actually being
tested. A second small test bug (wallLengthFt of 9 also admits the priced
9-wide rollup, diluting the width-filter assertion) was caught the same way
and fixed by tightening the wall length to 8.

After restoring the round-2 fix (`git stash pop`), all 35 tests in the two
files pass.

### Updated test command and full output

Test file command: `npx vitest run lib/building/__tests__/openingSizes.test.ts lib/store/__tests__/designerStore.test.ts`
Result: Test Files 2 passed (2), Tests 35 passed (35).

Full suite command: `npm test`
Result:

```
> steel-sync@0.1.0 test
> vitest run

 RUN  v4.1.11 C:/Users/13183/steel_sync


 Test Files  16 passed (16)
      Tests  139 passed (139)
   Start at  17:54:39
   Duration  21.51s (transform 3.71s, setup 0ms, import 17.57s, tests 4.65s, environment 22.41s)
```

139 = 133 from fix round 1 + 6 new (3 in openingSizes.test.ts, 3 in
designerStore.test.ts -- the legHeightFt: 7 test is a modification of an
existing test, not a new one). Zero warnings, pristine output.

## `tsc --noEmit` (after fix round 2)

Clean -- no output, exit 0.

## Constraints honored (round 2)

- lib/pricing/calculatePrice.ts untouched.
- RoofStyle['aframe'], lib/building/wallFrame.ts, lib/db/**, lib/notify/**
  untouched.
- No vercel, db:seed, or db:migrate commands run.
