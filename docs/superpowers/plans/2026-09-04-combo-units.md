# Combo Units Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a customer configure and price a combo — one frame with a dividing wall, enclosed on one side of it and open carport on the other.

**Architecture:** One new building type, `'combo'`, plus `combo?: { enclosedDepthFt, end }` on `BuildingDimensions`. All the combo arithmetic lives in one new module, `lib/building/combo.ts`, which pricing, geometry, the store and the UI all consume — so the rule about where the dividing wall falls is stated once. The pricing engine's `enclosed: boolean` becomes an enclosed *depth*, which makes every existing type a special case of the same number.

**Tech Stack:** TypeScript, Next.js 15 App Router, React Three Fiber for the 3D scene, Zustand for the designer store, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-04-combo-units-design.md`

## Global Constraints

- **The building stays ONE box.** A combo is a dividing wall position, not two buildings. Frame, roof, posts and slab are untouched by any of this.
- **The enclosure runs the full width.** The only variable is where the dividing wall falls.
- **`end` is the gable end the enclosure is anchored to, and the enclosure runs `enclosedDepthFt` INWARD from it.** `{ end: 'front', enclosedDepthFt: 10 }` on a 30ft building encloses 0–10ft measured from the front.
- **`enclosedDepthFt` must be a multiple of 5, greater than 0 and less than `lengthFt`.** Equal to the length is a garage; zero is a carport. Out of range is unpriceable, never a guess.
- **No existing quote may change.** The boolean-to-depth change must be provably behaviour-preserving for all six existing types.
- **No new price capture.** Everything comes from `lib/pricing/data/tejasmex.json` as it stands.
- **The assistant stays out of this.** No changes to `lib/ai/**` or `lib/inbound/**`. A customer asking the bot for a combo is handed to a human, which is what already happens for anything the engine cannot price.
- **`combo` is optional on `BuildingDimensions`**, so every existing config, fixture and test stays valid.
- Tests live in `__tests__/` beside the code, named `*.test.ts`/`*.test.tsx`. Run with `npm test`.
- **Type your `vi.fn` mocks explicitly** — no `any`, `@ts-ignore`, `@ts-expect-error`. After tests pass run `npx tsc --noEmit` and fix anything your change introduced.
- Commit after every task. End each commit message with:
```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EoBXQ3EVFmjL17iiTAPZ7C
```

---

### Task 1: The combo module

**Files:**
- Create: `lib/building/combo.ts`
- Modify: `lib/building/types.ts` (add `'combo'` to `BuildingType`, add `combo` to `BuildingDimensions`)
- Modify: `lib/db/dealers.ts:5-6` (add `'combo'` to `ALL_BUILDING_TYPES`)
- Test: `lib/building/__tests__/combo.test.ts`

**Interfaces:**
- Consumes: `BuildingDimensions`, `BuildingType` from `lib/building/types.ts`.
- Produces:
  - `COMBO_DEPTH_STEP_FT = 5`
  - `isComboType(t: BuildingType): boolean`
  - `enclosedDepthFt(b: BuildingDimensions): number` — 0 for open types, `b.lengthFt` for enclosed types, the split for a combo, 0 for a combo whose split is invalid
  - `comboSpan(b: BuildingDimensions): { startFt: number; endFt: number; depthFt: number } | null` — the enclosed span measured from the front, or null when the building is not a validly-configured combo
  - `comboDepthOptions(lengthFt: number): number[]`
  - `clampComboDepth(depthFt: number, lengthFt: number): number`

- [ ] **Step 1: Write the failing test**

Create `lib/building/__tests__/combo.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  isComboType, enclosedDepthFt, comboSpan, comboDepthOptions, clampComboDepth,
  COMBO_DEPTH_STEP_FT,
} from '../combo';
import type { BuildingDimensions } from '../types';

const dims = (over: Partial<BuildingDimensions> = {}): BuildingDimensions =>
  ({
    type: 'combo', widthFt: 24, lengthFt: 30, legHeightFt: 9,
    roofStyle: 'vertical', roofPitch: '4:12', orientation: 'length-facing-front',
    panelDirection: { walls: 'horizontal', roof: 'vertical' },
    combo: { enclosedDepthFt: 10, end: 'front' },
    ...over,
  }) as BuildingDimensions;

describe('isComboType', () => {
  it('is true only for a combo', () => {
    expect(isComboType('combo')).toBe(true);
    for (const t of ['carport', 'garage', 'barn', 'shop', 'warehouse', 'rv-cover'] as const) {
      expect(isComboType(t)).toBe(false);
    }
  });
});

describe('enclosedDepthFt', () => {
  // The whole point of the number: every type is a case of the same thing.
  it('is zero for open types', () => {
    expect(enclosedDepthFt(dims({ type: 'carport', combo: undefined }))).toBe(0);
    expect(enclosedDepthFt(dims({ type: 'rv-cover', combo: undefined }))).toBe(0);
  });

  it('is the full length for enclosed types', () => {
    for (const t of ['garage', 'barn', 'shop', 'warehouse'] as const) {
      expect(enclosedDepthFt(dims({ type: t, combo: undefined }))).toBe(30);
    }
  });

  it('is the split for a combo', () => {
    expect(enclosedDepthFt(dims())).toBe(10);
  });

  // An invalid split must not quietly price as something else.
  it('is zero for a combo with a missing or out-of-range split', () => {
    expect(enclosedDepthFt(dims({ combo: undefined }))).toBe(0);
    expect(enclosedDepthFt(dims({ combo: { enclosedDepthFt: 0, end: 'front' } }))).toBe(0);
    expect(enclosedDepthFt(dims({ combo: { enclosedDepthFt: 30, end: 'front' } }))).toBe(0);
    expect(enclosedDepthFt(dims({ combo: { enclosedDepthFt: 35, end: 'front' } }))).toBe(0);
    expect(enclosedDepthFt(dims({ combo: { enclosedDepthFt: 12, end: 'front' } }))).toBe(0);
  });
});

describe('comboSpan', () => {
  // Measured from the front, always, so every consumer reads one coordinate system.
  it('runs inward from the front end', () => {
    expect(comboSpan(dims({ combo: { enclosedDepthFt: 10, end: 'front' } })))
      .toEqual({ startFt: 0, endFt: 10, depthFt: 10 });
  });

  it('runs inward from the back end', () => {
    expect(comboSpan(dims({ combo: { enclosedDepthFt: 10, end: 'back' } })))
      .toEqual({ startFt: 20, endFt: 30, depthFt: 10 });
  });

  it('is null for anything that is not a valid combo', () => {
    expect(comboSpan(dims({ type: 'garage', combo: undefined }))).toBeNull();
    expect(comboSpan(dims({ combo: undefined }))).toBeNull();
    expect(comboSpan(dims({ combo: { enclosedDepthFt: 30, end: 'front' } }))).toBeNull();
  });
});

describe('comboDepthOptions', () => {
  it('steps by 5 and stops one step short of the building', () => {
    expect(comboDepthOptions(30)).toEqual([5, 10, 15, 20, 25]);
    expect(comboDepthOptions(20)).toEqual([5, 10, 15]);
  });

  it('offers nothing when the building is too short to split', () => {
    expect(comboDepthOptions(5)).toEqual([]);
  });

  it('ignores a length that is not on the step', () => {
    expect(comboDepthOptions(32)).toEqual([5, 10, 15, 20, 25, 30]);
  });
});

describe('clampComboDepth', () => {
  // Shortening a 30ft building with a 25ft enclosure to 20ft must not leave the
  // enclosure longer than the building.
  it('pulls the depth back inside a shortened building', () => {
    expect(clampComboDepth(25, 20)).toBe(15);
  });

  it('leaves a depth that still fits', () => {
    expect(clampComboDepth(10, 30)).toBe(10);
  });

  it('never returns less than one step', () => {
    expect(clampComboDepth(25, 5)).toBe(COMBO_DEPTH_STEP_FT);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/building/__tests__/combo.test.ts`
Expected: FAIL — cannot resolve `../combo`.

- [ ] **Step 3: Add the type changes**

In `lib/building/types.ts`, extend the union:

```ts
export type BuildingType =
  | 'carport' | 'garage' | 'barn' | 'shop' | 'warehouse' | 'rv-cover'
  | 'combo';
```

and add to `BuildingDimensions`, after `panelDirection`:

```ts
  /**
   * How deep the enclosed area runs. Present only on a combo.
   *
   * The building stays ONE box: this says where the dividing wall falls, not
   * that there are two buildings. `end` is the gable end the enclosure is
   * anchored to and the enclosure runs INWARD from it, so
   * `{ end: 'front', enclosedDepthFt: 10 }` on a 30ft building encloses 0-10ft
   * measured from the front and leaves 10-30ft open.
   *
   * "Depth" rather than "length" because that is what a dealer calls it, and
   * the building already has a lengthFt that this is not.
   */
  combo?: { enclosedDepthFt: number; end: 'front' | 'back' };
```

In `lib/db/dealers.ts` line 5-6:

```ts
const ALL_BUILDING_TYPES: BuildingType[] =
  ['carport', 'garage', 'barn', 'shop', 'warehouse', 'rv-cover', 'combo'];
```

- [ ] **Step 4: Write the module**

Create `lib/building/combo.ts`:

```ts
import type { BuildingDimensions, BuildingType } from './types';

/**
 * Where the dividing wall falls, in one place.
 *
 * A combo is one frame with part of its length enclosed. Pricing, geometry, the
 * designer store and the UI all need to agree on exactly which feet are inside,
 * and the cost of them disagreeing is a building that prices differently from
 * the one on screen. So the arithmetic lives here and they all read it.
 */

/** Depth moves in the same 5ft step the building's own length does. */
export const COMBO_DEPTH_STEP_FT = 5;

/** Types with no walls at all. */
const OPEN_TYPES: ReadonlySet<BuildingType> = new Set(['carport', 'rv-cover']);

export function isComboType(t: BuildingType): boolean {
  return t === 'combo';
}

function validDepth(depthFt: unknown, lengthFt: number): depthFt is number {
  return (
    typeof depthFt === 'number' &&
    Number.isFinite(depthFt) &&
    depthFt > 0 &&
    depthFt < lengthFt &&
    depthFt % COMBO_DEPTH_STEP_FT === 0
  );
}

/**
 * The enclosed span, measured from the FRONT of the building regardless of
 * which end the enclosure is anchored to.
 *
 * One coordinate system for every consumer: geometry places walls in it, and a
 * side-wall opening's positionFt is already in it. Null means "not a validly
 * configured combo" — which is not the same as an error, because a garage is
 * also not a combo.
 */
export function comboSpan(
  b: BuildingDimensions,
): { startFt: number; endFt: number; depthFt: number } | null {
  if (!isComboType(b.type)) return null;
  const c = b.combo;
  if (!c || !validDepth(c.enclosedDepthFt, b.lengthFt)) return null;
  const depthFt = c.enclosedDepthFt;
  return c.end === 'back'
    ? { startFt: b.lengthFt - depthFt, endFt: b.lengthFt, depthFt }
    : { startFt: 0, endFt: depthFt, depthFt };
}

/**
 * How many feet of this building are enclosed.
 *
 * This is the number the pricing engine wants, and it makes every type a case
 * of the same thing rather than a boolean plus a special case: an open building
 * encloses none of its length, a garage encloses all of it, a combo encloses
 * some. An invalid combo encloses none, so it prices as unpriceable rather than
 * quietly as a carport.
 */
export function enclosedDepthFt(b: BuildingDimensions): number {
  if (OPEN_TYPES.has(b.type)) return 0;
  if (isComboType(b.type)) return comboSpan(b)?.depthFt ?? 0;
  return b.lengthFt;
}

/** The depths offered in the designer: every step that leaves some carport. */
export function comboDepthOptions(lengthFt: number): number[] {
  const out: number[] = [];
  for (let d = COMBO_DEPTH_STEP_FT; d < lengthFt; d += COMBO_DEPTH_STEP_FT) out.push(d);
  return out;
}

/**
 * Pull a depth back inside a building that has been shortened.
 *
 * Without this, taking a 30ft combo with a 25ft enclosure down to 20ft leaves an
 * enclosure longer than the building: unpriceable, and drawn as nonsense. The
 * store calls this whenever lengthFt changes, the way it already clamps a
 * lean-to that would overrun its wall.
 */
export function clampComboDepth(depthFt: number, lengthFt: number): number {
  const options = comboDepthOptions(lengthFt);
  if (!options.length) return COMBO_DEPTH_STEP_FT;
  const max = options[options.length - 1];
  const snapped = Math.round(depthFt / COMBO_DEPTH_STEP_FT) * COMBO_DEPTH_STEP_FT;
  return Math.min(Math.max(snapped, COMBO_DEPTH_STEP_FT), max);
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run lib/building/__tests__/combo.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test` then `npx tsc --noEmit`
Expected: all pass, no output. Adding a union member can break exhaustive switches — if anything fails, it is telling you a real place that needs to handle a combo. Note which files, but only fix the ones that are pure type errors (a missing case in a `Record<BuildingType, X>` needs an entry); leave behaviour changes to the tasks that own them.

- [ ] **Step 7: Commit**

```bash
git add lib/building/combo.ts lib/building/__tests__/combo.test.ts lib/building/types.ts lib/db/dealers.ts
git commit -m "Say where a combo's dividing wall falls"
```

---

### Task 2: Price the enclosed depth, not a boolean

**Files:**
- Modify: `lib/pricing/manufacturer/engine.ts` (input type ~line 44, destructure ~line 179, wall block ~line 369)
- Test: `lib/pricing/manufacturer/__tests__/comboPricing.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 — the engine takes a plain number, and the adapter (Task 3) is what maps a config to it.
- Produces: `ManufacturerQuoteInput.enclosedDepthFt?: number` replacing `enclosed?: boolean`.

**Read `lib/pricing/manufacturer/engine.ts` before starting.** The wall block is around line 369 and its comments explain why wall price varies with siding rather than roof style. Do not disturb that.

- [ ] **Step 1: Write the failing test**

Create `lib/pricing/manufacturer/__tests__/comboPricing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { quoteFromTable } from '../engine';
import table from '../../data/tejasmex.json';
import type { ManufacturerTable } from '../types';

const T = table as unknown as ManufacturerTable;

const base = {
  widthFt: 24, lengthFt: 30, legHeightFt: 9,
  roofStyle: 'vertical' as const, surface: 'concrete' as const,
  siding: 'horizontal' as const,
};

const wallTotal = (q: { lines: { category: string; amount: number }[] }) =>
  q.lines.filter(l => l.category === 'wall').reduce((n, l) => n + l.amount, 0);

describe('enclosedDepthFt replaces the enclosed boolean', () => {
  it('prices no walls at zero', () => {
    const q = quoteFromTable(T, { ...base, enclosedDepthFt: 0 });
    expect(wallTotal(q)).toBe(0);
  });

  it('prices a full-length enclosure exactly as the old boolean did', () => {
    const q = quoteFromTable(T, { ...base, enclosedDepthFt: 30 });
    expect(wallTotal(q)).toBeGreaterThan(0);
    // Four walls: two sides and two ends.
    expect(q.lines.filter(l => l.category === 'wall')).toHaveLength(4);
  });
});

describe('a combo prices its side walls at the enclosed depth', () => {
  it('costs less than the same building fully enclosed', () => {
    const full = quoteFromTable(T, { ...base, enclosedDepthFt: 30 });
    const combo = quoteFromTable(T, { ...base, enclosedDepthFt: 10 });
    expect(wallTotal(combo)).toBeLessThan(wallTotal(full));
  });

  // The frame is the same building either way — only the walls change.
  it('does not change the base price', () => {
    const sum = (q: { lines: { category: string; amount: number }[] }, c: string) =>
      q.lines.filter(l => l.category === c).reduce((n, l) => n + l.amount, 0);
    const full = quoteFromTable(T, { ...base, enclosedDepthFt: 30 });
    const combo = quoteFromTable(T, { ...base, enclosedDepthFt: 10 });
    expect(sum(combo, 'base-price')).toBe(sum(full, 'base-price'));
  });

  // Two side walls at the depth, plus the closed outer end and the divider.
  it('still prices four walls — two sides, the outer end and the divider', () => {
    const q = quoteFromTable(T, { ...base, enclosedDepthFt: 10 });
    expect(q.lines.filter(l => l.category === 'wall')).toHaveLength(4);
  });

  it('prices the side walls from the depth bracket, so a deeper combo costs more', () => {
    const shallow = quoteFromTable(T, { ...base, enclosedDepthFt: 10 });
    const deep = quoteFromTable(T, { ...base, enclosedDepthFt: 25 });
    expect(wallTotal(deep)).toBeGreaterThan(wallTotal(shallow));
  });

  // Outside the measured envelope it refuses rather than falling back to the
  // much lower open-carport price.
  it('reports unpriceable rather than guessing when no wall row covers it', () => {
    const q = quoteFromTable(T, { ...base, legHeightFt: 16, enclosedDepthFt: 10 });
    if (wallTotal(q) === 0) expect(q.unpriceable?.length ?? 0).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/pricing/manufacturer/__tests__/comboPricing.test.ts`
Expected: FAIL — `enclosedDepthFt` is not a recognised input, so no walls are priced and the full-length case returns 0.

- [ ] **Step 3: Change the input type**

In `lib/pricing/manufacturer/engine.ts`, replace the `enclosed` field (around line 44):

```ts
  /**
   * How many feet of the building are enclosed. Walls are priced over this
   * length, not the building's.
   *
   * This was a boolean, which could only say "all of it" or "none of it" and so
   * could not express a combo — one frame with a dividing wall part way along
   * it. As a number every type is the same case: an open building encloses 0,
   * a garage encloses its whole length, a combo encloses some of it.
   */
  enclosedDepthFt?: number;
```

- [ ] **Step 4: Change the destructure and the wall block**

Around line 179, replace `enclosed = false,` with:

```ts
    enclosedDepthFt = 0,
```

Then at the wall block (around line 369), replace `if (enclosed) {` with:

```ts
  const enclosed = enclosedDepthFt > 0;
  if (enclosed) {
```

and inside it, change the side-wall lookup to bracket on the enclosed depth:

```ts
    const side = table.sideWalls?.find(
      r =>
        r.siding === siding &&
        inBracket(widthFt, r.widthBand) &&
        // The DEPTH, not the building length: a combo's side walls only run the
        // enclosed part. For every other type this is the length, so nothing
        // about their price changes.
        inBracket(enclosedDepthFt, r.length) &&
        r.heightFt === legHeightFt,
    );
```

and make the unpriceable message name the depth it actually failed on:

```ts
        unpriceable.push(
          `no measured side-wall price for width ${widthFt} x enclosed depth ${enclosedDepthFt} at ${legHeightFt}ft`,
        );
```

Leave the two end walls exactly as they are. On a fully enclosed building they are the front and back; on a combo one is the outer closed end and the other is the interior dividing wall.

- [ ] **Step 5: Run the test**

Run: `npx vitest run lib/pricing/manufacturer/__tests__/comboPricing.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Run the whole pricing suite**

Run: `npx vitest run lib/pricing`
Expected: PASS. Any existing pricing test that fails means the change was NOT behaviour-preserving — that is a real bug in your edit, not a test to update.

- [ ] **Step 7: Commit**

```bash
git add lib/pricing/manufacturer/engine.ts lib/pricing/manufacturer/__tests__/comboPricing.test.ts
git commit -m "Price walls over the enclosed depth rather than a yes or no"
```

---

### Task 3: Hand the adapter the depth

**Files:**
- Modify: `lib/pricing/manufacturer/adapter.ts` (`OPEN_BUILDING_TYPES` ~line 10, and the `enclosed` line inside `toQuoteInput`, ~line 133)
- Test: `lib/pricing/manufacturer/__tests__/comboAdapter.test.ts`

**Interfaces:**
- Consumes: `enclosedDepthFt(b: BuildingDimensions): number` from Task 1; `ManufacturerQuoteInput.enclosedDepthFt` from Task 2.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Create `lib/pricing/manufacturer/__tests__/comboAdapter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toQuoteInput } from '../adapter';
import { createDefaultConfig } from '../../../building/defaultConfig';
import type { BuildingConfig } from '../../../building/types';

const cfg = (over: Partial<BuildingConfig['building']>): BuildingConfig => {
  const c = createDefaultConfig('tejasmex');
  c.building = { ...c.building, widthFt: 24, lengthFt: 30, ...over };
  return c;
};

describe('the adapter turns a config into an enclosed depth', () => {
  it('sends zero for open types', () => {
    expect(toQuoteInput(cfg({ type: 'carport' })).input.enclosedDepthFt).toBe(0);
    expect(toQuoteInput(cfg({ type: 'rv-cover' })).input.enclosedDepthFt).toBe(0);
  });

  it('sends the full length for enclosed types', () => {
    expect(toQuoteInput(cfg({ type: 'garage' })).input.enclosedDepthFt).toBe(30);
  });

  it('sends the split for a combo', () => {
    const c = cfg({ type: 'combo', combo: { enclosedDepthFt: 10, end: 'front' } });
    expect(toQuoteInput(c).input.enclosedDepthFt).toBe(10);
  });

  // An unconfigured combo must not price as a carport.
  it('sends zero for a combo with no split, so it prices as unpriceable', () => {
    const c = cfg({ type: 'combo', combo: undefined });
    expect(toQuoteInput(c).input.enclosedDepthFt).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/pricing/manufacturer/__tests__/comboAdapter.test.ts`
Expected: FAIL — the input has `enclosed`, not `enclosedDepthFt`.

- [ ] **Step 3: Change the adapter**

In `lib/pricing/manufacturer/adapter.ts`, delete the `OPEN_BUILDING_TYPES` constant at line 10 — `lib/building/combo.ts` owns that knowledge now — and import instead:

```ts
import { enclosedDepthFt } from '../../building/combo';
```

Then in the input mapping (around line 133), replace the `enclosed` line:

```ts
      // Enclosed types are priced from the measured wall tables. Outside the
      // measured envelope the engine reports it rather than quoting the (much
      // lower) open-carport price. A combo encloses only part of its length,
      // which is why this is a depth and not a flag.
      enclosedDepthFt: enclosedDepthFt(b),
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run lib/pricing/manufacturer/__tests__/comboAdapter.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Run the whole suite and typecheck**

Run: `npm test` then `npx tsc --noEmit`
Expected: PASS and no output. `lib/db/__tests__/dealerPricingLive.test.ts` pins the live dealer's quote at exact figures — if it moves, the change was not behaviour-preserving.

- [ ] **Step 6: Commit**

```bash
git add lib/pricing/manufacturer/adapter.ts lib/pricing/manufacturer/__tests__/comboAdapter.test.ts
git commit -m "Give the pricing engine a combo's enclosed depth"
```

---

### Task 4: Keep the split valid in the store

**Files:**
- Modify: `lib/store/designerStore.ts`
- Test: `lib/store/__tests__/comboStore.test.ts`

**Interfaces:**
- Consumes: `clampComboDepth`, `comboDepthOptions`, `isComboType`, `COMBO_DEPTH_STEP_FT` from Task 1.
- Produces: nothing new — `updateBuilding` keeps its signature.

**Read `lib/store/designerStore.ts` first**, particularly the existing lean-to clamp when dimensions change. Follow that pattern rather than inventing one.

- [ ] **Step 1: Write the failing test**

Create `lib/store/__tests__/comboStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useDesignerStore } from '../designerStore';

const building = () => useDesignerStore.getState().config!.building;

beforeEach(() => {
  useDesignerStore.getState().initialize('tejasmex');
});

describe('switching to a combo', () => {
  it('gets a usable split rather than an empty one', () => {
    useDesignerStore.getState().updateBuilding({ type: 'combo' });
    const c = building().combo;
    expect(c).toBeDefined();
    expect(c!.enclosedDepthFt).toBeGreaterThan(0);
    expect(c!.enclosedDepthFt).toBeLessThan(building().lengthFt);
    expect(c!.end).toBe('front');
  });

  it('prices, rather than sitting unpriceable, the moment it is chosen', () => {
    useDesignerStore.getState().updateBuilding({ type: 'combo' });
    expect(useDesignerStore.getState().config!.pricing!.total).toBeGreaterThan(0);
  });
});

describe('shortening the building', () => {
  it('pulls the enclosed depth back inside it', () => {
    useDesignerStore.getState().updateBuilding({ type: 'combo', lengthFt: 30 });
    useDesignerStore.getState().updateBuilding({ combo: { enclosedDepthFt: 25, end: 'front' } });
    expect(building().combo!.enclosedDepthFt).toBe(25);

    useDesignerStore.getState().updateBuilding({ lengthFt: 20 });
    expect(building().combo!.enclosedDepthFt).toBe(15);
  });

  it('leaves a depth that still fits alone', () => {
    useDesignerStore.getState().updateBuilding({ type: 'combo', lengthFt: 40 });
    useDesignerStore.getState().updateBuilding({ combo: { enclosedDepthFt: 10, end: 'front' } });
    useDesignerStore.getState().updateBuilding({ lengthFt: 30 });
    expect(building().combo!.enclosedDepthFt).toBe(10);
  });
});

describe('switching away from a combo', () => {
  it('drops the split, so a garage does not carry a dividing wall', () => {
    useDesignerStore.getState().updateBuilding({ type: 'combo' });
    useDesignerStore.getState().updateBuilding({ type: 'garage' });
    expect(building().combo).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/store/__tests__/comboStore.test.ts`
Expected: FAIL — choosing `combo` leaves `building().combo` undefined.

- [ ] **Step 3: Implement in the store**

Add the import at the top of `lib/store/designerStore.ts`:

```ts
import { clampComboDepth, comboDepthOptions, isComboType, COMBO_DEPTH_STEP_FT } from '../building/combo';
```

In `updateBuilding`, after the incoming patch is merged into the next building and before pricing is recalculated, normalise the split:

```ts
/**
 * Keep the combo split consistent with the building it sits in.
 *
 * Three things go wrong without this. Choosing "combo" leaves no split at all,
 * so the building prices as unpriceable the moment it is picked. Shortening a
 * 30ft building with a 25ft enclosure to 20ft leaves an enclosure longer than
 * the building. And switching away to a garage leaves a dividing wall behind on
 * a type that has no business carrying one.
 */
function normaliseCombo(b: BuildingDimensions): BuildingDimensions {
  if (!isComboType(b.type)) {
    if (!b.combo) return b;
    const { combo: _dropped, ...rest } = b;
    return rest as BuildingDimensions;
  }
  const options = comboDepthOptions(b.lengthFt);
  const fallback = options.length
    ? options[Math.max(0, Math.floor(options.length / 2))]
    : COMBO_DEPTH_STEP_FT;
  const current = b.combo?.enclosedDepthFt;
  return {
    ...b,
    combo: {
      end: b.combo?.end ?? 'front',
      enclosedDepthFt:
        typeof current === 'number' ? clampComboDepth(current, b.lengthFt) : fallback,
    },
  };
}
```

Then call it at the one place the building is merged. `updateBuilding` currently
reads:

```ts
    const rules = dealerSettings?.pricing ?? DEFAULT_PRICING_RULES;
    const nextBuilding = { ...config.building, ...updates };
```

Change the second line to normalise before anything else sees it:

```ts
    const rules = dealerSettings?.pricing ?? DEFAULT_PRICING_RULES;
    const nextBuilding = normaliseCombo({ ...config.building, ...updates });
```

That is upstream of `clampLeanToLength`, `clampOpening` and `withPricing`, so the
split, the geometry and the price can never disagree — the same reason those two
clamps already sit there.

- [ ] **Step 4: Run the test**

Run: `npx vitest run lib/store/__tests__/comboStore.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run the whole suite and typecheck**

Run: `npm test` then `npx tsc --noEmit`
Expected: PASS and no output.

- [ ] **Step 6: Commit**

```bash
git add lib/store/designerStore.ts lib/store/__tests__/comboStore.test.ts
git commit -m "Keep a combo's split inside the building it belongs to"
```

---

### Task 5: The depth buttons

**Files:**
- Modify: `components/designer/BuildingDesigner.tsx` (`BUILDING_TYPES` ~line 221, and `DimensionSection`)
- Test: `components/designer/__tests__/comboControls.test.tsx`

**Interfaces:**
- Consumes: `comboDepthOptions`, `isComboType` from Task 1; the store's `updateBuilding`.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Create `components/designer/__tests__/comboControls.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import BuildingDesigner from '../BuildingDesigner';
import { useDesignerStore } from '@/lib/store/designerStore';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('../ThreeScene', () => ({ ThreeScene: () => null }));

beforeEach(() => {
  useDesignerStore.getState().initialize('tejasmex');
});
afterEach(() => {
  cleanup();
  useDesignerStore.setState({ isQuoteFormOpen: false, selectedOpeningId: null });
});

describe('the combo type', () => {
  it('is offered in the type picker', () => {
    render(<BuildingDesigner dealerId="tejasmex" dealer={null} />);
    expect(screen.getByRole('button', { name: /combo/i })).toBeTruthy();
  });

  it('shows no depth buttons until a combo is chosen', () => {
    render(<BuildingDesigner dealerId="tejasmex" dealer={null} />);
    expect(screen.queryByRole('group', { name: /enclosed depth/i })).toBeNull();
  });
});

describe('the depth buttons', () => {
  beforeEach(() => {
    useDesignerStore.getState().updateBuilding({ type: 'combo', lengthFt: 30 });
  });

  it('offers every 5ft step that leaves some carport', () => {
    render(<BuildingDesigner dealerId="tejasmex" dealer={null} />);
    const group = screen.getByRole('group', { name: /enclosed depth/i });
    const labels = Array.from(group.querySelectorAll('button')).map(b => b.textContent?.trim());
    expect(labels).toEqual(['5', '10', '15', '20', '25']);
  });

  it('sets the depth when one is tapped', () => {
    render(<BuildingDesigner dealerId="tejasmex" dealer={null} />);
    const group = screen.getByRole('group', { name: /enclosed depth/i });
    fireEvent.click(Array.from(group.querySelectorAll('button')).find(b => b.textContent?.trim() === '20')!);
    expect(useDesignerStore.getState().config!.building.combo!.enclosedDepthFt).toBe(20);
  });

  it('marks the chosen depth as pressed', () => {
    useDesignerStore.getState().updateBuilding({ combo: { enclosedDepthFt: 15, end: 'front' } });
    render(<BuildingDesigner dealerId="tejasmex" dealer={null} />);
    const group = screen.getByRole('group', { name: /enclosed depth/i });
    const pressed = Array.from(group.querySelectorAll('button')).filter(
      b => b.getAttribute('aria-pressed') === 'true',
    );
    expect(pressed).toHaveLength(1);
    expect(pressed[0].textContent?.trim()).toBe('15');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/designer/__tests__/comboControls.test.tsx`
Expected: FAIL — there is no Combo button.

- [ ] **Step 3: Add the type to the picker**

In `components/designer/BuildingDesigner.tsx`, add to `BUILDING_TYPES` (around line 221), after `rv-cover`:

```ts
  { value: 'combo', label: 'Combo', icon: 'M3 20V10L12 4L21 10V20H12V13H7V20ZM14 18H19V12H14Z' },
```

- [ ] **Step 4: Add the depth buttons**

Add this component to `components/designer/BuildingDesigner.tsx` and render it inside `DimensionSection`, directly after the Length control so the depth reads as a property of the length:

```tsx
/**
 * How deep the enclosed end runs.
 *
 * Buttons rather than a slider because a dealer picks a depth, they do not dial
 * one in. The steps are the same 5ft the building's own length uses, and the
 * row stops one step short of the length because a combo enclosed end to end is
 * a garage. On a very long building the row wraps, which is fine.
 */
function ComboDepthControl() {
  const building = useDesignerStore((s) => s.config!.building);
  const update = useDesignerStore((s) => s.updateBuilding);

  if (!isComboType(building.type)) return null;

  const options = comboDepthOptions(building.lengthFt);
  const current = building.combo?.enclosedDepthFt;

  return (
    <div className="mt-4">
      <div className="mb-1.5 flex items-baseline justify-between">
        <label className="text-xs font-medium text-gray-700">Enclosed depth</label>
        <span className="text-[11px] text-gray-500">
          {current != null ? `${building.lengthFt - current}ft open` : ''}
        </span>
      </div>
      <div role="group" aria-label="Enclosed depth in feet" className="flex flex-wrap gap-1.5">
        {options.map(d => (
          <button
            key={d}
            type="button"
            aria-pressed={d === current}
            onClick={() => update({ combo: { enclosedDepthFt: d, end: building.combo?.end ?? 'front' } })}
            className={
              d === current
                ? 'rounded border border-blue-500 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700'
                : 'rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:border-gray-400'
            }
          >
            {d}
          </button>
        ))}
      </div>
    </div>
  );
}
```

Add the import at the top of the file:

```ts
import { comboDepthOptions, isComboType } from '@/lib/building/combo';
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run components/designer/__tests__/comboControls.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 6: Run the whole suite and typecheck**

Run: `npm test` then `npx tsc --noEmit`
Expected: PASS and no output.

- [ ] **Step 7: Commit**

```bash
git add components/designer/BuildingDesigner.tsx components/designer/__tests__/comboControls.test.tsx
git commit -m "Pick how deep the enclosed end runs"
```

---

### Task 6: Draw it

**Files:**
- Modify: `components/designer/ThreeScene.tsx` (`isOpen` ~line 337, `SideWalls` ~line 482, `GableWalls` ~line 506)
- Test: manual, in the browser — see the steps

**Interfaces:**
- Consumes: `comboSpan` from Task 1.
- Produces: nothing new.

**Read `components/designer/ThreeScene.tsx` around lines 330–530 before starting.** `buildBuilding` computes all four walls unconditionally; this file decides which are rendered. Today that is a single `isOpen` flag. Note the coordinate system: the left wall group sits at `[0,0,0]` rotated `-π/2` and runs along +z; the right wall group sits at `[W,0,L]` rotated `+π/2`.

There is no jsdom test for the 3D scene — it needs WebGL, and the existing designer tests mock `ThreeScene` away entirely for that reason. This task is verified by looking at it, which is why it is its own task with its own screenshots.

- [ ] **Step 1: Render walls only over the enclosed span**

Replace the `isOpen` gate (around line 337) so a combo renders walls too:

```tsx
  // A combo is neither open nor enclosed: it has walls over part of its length.
  // comboSpan is null for every other type, so they behave exactly as before.
  const span = comboSpan(config.building);
  const isOpen = config.building.type === 'carport' || config.building.type === 'rv-cover';
```

Pass the span down:

```tsx
      {!isOpen && <SideWalls result={result} color={config.colors.walls.hex} openings={config.openings} panelDir={wallPanelDir} wainscotColor={wainscotHex} span={span} />}
      {!isOpen && <GableWalls result={result} color={config.colors.walls.hex} openings={config.openings} panelDir={wallPanelDir} wainscotColor={wainscotHex} span={span} end={config.building.combo?.end ?? null} />}
```

Add the import:

```ts
import { comboSpan } from '@/lib/building/combo';
```

- [ ] **Step 2: Shorten the side walls to the span**

In `SideWalls`, accept the span and use it. The left wall runs along +z from `startFt`; the right wall runs along −z from `L − startFt`, because its group is rotated 180° relative to the left:

```tsx
function SideWalls({ result, color, openings, panelDir, wainscotColor, span }: {
  result: BuildingResult; color: string; openings: Opening[];
  panelDir: 'horizontal' | 'vertical'; wainscotColor: string | null;
  span: { startFt: number; endFt: number; depthFt: number } | null;
}) {
  const { width: W, length: L, height: H } = result.dimensions;
  // A full-length wall is the same thing as a span covering the whole building,
  // so there is one code path rather than two.
  const start = span?.startFt ?? 0;
  const runLength = span?.depthFt ?? L;

  // An opening's positionFt is measured from the front, the same axis the span
  // is in, so a door outside the enclosed part simply has no wall to sit in.
  const inSpan = (o: Opening) =>
    span == null || (o.positionFt >= span.startFt && o.positionFt < span.endFt);
  const shift = (o: Opening): Opening => ({ ...o, positionFt: o.positionFt - start });

  const leftOps = useMemo(
    () => openings.filter(o => o.wall === 'left').filter(inSpan).map(shift),
    [openings, span?.startFt, span?.endFt],
  );
  const rightOps = useMemo(
    () => openings.filter(o => o.wall === 'right').filter(inSpan).map(shift),
    [openings, span?.startFt, span?.endFt],
  );

  return (
    <group>
      <group position={[0, 0, start]} rotation={[0, -Math.PI / 2, 0]}>
        <SegmentedWall wallLength={runLength} wallHeight={H} color={color} openings={leftOps} zOff={-WALL_THICKNESS} panelDir={panelDir} wainscotColor={wainscotColor} />
      </group>
      <group position={[W, 0, L - start]} rotation={[0, Math.PI / 2, 0]}>
        <SegmentedWall wallLength={runLength} wallHeight={H} color={color} openings={rightOps} zOff={-WALL_THICKNESS} panelDir={panelDir} wainscotColor={wainscotColor} />
      </group>
    </group>
  );
}
```

- [ ] **Step 3: Draw one gable end and the divider**

In `GableWalls`, render the gable at the enclosed end only, and a divider with the same profile at the split:

```tsx
function GableWalls({ result, color, openings, panelDir, wainscotColor, span, end }: {
  result: BuildingResult; color: string; openings: Opening[];
  panelDir: 'horizontal' | 'vertical'; wainscotColor: string | null;
  span: { startFt: number; endFt: number; depthFt: number } | null;
  end: 'front' | 'back' | null;
}) {
  const { width: W, length: L, height: H, rise } = result.dimensions;
  const frontOps = useMemo(() => openings.filter(o => o.wall === 'front'), [openings]);
  const backOps = useMemo(() => openings.filter(o => o.wall === 'back'), [openings]);

  // Not a combo: both ends, exactly as before.
  const showFront = span == null || end === 'front';
  const showBack = span == null || end === 'back';
  // The divider closes the inner face of the enclosure. It carries no openings:
  // a door in the wall between a garage and its own carport is not a product.
  const dividerAt = span == null ? null : end === 'back' ? span.startFt : span.endFt;

  return (
    <group>
      {showFront && (
        <group>
          <SegmentedWall wallLength={W} wallHeight={H} color={color} openings={frontOps} zOff={-WALL_THICKNESS} panelDir={panelDir} wainscotColor={wainscotColor} />
          <GableTriangle width={W} height={H} rise={rise} color={color} side="front" />
        </group>
      )}
      {showBack && (
        <group position={[W, 0, L]} rotation={[0, Math.PI, 0]}>
          <SegmentedWall wallLength={W} wallHeight={H} color={color} openings={backOps} zOff={WALL_THICKNESS} panelDir={panelDir} wainscotColor={wainscotColor} />
          <GableTriangle width={W} height={H} rise={rise} color={color} side="back" />
        </group>
      )}
      {dividerAt != null && (
        <group position={[W, 0, dividerAt]} rotation={[0, Math.PI, 0]}>
          <SegmentedWall wallLength={W} wallHeight={H} color={color} openings={[]} zOff={WALL_THICKNESS} panelDir={panelDir} wainscotColor={wainscotColor} />
          <GableTriangle width={W} height={H} rise={rise} color={color} side="back" />
        </group>
      )}
    </group>
  );
}
```

- [ ] **Step 4: Typecheck and run the suite**

Run: `npx tsc --noEmit` then `npm test`
Expected: no output, and all tests pass. The designer tests mock `ThreeScene`, so they cover the props you changed only through typechecking.

- [ ] **Step 5: Look at it**

Run `npx next dev -p 3001` and open `http://localhost:3001/designer`.

Check each of these and note what you see:
1. Choose **Combo**. Walls appear over part of the building, with the rest open carport.
2. The **divider** is present at the split, with a gable profile matching the ends.
3. Only **one** gable end is walled — the enclosed one.
4. Tap through the depth buttons. The enclosed part grows and shrinks, and the divider moves with it.
5. Switch to **Garage**: all four walls, no divider. Switch to **Carport**: no walls. Neither should have changed.
6. Add a roll-up door on the left wall inside the enclosed part — it appears. Move it outside — it disappears rather than floating.

- [ ] **Step 6: Screenshot the result**

Capture the combo at 24x30 with a 10ft depth, and attach it to the commit message body or save it under the task report. A picture is the only real evidence for this task.

- [ ] **Step 7: Commit**

```bash
git add components/designer/ThreeScene.tsx
git commit -m "Draw a combo: walls over the enclosed end, and the divider"
```

---

### Task 7: Verify the numbers against TejasMex

**Files:**
- Create: `docs/superpowers/notes/2026-09-04-combo-pricing-verification.md`
- Modify: whatever Task 2 got wrong, if anything

**Interfaces:**
- Consumes: everything above.
- Produces: a verification note, and a corrected dividing-wall assumption if it turns out to be wrong.

This is the checkpoint the owner asked for. The spec's one assumption not derivable from captured data is **that TejasMex charges the interior dividing wall as a full end wall at the building's width.** Everything else follows from the price table.

- [ ] **Step 1: Quote three combos in the app**

Run the designer and record the total, the base price and the wall lines for:
- 24x30x9, vertical roof, concrete, horizontal siding, 10ft enclosed
- 24x30x9, same, 20ft enclosed
- 20x40x10, vertical roof, concrete, horizontal siding, 15ft enclosed

- [ ] **Step 2: Quote the same three in TejasMex's configurator**

Open `https://design.tejasmex.com/?dealer=Columbia`, choose **End Combo**, and build each of the three. Record their totals.

- [ ] **Step 3: Write the comparison down**

Create `docs/superpowers/notes/2026-09-04-combo-pricing-verification.md` with a row per building: our total, theirs, the difference, and whether the wall lines match. State plainly whether the dividing-wall assumption held.

- [ ] **Step 4: If the divider is not charged as a full end wall, fix it**

The likely shapes, and what each means:

- **Their total is one end wall lower than ours** — the divider is not charged at all. In `lib/pricing/manufacturer/engine.ts`, push only one end-wall line when the enclosure is partial.
- **Their total is lower by part of an end wall** — the divider is charged at a different rate, probably as an interior partition. Add the measured figure to the note and price it from there.
- **They match** — the assumption held; record that and change nothing.

Whichever it is, add a test to `lib/pricing/manufacturer/__tests__/comboPricing.test.ts` pinning the real measured total for at least one of the three, the way `lib/db/__tests__/dealerPricingLive.test.ts` pins the live dealer's figures.

- [ ] **Step 5: Run the suite and commit**

```bash
npm test
git add docs/superpowers/notes/2026-09-04-combo-pricing-verification.md lib/pricing
git commit -m "Check combo prices against the manufacturer's own configurator"
```

---

## Notes for the implementer

**The one box rule.** A combo is a dividing wall position. If you find yourself building a second frame, a second roof, or a second slab, stop — that is not what this is, and it would price the roof twice.

**`comboSpan` returns null for everything that is not a combo**, which is what lets every consumer have one code path instead of two. Resist adding `if (type === 'combo')` checks outside `lib/building/combo.ts`.

**The boolean-to-depth change must not move any existing number.** `lib/db/__tests__/dealerPricingLive.test.ts` pins the live dealer's quote at exact figures and is the canary. If it moves, you have a bug, not a test to update.

**The assistant is out of scope.** No changes to `lib/ai/**` or `lib/inbound/**`. A combo the engine cannot price is already handled: it comes back unpriceable and the bot hands off.
