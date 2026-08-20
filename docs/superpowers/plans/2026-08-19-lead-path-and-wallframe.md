# Lead Path Repair + `wallFrame` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop losing sales leads, make per-dealer pricing real, and fix the lean-to geometry permanently by introducing a single shared wall coordinate frame.

**Architecture:** Two independent halves. The **geometry half** (Tasks 1-3) adds a Vitest harness and a pure-function `wallFrame()` module that becomes the single source of truth for wall position/orientation, then migrates `leanTo`, `openings`, and `trim` onto it. The **lead-path half** (Tasks 4-10) replaces a filesystem write that cannot work on Vercel with Neon Postgres, makes quote submission report failure honestly, wires per-dealer pricing, and notifies the dealer by SMS and email. The halves share no code and may be executed in either order; geometry is sequenced first because it has zero infrastructure dependencies and can proceed while Neon is being provisioned.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript 5.7, three.js / @react-three/fiber, zustand 5, Vitest, Neon Postgres (`@neondatabase/serverless`), Resend, Telnyx (REST).

**Spec:** `docs/superpowers/specs/2026-08-19-lead-path-and-wallframe-design.md`

## Global Constraints

- Node 19+ is required by `@neondatabase/serverless`. Vercel default runtime is Node 24.
- **Never rename the `RoofStyle` member `'aframe'`.** It keys `DealerPricingRules.roofStyleModifiers` (`lib/building/types.ts:231`) and is read as `rules.roofStyleModifiers[building.roofStyle] ?? 0` (`lib/pricing/calculatePrice.ts:41`). Renaming silently resolves to `0`. Display labels only.
- **Never wrap the Neon client in a `Proxy`.** Use a plain lazy `getSql()`.
- All money persisted to `quotes.total_cents` is an integer in **cents**.
- Notification failures must never fail an HTTP request whose quote row already committed.
- 1 three.js unit = 1 foot. Building origin `(0,0,0)` is the front-left corner at ground level.
- Never echo secret values. Use `vercel env add`; do not print `.env.local` contents.

---

## File Structure

**Created:**
- `vitest.config.ts` — test runner config with `@/` alias
- `lib/building/wallFrame.ts` — wall coordinate frame; single source of truth
- `lib/building/__tests__/wallFrame.test.ts` — frame table, orthonormality, handedness
- `lib/building/__tests__/leanTo.test.ts` — four-wall attachment, extent clamping
- `lib/building/__tests__/pricing.golden.test.ts` — pricing must not move under refactor
- `lib/db/index.ts` — lazy Neon client
- `lib/db/schema.sql` — table definitions
- `lib/db/dealers.ts` — dealer read + row mapping
- `lib/db/quotes.ts` — quote insert
- `lib/notify/index.ts` — `notifyNewLead`, orchestrates both channels
- `lib/notify/sms.ts` — Telnyx (REST, no SDK)
- `lib/notify/email.ts` — Resend
- `scripts/migrate.ts` — applies `schema.sql`
- `scripts/seed-dealer.ts` — seeds the `tejasmex` row
- `app/api/quote/__tests__/route.test.ts` — API contract tests

**Modified:**
- `package.json` — scripts + dependencies
- `lib/building/leanTo.ts:107-164` — attachment via `wallFrame`; open-roof default
- `lib/building/types.ts` — `LeanTo.walls` field
- `lib/building/openings.ts` — placement via `pointOnWall`
- `lib/building/trim.ts` — placement via `pointOnWall`
- `lib/store/designerStore.ts:33,77,287-301` — submit result type, error state, dealer settings
- `components/designer/BuildingDesigner.tsx:794-798,806-826` — honest success/failure
- `app/api/quote/route.ts` — full rewrite
- `app/designer/page.tsx` — dealer resolution from `?dealer=`

---

## Task 1: Vitest harness + `wallFrame`

**Files:**
- Create: `vitest.config.ts`, `lib/building/wallFrame.ts`, `lib/building/__tests__/wallFrame.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `BuildingDimensions`, `WallId` from `lib/building/types.ts`
- Produces: `type Vec3 = [number, number, number]`; `interface WallFrame`; `wallFrame(wall: WallId, b: BuildingDimensions): WallFrame`; `pointOnWall(f: WallFrame, uFt: number, vFt: number, outFt?: number): Vec3`

- [ ] **Step 1: Install Vitest**

```bash
npm i -D vitest
```

- [ ] **Step 2: Add test scripts to `package.json`**

In the `"scripts"` block add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/__tests__/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
});
```

- [ ] **Step 4: Write the failing test**

Create `lib/building/__tests__/wallFrame.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { wallFrame, pointOnWall, type Vec3 } from '../wallFrame';
import type { BuildingDimensions, WallId } from '../types';

const B: BuildingDimensions = {
  type: 'garage',
  widthFt: 24,
  lengthFt: 30,
  legHeightFt: 10,
  roofStyle: 'vertical',
  roofPitch: '4:12',
  orientation: 'length-facing-front',
  panelDirection: { walls: 'horizontal', roof: 'vertical' },
};

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.sqrt(dot(a, a));

const WALLS: WallId[] = ['front', 'back', 'left', 'right'];

describe('wallFrame', () => {
  it('returns the locked convention for every wall', () => {
    expect(wallFrame('front', B)).toMatchObject({
      origin: [24, 0, 0], along: [-1, 0, 0], normal: [0, 0, -1],
      lengthFt: 24, isGable: true, rotationY: Math.PI,
    });
    expect(wallFrame('back', B)).toMatchObject({
      origin: [0, 0, 30], along: [1, 0, 0], normal: [0, 0, 1],
      lengthFt: 24, isGable: true, rotationY: 0,
    });
    expect(wallFrame('left', B)).toMatchObject({
      origin: [0, 0, 0], along: [0, 0, 1], normal: [-1, 0, 0],
      lengthFt: 30, isGable: false, rotationY: -Math.PI / 2,
    });
    expect(wallFrame('right', B)).toMatchObject({
      origin: [24, 0, 30], along: [0, 0, -1], normal: [1, 0, 0],
      lengthFt: 30, isGable: false, rotationY: Math.PI / 2,
    });
  });

  it('has orthonormal basis vectors on every wall', () => {
    for (const w of WALLS) {
      const f = wallFrame(w, B);
      expect(len(f.along)).toBeCloseTo(1, 10);
      expect(len(f.normal)).toBeCloseTo(1, 10);
      expect(dot(f.along, f.normal)).toBeCloseTo(0, 10);
    }
  });

  // Guards against a future "fix" flipping a basis vector and mirroring geometry.
  it('has consistent handedness: cross(normal, along) === (0,1,0) on every wall', () => {
    for (const w of WALLS) {
      const f = wallFrame(w, B);
      const c = cross(f.normal, f.along);
      expect(c[0]).toBeCloseTo(0, 10);
      expect(c[1]).toBeCloseTo(1, 10);
      expect(c[2]).toBeCloseTo(0, 10);
    }
  });

  it('rotationY maps local +X onto along and local +Z onto normal', () => {
    for (const w of WALLS) {
      const f = wallFrame(w, B);
      const t = f.rotationY;
      const localX: Vec3 = [Math.cos(t), 0, -Math.sin(t)];
      const localZ: Vec3 = [Math.sin(t), 0, Math.cos(t)];
      localX.forEach((v, i) => expect(v).toBeCloseTo(f.along[i], 10));
      localZ.forEach((v, i) => expect(v).toBeCloseTo(f.normal[i], 10));
    }
  });

  it('pointOnWall walks the full wall and offsets outward', () => {
    const f = wallFrame('left', B);
    expect(pointOnWall(f, 0, 0)).toEqual([0, 0, 0]);
    expect(pointOnWall(f, 30, 0)).toEqual([0, 0, 30]);
    expect(pointOnWall(f, 15, 4)).toEqual([0, 4, 15]);
    expect(pointOnWall(f, 15, 0, 2)).toEqual([-2, 0, 15]); // outward = -X
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm test -- wallFrame`
Expected: FAIL — `Cannot find module '../wallFrame'`

- [ ] **Step 6: Implement `wallFrame`**

Create `lib/building/wallFrame.ts`:

```ts
// Steel Sync — Wall coordinate frame.
// THE single source of truth for "where is this wall and which way does it face".
// Openings, trim, and lean-to attachment all consume this. Do not re-derive
// wall position anywhere else.
//
// Building origin (0,0,0) is the front-left corner at ground level.
//   front wall: Z = 0, faces -Z      back wall:  Z = L, faces +Z
//   left wall:  X = 0, faces -X      right wall: X = W, faces +X
//
// `along` points in the direction `positionFt` increases, which is left-to-right
// as seen by a viewer standing OUTSIDE the wall looking at it. That is what a
// customer means by "3 feet from the left edge".

import type { BuildingDimensions, WallId } from './types';

export type Vec3 = [number, number, number];

export interface WallFrame {
  wall: WallId;
  /** World position of the wall's u=0 bottom corner. */
  origin: Vec3;
  /** Unit vector along the wall, in the direction positionFt increases. */
  along: Vec3;
  /** Unit outward normal, pointing away from the building interior. */
  normal: Vec3;
  /** Wall extent in feet along `along`. */
  lengthFt: number;
  /** Eave height at this wall. */
  eaveHeightFt: number;
  /** front/back carry a triangular gable top. */
  isGable: boolean;
  /** Y-rotation that places a local +X-along / +Z-outward mesh onto this wall. */
  rotationY: number;
}

const HALF_PI = Math.PI / 2;

export function wallFrame(wall: WallId, b: BuildingDimensions): WallFrame {
  const W = b.widthFt;
  const L = b.lengthFt;
  const h = b.legHeightFt;

  switch (wall) {
    case 'front':
      return { wall, origin: [W, 0, 0], along: [-1, 0, 0], normal: [0, 0, -1],
               lengthFt: W, eaveHeightFt: h, isGable: true, rotationY: Math.PI };
    case 'back':
      return { wall, origin: [0, 0, L], along: [1, 0, 0], normal: [0, 0, 1],
               lengthFt: W, eaveHeightFt: h, isGable: true, rotationY: 0 };
    case 'left':
      return { wall, origin: [0, 0, 0], along: [0, 0, 1], normal: [-1, 0, 0],
               lengthFt: L, eaveHeightFt: h, isGable: false, rotationY: -HALF_PI };
    case 'right':
      return { wall, origin: [W, 0, L], along: [0, 0, -1], normal: [1, 0, 0],
               lengthFt: L, eaveHeightFt: h, isGable: false, rotationY: HALF_PI };
  }
}

/**
 * A point on the wall plane.
 * @param uFt  distance along the wall from its u=0 edge
 * @param vFt  height above ground
 * @param outFt outward offset along the wall normal (use a small value to sit
 *              trim or an opening proud of the panel and avoid z-fighting)
 */
export function pointOnWall(f: WallFrame, uFt: number, vFt: number, outFt = 0): Vec3 {
  return [
    f.origin[0] + f.along[0] * uFt + f.normal[0] * outFt,
    f.origin[1] + vFt,
    f.origin[2] + f.along[2] * uFt + f.normal[2] * outFt,
  ];
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test -- wallFrame`
Expected: PASS, 5 tests

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vitest.config.ts lib/building/wallFrame.ts lib/building/__tests__/wallFrame.test.ts
git commit -m "feat: add wallFrame module and Vitest harness

Single source of truth for wall position and orientation. Handedness is
pinned by test so a future fix cannot flip a basis vector and mirror geometry."
```

---

## Task 2: Fix lean-to attachment and make it an open roof

**Files:**
- Create: `lib/building/__tests__/leanTo.test.ts`
- Modify: `lib/building/leanTo.ts:42-164`, `lib/building/types.ts` (LeanTo), `lib/building/defaultConfig.ts`

**Interfaces:**
- Consumes: `wallFrame`, `pointOnWall` from Task 1
- Produces: `LeanTo.walls: 'open' | 'enclosed'`; `buildLeanTo` unchanged signature, `LeanToResult.meshes` now omits wall parts when `walls === 'open'`

- [ ] **Step 1: Write the failing test**

Create `lib/building/__tests__/leanTo.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildLeanTo } from '../leanTo';
import type { BuildingDimensions, LeanTo, WallId } from '../types';

const B: BuildingDimensions = {
  type: 'garage', widthFt: 24, lengthFt: 30, legHeightFt: 10,
  roofStyle: 'vertical', roofPitch: '4:12', orientation: 'length-facing-front',
  panelDirection: { walls: 'horizontal', roof: 'vertical' },
};

const lean = (wall: WallId, over: Partial<LeanTo> = {}): LeanTo => ({
  id: 'lt1', wall, widthFt: 5, lengthFt: 30, heightFt: 8,
  roofColor: { id: 'white', hex: '#FFFFFF' },
  wallColor: { id: 'white', hex: '#FFFFFF' },
  openings: [], walls: 'open', ...over,
});

/** Rotate a local point into world space using the group transform. */
function toWorld(p: [number, number, number], pos: [number, number, number], ry: number) {
  const c = Math.cos(ry), s = Math.sin(ry);
  return [pos[0] + c * p[0] + s * p[2], pos[1] + p[1], pos[2] - s * p[0] + c * p[2]];
}

describe('lean-to attachment', () => {
  // The bug this test exists to catch: left/right rotations were swapped, so a
  // left lean landed off the FRONT of the building, collinear with it.
  it.each([
    ['left',  (x: number) => x < 0],
    ['right', (x: number) => x > 24],
  ] as const)('%s lean projects outward past its wall', (wall, outside) => {
    const r = buildLeanTo(lean(wall), B);
    const outer = r.meshes.find(m => m.part === 'roof')!;
    // Far edge of the lean roof, in local space, is at Z = projection width.
    const far = toWorld([0, 0, 5], r.groupPosition, r.groupRotationY);
    expect(outside(far[0])).toBe(true);
    // And it must stay within the building's Z span, not run off an end.
    expect(far[2]).toBeGreaterThanOrEqual(-0.001);
    expect(far[2]).toBeLessThanOrEqual(30.001);
    expect(outer).toBeDefined();
  });

  it.each([
    ['front', (z: number) => z < 0],
    ['back',  (z: number) => z > 30],
  ] as const)('%s lean projects outward past its wall', (wall, outside) => {
    const r = buildLeanTo(lean(wall, { lengthFt: 24 }), B);
    const far = toWorld([0, 0, 5], r.groupPosition, r.groupRotationY);
    expect(outside(far[2])).toBe(true);
    expect(far[0]).toBeGreaterThanOrEqual(-0.001);
    expect(far[0]).toBeLessThanOrEqual(24.001);
  });

  it('clamps extent to the attached wall and centres it', () => {
    // 30ft lean requested on the 24ft front wall.
    const r = buildLeanTo(lean('front', { lengthFt: 30 }), B);
    expect(r.extentFt).toBe(24);
    const a = toWorld([0, 0, 0], r.groupPosition, r.groupRotationY);
    const b = toWorld([r.extentFt, 0, 0], r.groupPosition, r.groupRotationY);
    expect(Math.min(a[0], b[0])).toBeCloseTo(0, 6);
    expect(Math.max(a[0], b[0])).toBeCloseTo(24, 6);
  });

  it('an open lean emits a roof but no walls', () => {
    const r = buildLeanTo(lean('left', { walls: 'open' }), B);
    const parts = r.meshes.map(m => m.part);
    expect(parts).toContain('roof');
    expect(parts).not.toContain('wall-outer');
    expect(parts).not.toContain('wall-left');
    expect(parts).not.toContain('wall-right');
  });

  it('an enclosed lean emits the outer and end walls', () => {
    const r = buildLeanTo(lean('left', { walls: 'enclosed' }), B);
    const parts = r.meshes.map(m => m.part);
    expect(parts).toContain('wall-outer');
    expect(parts).toContain('wall-left');
    expect(parts).toContain('wall-right');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- leanTo`
Expected: FAIL — `left lean projects outward` fails (currently projects to `+X`), and `extentFt` is undefined.

- [ ] **Step 3: Add `walls` to the `LeanTo` type**

In `lib/building/types.ts`, in `interface LeanTo`, after `heightFt`:

```ts
  /** 'open' = roof on posts only (default, matches industry "Open Lean"). */
  walls: 'open' | 'enclosed';
```

- [ ] **Step 4: Replace the attachment logic in `lib/building/leanTo.ts`**

Replace the `computeAttachment` function (lines 117-164) entirely with:

```ts
/**
 * Attach the lean-to using the shared wall frame.
 *
 * The lean is modelled in local space with +X along the parent wall and +Z
 * projecting outward. `WallFrame.rotationY` maps exactly that basis onto the
 * wall, so left and right cannot disagree — the class of bug that previously
 * rendered a left lean collinear with the building.
 */
function computeAttachment(
  leanTo: LeanTo,
  b: BuildingDimensions,
): { groupPosition: [number, number, number]; groupRotationY: number; extentFt: number } {
  const f = wallFrame(leanTo.wall, b);
  const extentFt = Math.min(leanTo.lengthFt, f.lengthFt);
  const u0 = (f.lengthFt - extentFt) / 2;   // centre it along the wall
  return {
    groupPosition: pointOnWall(f, u0, 0, 0),
    groupRotationY: f.rotationY,
    extentFt,
  };
}
```

- [ ] **Step 5: Update imports and the builder body**

At the top of `lib/building/leanTo.ts`, replace the `ridgeRiseFt` import (line 5):

```ts
import { wallFrame, pointOnWall } from './wallFrame';
```

Add `extentFt` to `LeanToResult`:

```ts
export interface LeanToResult {
  leanTo: LeanTo;
  groupPosition: [number, number, number];
  groupRotationY: number;
  /** Extent actually used along the wall, after clamping. */
  extentFt: number;
  meshes: LeanToMesh[];
}
```

In `buildLeanTo`, compute the attachment first and use the clamped extent, and gate the walls:

```ts
export function buildLeanTo(
  leanTo: LeanTo,
  parentBuilding: BuildingDimensions,
): LeanToResult {
  const { groupPosition, groupRotationY, extentFt } = computeAttachment(leanTo, parentBuilding);

  const projectionW = leanTo.widthFt;
  const extentL = extentFt;                 // clamped — never exceeds the wall
  const leanH = leanTo.heightFt;
  const parentH = parentBuilding.legHeightFt;

  const roofRise = parentH - leanH;
  const roofSlopeLen = Math.sqrt(roofRise * roofRise + projectionW * projectionW);
  const roofAngle = Math.atan2(roofRise, projectionW);

  const meshes: LeanToMesh[] = [];

  // Slab is always present.
  meshes.push({
    id: `${leanTo.id}-slab`, part: 'slab',
    position: [extentL / 2, -SLAB_THICKNESS / 2, projectionW / 2],
    size: [extentL + 0.5, SLAB_THICKNESS, projectionW + 0.5],
    color: '#b5b5ad',
  });

  // Walls only when explicitly enclosed. An "Open Lean" is a roof on posts.
  if (leanTo.walls === 'enclosed') {
    meshes.push({
      id: `${leanTo.id}-wall-outer`, part: 'wall-outer',
      position: [extentL / 2, leanH / 2, projectionW],
      size: [extentL, leanH, WALL_THICKNESS], color: leanTo.wallColor.hex,
    });
    meshes.push({
      id: `${leanTo.id}-wall-left`, part: 'wall-left',
      position: [0, leanH / 2, projectionW / 2],
      size: [WALL_THICKNESS, leanH, projectionW], color: leanTo.wallColor.hex,
    });
    meshes.push({
      id: `${leanTo.id}-wall-right`, part: 'wall-right',
      position: [extentL, leanH / 2, projectionW / 2],
      size: [WALL_THICKNESS, leanH, projectionW], color: leanTo.wallColor.hex,
    });
  }

  // Roof — always present. This is the whole point of a lean.
  meshes.push({
    id: `${leanTo.id}-roof`, part: 'roof',
    position: [extentL / 2, (parentH + leanH) / 2, projectionW / 2],
    size: [extentL + 0.5, WALL_THICKNESS, roofSlopeLen + 0.3],
    rotation: [roofAngle, 0, 0], color: leanTo.roofColor.hex,
  });

  return { leanTo, groupPosition, groupRotationY, extentFt, meshes };
}
```

- [ ] **Step 6: Update the default lean-to factory**

In `lib/building/defaultConfig.ts`, wherever a `LeanTo` is constructed by the UI helper, default `walls: 'open'`, `widthFt: 5`. If no factory exists, add one and export it:

```ts
export function createLeanTo(id: string, wall: WallId, parent: BuildingDimensions): LeanTo {
  return {
    id, wall,
    widthFt: 5,                                     // industry default projection
    lengthFt: wall === 'front' || wall === 'back' ? parent.widthFt : parent.lengthFt,
    heightFt: Math.max(6, parent.legHeightFt - 2),  // must sit below the main eave
    roofColor: findColor('white'),
    wallColor: findColor('white'),
    openings: [],
    walls: 'open',
  };
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all wallFrame and leanTo tests green.

- [ ] **Step 8: Verify visually**

Run: `npx next dev -p 3001`, open `http://localhost:3001/designer`, expand **Lean-Tos**, click **Left Side**.
Expected: a low open roof hanging off the left wall, no floating slab off the front end.

- [ ] **Step 9: Commit**

```bash
git add lib/building/leanTo.ts lib/building/types.ts lib/building/defaultConfig.ts lib/building/__tests__/leanTo.test.ts
git commit -m "fix: lean-to attaches to the correct wall and defaults to an open roof

left/right rotationY were swapped, so a left lean rendered collinear with the
building instead of hanging off its side. Attachment now derives from
wallFrame, extent clamps to the wall, and an open lean emits no walls."
```

---

## Task 3: Migrate openings and trim onto `wallFrame`

**Files:**
- Create: `lib/building/__tests__/pricing.golden.test.ts`
- Modify: `lib/building/openings.ts`, `lib/building/trim.ts`, `lib/building/geometry.ts:42-44`

**Interfaces:**
- Consumes: `wallFrame`, `pointOnWall`
- Produces: no signature changes; `wallLengthFt` is deleted and callers use `wallFrame(...).lengthFt`

- [ ] **Step 1: Write the pricing golden test first**

This locks the invariant that a geometry refactor must not move money. Create `lib/building/__tests__/pricing.golden.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createDefaultConfig, DEFAULT_PRICING_RULES } from '../defaultConfig';
import { calculatePrice } from '../../pricing/calculatePrice';

describe('pricing golden values', () => {
  it('default config price is stable across refactors', () => {
    const cfg = createDefaultConfig('test');
    const p = calculatePrice(cfg, DEFAULT_PRICING_RULES);
    expect(p.total).toBeCloseTo(13599.0, 0);
  });

  it('a lean-to carrying a roll-up is priced', () => {
    const cfg = createDefaultConfig('test');
    cfg.leanTos = [{
      id: 'lt1', wall: 'left', widthFt: 5, lengthFt: 30, heightFt: 8,
      roofColor: { id: 'white', hex: '#FFFFFF' },
      wallColor: { id: 'white', hex: '#FFFFFF' },
      walls: 'open',
      openings: [{ id: 'o1', type: 'rollup', widthFt: 10, heightFt: 10,
                   wall: 'front', positionFt: 0, color: null }],
    }];
    const p = calculatePrice(cfg, DEFAULT_PRICING_RULES);
    expect(p.leanToTotal).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it and record the actual baseline**

Run: `npm test -- pricing.golden`
If the first assertion fails, replace `13599.0` with the **actual** printed value and re-run. That number is now the baseline; it must not change in later steps.

- [ ] **Step 3: Replace `wallLengthFt` in `geometry.ts`**

Delete `wallLengthFt` (`lib/building/geometry.ts:42-44`) and update `openingFitsOnWall`:

```ts
import { wallFrame } from './wallFrame';

export function openingFitsOnWall(o: Opening, b: BuildingDimensions): boolean {
  const wLen = wallFrame(o.wall, b).lengthFt;
  return o.positionFt >= 0
    && o.positionFt + o.widthFt <= wLen
    && o.heightFt <= b.legHeightFt;
}
```

- [ ] **Step 4: Migrate `openings.ts` placement**

In `lib/building/openings.ts`, replace each hand-rolled per-wall position computation with:

```ts
import { wallFrame, pointOnWall } from './wallFrame';

const OPENING_PROUD_FT = 0.02;  // sit openings proud of the panel; kills z-fighting

const f = wallFrame(opening.wall, building);
const centre = pointOnWall(
  f,
  opening.positionFt + opening.widthFt / 2,
  opening.heightFt / 2,
  OPENING_PROUD_FT,
);
const rotationY = f.rotationY;
```

Delete any remaining `wall === 'front' || wall === 'back' ? widthFt : lengthFt` ternaries in this file.

- [ ] **Step 5: Migrate `trim.ts` placement**

In `lib/building/trim.ts`, place corner trim at the wall's `u = 0` and `u = lengthFt`, and eave trim along the top:

```ts
import { wallFrame, pointOnWall } from './wallFrame';

const TRIM_PROUD_FT = 0.03;  // must exceed OPENING_PROUD_FT so trim reads on top

const f = wallFrame(wall, building);
const eaveStart = pointOnWall(f, 0, f.eaveHeightFt, TRIM_PROUD_FT);
const eaveEnd   = pointOnWall(f, f.lengthFt, f.eaveHeightFt, TRIM_PROUD_FT);
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — including the golden pricing values, unchanged.

- [ ] **Step 7: Verify visually, then commit**

Run the dev server and confirm trim sits on wall edges rather than under the roof, and no red seam at the eave.

```bash
git add lib/building/openings.ts lib/building/trim.ts lib/building/geometry.ts lib/building/__tests__/pricing.golden.test.ts
git commit -m "refactor: openings and trim derive placement from wallFrame

Removes the last per-wall coordinate re-derivations. Trim now sits proud of
openings by a fixed ordering, which fixes the eave z-fighting seam."
```

---

## Task 4: Provision Neon and create the schema

**Files:**
- Create: `lib/db/index.ts`, `lib/db/schema.sql`, `scripts/migrate.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `getSql(): NeonQueryFunction` from `lib/db/index.ts`; tables `dealers` and `quotes`

- [ ] **Step 1: Provision Neon (operator step)**

```bash
vercel integration add neon --yes
vercel env pull .env.local --yes
```

This injects `DATABASE_URL`. If the CLI hands off to the dashboard, run `vercel integration open neon`, finish there, then re-run `vercel env pull`.
Verify without printing the value: `grep -c DATABASE_URL .env.local` → expect `1`.

- [ ] **Step 2: Install dependencies**

```bash
npm i @neondatabase/serverless
npm i -D tsx dotenv-cli
```

- [ ] **Step 3: Create the lazy client**

Create `lib/db/index.ts`:

```ts
// Lazy Neon client. neon() throws when DATABASE_URL is absent, and Next.js
// evaluates module top-level code at build time — so it must not run on import.
// Do NOT wrap this in a Proxy: libraries that introspect the client break.
import { neon } from '@neondatabase/serverless';

let _sql: ReturnType<typeof neon> | null = null;

export function getSql() {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    _sql = neon(url);
  }
  return _sql;
}
```

- [ ] **Step 4: Create the schema**

Create `lib/db/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS dealers (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  phone         TEXT,
  email         TEXT,
  website       TEXT,
  theme         JSONB NOT NULL DEFAULT '{}'::jsonb,
  pricing_rules JSONB NOT NULL,
  show_pricing  BOOLEAN NOT NULL DEFAULT true,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quotes (
  id          TEXT PRIMARY KEY,
  dealer_id   TEXT NOT NULL REFERENCES dealers(id),
  config      JSONB NOT NULL,
  pricing     JSONB,
  customer    JSONB NOT NULL,
  total_cents BIGINT,
  status      TEXT NOT NULL DEFAULT 'new',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quotes_dealer_created_idx
  ON quotes (dealer_id, created_at DESC);
```

- [ ] **Step 5: Create the migration runner**

Create `scripts/migrate.ts`:

```ts
import { readFileSync } from 'fs';
import path from 'path';
import { neon } from '@neondatabase/serverless';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const sql = neon(url);
  const ddl = readFileSync(path.join(process.cwd(), 'lib/db/schema.sql'), 'utf8');
  // Neon's HTTP driver runs one statement per call; split on the statement break.
  for (const stmt of ddl.split(';').map(s => s.trim()).filter(Boolean)) {
    await sql.query(stmt);
  }
  console.log('migration complete');
}

main().catch(e => { console.error(e); process.exit(1); });
```

Add to `package.json` scripts:

```json
"db:migrate": "dotenv -e .env.local -- tsx scripts/migrate.ts"
```

- [ ] **Step 6: Run the migration**

Run: `npm run db:migrate`
Expected: `migration complete`

- [ ] **Step 7: Verify the tables exist**

```bash
npx dotenv -e .env.local -- tsx -e "import {neon} from '@neondatabase/serverless'; const s=neon(process.env.DATABASE_URL); s\`select table_name from information_schema.tables where table_schema='public'\`.then(r=>console.log(r))"
```
Expected: rows for `dealers` and `quotes`.

- [ ] **Step 8: Commit**

```bash
git add lib/db/index.ts lib/db/schema.sql scripts/migrate.ts package.json package-lock.json
git commit -m "feat: add Neon Postgres client and schema for dealers and quotes"
```

---

## Task 5: Dealer repository, seed, and dealer resolution

**Files:**
- Create: `lib/db/dealers.ts`, `scripts/seed-dealer.ts`
- Modify: `lib/store/designerStore.ts:33,77` + `initialize`, `app/designer/page.tsx`

**Interfaces:**
- Consumes: `getSql()`
- Produces: `getDealer(id: string): Promise<DealerSettings | null>`; store action `initialize(dealerId: string, dealer?: DealerSettings | null)`

- [ ] **Step 1: Create the dealer repository**

Create `lib/db/dealers.ts`:

```ts
import { getSql } from './index';
import { STANDARD_COLORS } from '../building/defaultConfig';
import type { BuildingType, DealerSettings } from '../building/types';

const ALL_BUILDING_TYPES: BuildingType[] =
  ['carport', 'garage', 'barn', 'shop', 'warehouse', 'rv-cover'];

/**
 * Per-dealer colour palettes and building-type restrictions are a dealer-admin
 * feature and are not stored yet; every dealer gets the standard set.
 */
export async function getDealer(id: string): Promise<DealerSettings | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT id, name, phone, email, website, theme, pricing_rules, show_pricing
    FROM dealers WHERE id = ${id} AND active = true LIMIT 1
  ` as any[];
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    name: r.name,
    phone: r.phone ?? '',
    email: r.email ?? '',
    website: r.website ?? '',
    theme: r.theme ?? {},
    showPricing: r.show_pricing,
    colorPalette: STANDARD_COLORS,
    availableBuildingTypes: ALL_BUILDING_TYPES,
    pricing: r.pricing_rules,
  };
}
```

- [ ] **Step 2: Create the seed script**

Create `scripts/seed-dealer.ts`:

```ts
import { neon } from '@neondatabase/serverless';
import { DEFAULT_PRICING_RULES } from '../lib/building/defaultConfig';

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  // PLACEHOLDER PRICING. These are invented $/sqft figures, NOT TejasMex prices.
  // Replace before any quote is presented to a customer as a real price.
  const rules = { ...DEFAULT_PRICING_RULES, _placeholder: true };
  await sql`
    INSERT INTO dealers (id, name, phone, email, website, pricing_rules, show_pricing)
    VALUES ('tejasmex', 'TejasMex Metal Buildings', '', '', '',
            ${JSON.stringify(rules)}::jsonb, true)
    ON CONFLICT (id) DO UPDATE SET updated_at = now()
  `;
  console.log('seeded dealer: tejasmex');
}

main().catch(e => { console.error(e); process.exit(1); });
```

Add to `package.json` scripts:

```json
"db:seed": "dotenv -e .env.local -- tsx scripts/seed-dealer.ts"
```

- [ ] **Step 3: Run the seed**

Run: `npm run db:seed`
Expected: `seeded dealer: tejasmex`

- [ ] **Step 4: Accept dealer settings in the store**

In `lib/store/designerStore.ts`, change the `initialize` signature in the interface:

```ts
  initialize: (dealerId: string, dealer?: DealerSettings | null) => void;
```

and its implementation:

```ts
  initialize: (dealerId, dealer = null) => {
    const config = createDefaultConfig(dealerId);
    set({ dealerSettings: dealer, config: withPricing(config, dealer) });
  },
```

- [ ] **Step 5: Resolve the dealer server-side**

Rewrite `app/designer/page.tsx` as a server component that reads the query param and hands settings to the client:

```tsx
import dynamic from 'next/dynamic';
import { getDealer } from '@/lib/db/dealers';

const BuildingDesigner = dynamic(
  () => import('@/components/designer/BuildingDesigner'),
  { ssr: false },
);

export default async function DesignerPage({
  searchParams,
}: { searchParams: Promise<{ dealer?: string }> }) {
  const { dealer: slug } = await searchParams;
  const dealerId = (slug ?? 'tejasmex').toLowerCase();

  let dealer = null;
  try {
    dealer = await getDealer(dealerId);
  } catch (err) {
    console.error('[designer] dealer lookup failed', err);
  }
  if (!dealer) console.warn(`[designer] unknown dealer "${dealerId}", using defaults`);

  return <BuildingDesigner dealerId={dealerId} dealer={dealer} />;
}
```

In `components/designer/BuildingDesigner.tsx`, accept the props and pass them through to `initialize(dealerId, dealer)` wherever `initialize` is currently called.

- [ ] **Step 6: Verify**

Run the dev server, open `http://localhost:3001/designer?dealer=tejasmex`.
Expected: the designer renders and the estimate in the header is non-zero.
Open `?dealer=nonexistent`: expected to still render, with a console warning — never a blank screen.

- [ ] **Step 7: Commit**

```bash
git add lib/db/dealers.ts scripts/seed-dealer.ts lib/store/designerStore.ts app/designer/page.tsx components/designer/BuildingDesigner.tsx package.json
git commit -m "feat: resolve dealer from ?dealer= and use its pricing rules

dealerSettings was declared but never assigned, so DEFAULT_PRICING_RULES was
always used. Per-dealer pricing is now actually in effect."
```

---

## Task 6: Quote repository and API rewrite

**Files:**
- Create: `lib/db/quotes.ts`, `app/api/quote/__tests__/route.test.ts`
- Modify: `app/api/quote/route.ts` (full rewrite)

**Interfaces:**
- Consumes: `getSql()`, `getDealer()`, `calculatePrice`
- Produces: `insertQuote(q: NewQuote): Promise<string>`; `POST /api/quote` returning `{ quoteId }` on 201

- [ ] **Step 1: Create the quote repository**

Create `lib/db/quotes.ts`:

```ts
import { getSql } from './index';
import type { BuildingConfig, CustomerInfo, PricingResult } from '../building/types';

export interface NewQuote {
  id: string;
  dealerId: string;
  config: BuildingConfig;
  pricing: PricingResult;
  customer: CustomerInfo;
}

export async function insertQuote(q: NewQuote): Promise<string> {
  const sql = getSql();
  const totalCents = Math.round(q.pricing.total * 100);
  await sql`
    INSERT INTO quotes (id, dealer_id, config, pricing, customer, total_cents)
    VALUES (${q.id}, ${q.dealerId}, ${JSON.stringify(q.config)}::jsonb,
            ${JSON.stringify(q.pricing)}::jsonb,
            ${JSON.stringify(q.customer)}::jsonb, ${totalCents})
  `;
  return q.id;
}

export async function markNotifyFailed(id: string): Promise<void> {
  const sql = getSql();
  await sql`UPDATE quotes SET status = 'notify_failed' WHERE id = ${id}`;
}
```

- [ ] **Step 2: Write the failing API test**

Create `app/api/quote/__tests__/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertQuote = vi.fn(async () => 'qt_test');
const getDealer = vi.fn(async (id: string) =>
  id === 'tejasmex' ? { id, name: 'T', phone: '', email: '', website: '',
    theme: {}, showPricing: true, colorPalette: [], availableBuildingTypes: [],
    pricing: (await import('@/lib/building/defaultConfig')).DEFAULT_PRICING_RULES } : null);

vi.mock('@/lib/db/quotes', () => ({ insertQuote, markNotifyFailed: vi.fn() }));
vi.mock('@/lib/db/dealers', () => ({ getDealer }));
vi.mock('@/lib/notify', () => ({ notifyNewLead: vi.fn(async () => {}) }));

const { POST } = await import('../route');
const { createDefaultConfig } = await import('@/lib/building/defaultConfig');

const body = (over: any = {}) => ({
  ...createDefaultConfig('tejasmex'),
  customer: { firstName: 'A', lastName: 'B', email: 'a@b.com', phone: '5551234567',
              zipCode: '75001', timeline: 'asap', notes: '' },
  ...over,
});
const req = (b: any) => new Request('http://x/api/quote', {
  method: 'POST', body: JSON.stringify(b), headers: { 'Content-Type': 'application/json' },
});

beforeEach(() => { insertQuote.mockClear(); });

describe('POST /api/quote', () => {
  it('returns 201 and a quoteId on success', async () => {
    const res = await POST(req(body()) as any);
    expect(res.status).toBe(201);
    expect((await res.json()).quoteId).toBeTruthy();
    expect(insertQuote).toHaveBeenCalledOnce();
  });

  it('returns 400 and writes nothing when customer fields are missing', async () => {
    const res = await POST(req(body({ customer: { firstName: '', email: '', phone: '' } })) as any);
    expect(res.status).toBe(400);
    expect((await res.json()).fields).toContain('firstName');
    expect(insertQuote).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown dealer', async () => {
    const res = await POST(req(body({ dealerId: 'nope' })) as any);
    expect(res.status).toBe(404);
    expect(insertQuote).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- route`
Expected: FAIL — current route returns 200 and writes to the filesystem.

- [ ] **Step 4: Rewrite the route**

Replace `app/api/quote/route.ts` entirely:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getDealer } from '@/lib/db/dealers';
import { insertQuote, markNotifyFailed } from '@/lib/db/quotes';
import { notifyNewLead } from '@/lib/notify';
import { calculatePrice } from '@/lib/pricing/calculatePrice';

const REQUIRED = ['firstName', 'email', 'phone'] as const;

function quoteId(): string {
  return `qt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
  }

  const customer = body?.customer;
  const missing = REQUIRED.filter(f => !customer?.[f]?.toString().trim());
  if (missing.length > 0) {
    return NextResponse.json(
      { error: 'Missing required customer fields', fields: missing },
      { status: 400 },
    );
  }
  if (!body?.building || !body?.colors) {
    return NextResponse.json({ error: 'Malformed configuration' }, { status: 400 });
  }

  // The dealer is resolved server-side; a forged client dealerId is rejected.
  const dealer = await getDealer(String(body.dealerId ?? '').toLowerCase());
  if (!dealer) {
    return NextResponse.json({ error: 'Unknown dealer' }, { status: 404 });
  }

  // Never trust the client's total — recompute from the persisted config.
  const pricing = calculatePrice(body, dealer.pricing);
  const id = quoteId();

  try {
    await insertQuote({ id, dealerId: dealer.id, config: body, pricing, customer });
  } catch (err) {
    console.error('[quote] insert failed', err);
    return NextResponse.json({ error: 'Could not save your request. Please try again.' },
                             { status: 503 });
  }

  // The row is committed and the customer will be told it succeeded. A failed
  // notification must never turn that into an error response.
  try {
    await notifyNewLead(dealer, { id, pricing, customer, config: body });
  } catch (err) {
    console.error('[quote] notification failed', err);
    await markNotifyFailed(id).catch(() => {});
  }

  return NextResponse.json({ quoteId: id }, { status: 201 });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- route`
Expected: PASS, 3 tests

- [ ] **Step 6: Commit**

```bash
git add app/api/quote/route.ts lib/db/quotes.ts app/api/quote/__tests__/route.test.ts
git commit -m "feat: persist quotes to Postgres with correct status codes

Replaces a .quotes/ filesystem write that cannot work on Vercel's read-only
runtime. Pricing is recomputed server-side rather than trusting the client."
```

---

## Task 7: Honest submit result in the store

**Files:**
- Modify: `lib/store/designerStore.ts` (interface + `submitQuote`)
- Create: `lib/store/__tests__/submitQuote.test.ts`

**Interfaces:**
- Produces: `type SubmitResult = { ok: true; quoteId: string } | { ok: false; error: string }`; `submitQuote(customer: CustomerInfo): Promise<SubmitResult>`; store fields `isSubmitting: boolean`, `submitError: string | null`

- [ ] **Step 1: Write the failing test**

Create `lib/store/__tests__/submitQuote.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useDesignerStore } from '../designerStore';

const customer = { firstName: 'A', lastName: 'B', email: 'a@b.com',
  phone: '5551234567', zipCode: '75001', timeline: 'asap' as const, notes: '' };

beforeEach(() => {
  useDesignerStore.getState().initialize('tejasmex');
  useDesignerStore.setState({ isQuoteFormOpen: true, submitError: null });
});

describe('submitQuote', () => {
  it('returns ok and closes the form on 201', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ quoteId: 'qt_1' }), { status: 201 })));
    const r = await useDesignerStore.getState().submitQuote(customer);
    expect(r).toEqual({ ok: true, quoteId: 'qt_1' });
    expect(useDesignerStore.getState().isQuoteFormOpen).toBe(false);
  });

  // The bug: any failure previously fell through to the success path.
  it('reports failure and KEEPS the form open on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'Unknown dealer' }), { status: 404 })));
    const r = await useDesignerStore.getState().submitQuote(customer);
    expect(r.ok).toBe(false);
    expect(useDesignerStore.getState().isQuoteFormOpen).toBe(true);
    expect(useDesignerStore.getState().submitError).toBe('Unknown dealer');
  });

  it('reports failure on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const r = await useDesignerStore.getState().submitQuote(customer);
    expect(r.ok).toBe(false);
    expect(useDesignerStore.getState().isQuoteFormOpen).toBe(true);
    expect(useDesignerStore.getState().submitError).toMatch(/network/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- submitQuote`
Expected: FAIL — `submitQuote` resolves `undefined` and closes the form regardless.

- [ ] **Step 3: Add the result type and state fields**

In `lib/store/designerStore.ts`, above the store interface:

```ts
export type SubmitResult =
  | { ok: true; quoteId: string }
  | { ok: false; error: string };
```

In `interface DesignerStore`, add fields and change the action signature:

```ts
  isSubmitting: boolean;
  submitError: string | null;
  submitQuote: (customer: CustomerInfo) => Promise<SubmitResult>;
```

In the initial state (near `isQuoteFormOpen: false`):

```ts
  isSubmitting: false,
  submitError: null,
```

- [ ] **Step 4: Rewrite `submitQuote`**

Replace the `submitQuote` implementation (`lib/store/designerStore.ts:279-301`):

```ts
  submitQuote: async (customer) => {
    const { config } = get();
    if (!config) return { ok: false, error: 'No configuration' };

    set({ isSubmitting: true, submitError: null });
    const payload = { ...config, customer, updatedAt: new Date().toISOString() };

    try {
      const res = await fetch('/api/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const b = await res.json().catch(() => ({} as any));
        const error = b.error ?? 'Submission failed. Please try again.';
        set({ isSubmitting: false, submitError: error });
        return { ok: false, error };
      }

      const { quoteId } = await res.json();
      set({
        config: { ...payload, quoteId },
        isQuoteFormOpen: false,
        isSubmitting: false,
      });
      return { ok: true, quoteId };
    } catch {
      const error = 'Network error — please check your connection and try again.';
      set({ isSubmitting: false, submitError: error });
      return { ok: false, error };
    }
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- submitQuote`
Expected: PASS, 3 tests

- [ ] **Step 6: Commit**

```bash
git add lib/store/designerStore.ts lib/store/__tests__/submitQuote.test.ts
git commit -m "fix: submitQuote reports failure instead of silently succeeding

res.ok was never checked and errors were swallowed, so failed submissions
still reached the success path. Leads were lost with no signal."
```

---

## Task 8: Modal shows success only on success

**Files:**
- Modify: `components/designer/BuildingDesigner.tsx:791-798` (handler) and the success branch

- [ ] **Step 1: Fix the submit handler**

Replace `handleSubmit` (`components/designer/BuildingDesigner.tsx:791-798`):

```tsx
  const [failure, setFailure] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    if (!validate()) return;
    setSubmitting(true);
    setFailure(null);
    const result = await submitQuote(form);
    setSubmitting(false);
    if (result.ok) {
      setSubmitted(true);          // success screen ONLY on a real success
    } else {
      setFailure(result.error);
    }
  }, [validate, submitQuote, form]);
```

- [ ] **Step 2: Render the failure**

Immediately above the form's submit button, add:

```tsx
  {failure && (
    <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
      <p className="text-sm font-medium text-red-800">Could not submit your request</p>
      <p className="mt-1 text-sm text-red-700">{failure}</p>
      <p className="mt-2 text-xs text-red-600">
        Your design is safe. Call us at {dealerPhone || 'the number above'} if this keeps happening.
      </p>
    </div>
  )}
```

Read `dealerPhone` from the store: `const dealerPhone = useDesignerStore((s) => s.dealerSettings?.phone ?? '');`

- [ ] **Step 3: Verify by forcing a failure**

Run the dev server. In DevTools, set the Network tab to **Offline**, then submit the quote form.
Expected: a red error panel, the form stays open, and **no** "Quote Submitted!" screen.
Set Network back to Online and submit again. Expected: the success screen.

- [ ] **Step 4: Commit**

```bash
git add components/designer/BuildingDesigner.tsx
git commit -m "fix: quote modal shows the success screen only on a real success

handleSubmit called setSubmitted(true) unconditionally after awaiting
submitQuote, so customers saw confirmation for submissions that failed."
```

---

## Task 9: Email notification via Resend

**Files:**
- Create: `lib/notify/email.ts`, `lib/notify/index.ts`

**Interfaces:**
- Produces: `sendLeadEmail(dealer, lead): Promise<void>`; `notifyNewLead(dealer, lead): Promise<void>`; `interface Lead { id: string; pricing: PricingResult; customer: CustomerInfo; config: BuildingConfig }`

- [ ] **Step 1: Provision Resend (operator step)**

```bash
vercel integration add resend/resend-email --yes
vercel env pull .env.local --yes
npm i resend
```

If it hands off to the dashboard, run `vercel integration open resend/resend-email`, finish there, then re-run `vercel env pull`.
Set the sender and recipient defaults (values are yours, do not echo them):

```bash
vercel env add LEAD_FROM_EMAIL
```

- [ ] **Step 2: Create the email sender**

Create `lib/notify/email.ts`:

```ts
import { Resend } from 'resend';
import type { Lead } from './index';
import type { DealerSettings } from '../building/types';

export async function sendLeadEmail(dealer: DealerSettings, lead: Lead): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.LEAD_FROM_EMAIL;
  if (!key || !from || !dealer.email) {
    console.warn('[notify] email not configured; skipping');
    return;
  }

  const b = lead.config.building;
  const c = lead.customer;
  const resend = new Resend(key);

  await resend.emails.send({
    from,
    to: dealer.email,
    replyTo: c.email,
    subject: `New lead: ${c.firstName} ${c.lastName} — ${b.widthFt}x${b.lengthFt} ${b.type}`,
    text: [
      `New quote request (${lead.id})`,
      ``,
      `Customer:  ${c.firstName} ${c.lastName}`,
      `Phone:     ${c.phone}`,
      `Email:     ${c.email}`,
      `Zip:       ${c.zipCode}`,
      `Timeline:  ${c.timeline}`,
      c.notes ? `Notes:     ${c.notes}` : '',
      ``,
      `Building:  ${b.widthFt}' x ${b.lengthFt}' x ${b.legHeightFt}' ${b.type}`,
      `Roof:      ${b.roofStyle} ${b.roofPitch}`,
      `Openings:  ${lead.config.openings.length}`,
      `Lean-tos:  ${lead.config.leanTos.length}`,
      ``,
      `Estimate:  $${lead.pricing.total.toLocaleString()}`,
    ].filter(Boolean).join('\n'),
  });
}
```

- [ ] **Step 3: Create the orchestrator**

Create `lib/notify/index.ts`:

```ts
import type { BuildingConfig, CustomerInfo, DealerSettings, PricingResult } from '../building/types';
import { sendLeadEmail } from './email';
import { sendLeadSms } from './sms';

export interface Lead {
  id: string;
  pricing: PricingResult;
  customer: CustomerInfo;
  config: BuildingConfig;
}

/**
 * Fire both channels. Each is isolated: one provider being down must not
 * suppress the other, and neither may throw past this boundary in a way that
 * fails a request whose quote row is already committed.
 */
export async function notifyNewLead(dealer: DealerSettings, lead: Lead): Promise<void> {
  const results = await Promise.allSettled([
    sendLeadSms(dealer, lead),
    sendLeadEmail(dealer, lead),
  ]);

  const failed = results.filter(r => r.status === 'rejected');
  for (const f of failed) console.error('[notify] channel failed', (f as PromiseRejectedResult).reason);
  if (failed.length === results.length) throw new Error('all notification channels failed');
}
```

- [ ] **Step 4: Verify**

With the dev server running, submit a quote through the UI.
Expected: an email arrives at the dealer address; the API still returns 201.

- [ ] **Step 5: Commit**

```bash
git add lib/notify/ package.json package-lock.json
git commit -m "feat: email the dealer when a lead arrives (Resend)"
```

---

## Task 10: SMS notification via Telnyx

**Files:**
- Create: `lib/notify/sms.ts`, `lib/notify/__tests__/sms.test.ts`

**Interfaces:**
- Produces: `sendLeadSms(dealer: DealerSettings, lead: Lead): Promise<void>`; `buildSmsBody(lead: Lead): string`

**Prerequisite — already satisfied.** The Telnyx account, API key, and sending
number are provisioned and verified against the live API (`GET /v2/phone_numbers`
returned 200 with three active numbers). `TELNYX_API_KEY` and
`TELNYX_FROM_NUMBER=+18665120244` are already present in `.env.local`.

No npm dependency is required — Telnyx is called over plain REST.

Before production deploy, push the credentials to Vercel:

```bash
vercel env add TELNYX_API_KEY
vercel env add TELNYX_FROM_NUMBER
```

**Note:** the sending number must have a messaging profile attached or Telnyx
rejects the send. `+18665120244` has profile `40019b00-71ff-4656-9447-aca370088402`.

- [ ] **Step 1: Write the failing test for the message body**

Create `lib/notify/__tests__/sms.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildSmsBody } from '../sms';

const lead = {
  id: 'qt_1',
  pricing: { total: 13599 } as any,
  customer: { firstName: 'John', lastName: 'Smith', phone: '5551234567' } as any,
  config: { building: { widthFt: 24, lengthFt: 30, type: 'garage' } } as any,
};

describe('buildSmsBody', () => {
  it('fits in a single SMS segment', () => {
    expect(buildSmsBody(lead as any).length).toBeLessThanOrEqual(160);
  });

  it('carries name, size, price and callback number', () => {
    const b = buildSmsBody(lead as any);
    expect(b).toContain('John Smith');
    expect(b).toContain('24x30');
    expect(b).toContain('13,599');
    expect(b).toContain('5551234567');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- sms`
Expected: FAIL — `Cannot find module '../sms'`

- [ ] **Step 3: Implement the SMS sender**

Create `lib/notify/sms.ts`:

```ts
import type { Lead } from './index';
import type { DealerSettings } from '../building/types';

const TELNYX_MESSAGES_URL = 'https://api.telnyx.com/v2/messages';

/**
 * Kept under 160 chars so it never splits into multiple billed segments.
 * The em dash is a single GSM-7 character; avoid emoji, which force UCS-2
 * and halve the segment limit to 70.
 */
export function buildSmsBody(lead: Lead): string {
  const b = lead.config.building;
  const c = lead.customer;
  return `New lead: ${c.firstName} ${c.lastName} — ${b.widthFt}x${b.lengthFt} ${b.type}, ` +
         `$${lead.pricing.total.toLocaleString()}. ${c.phone}`;
}

export async function sendLeadSms(dealer: DealerSettings, lead: Lead): Promise<void> {
  const key = process.env.TELNYX_API_KEY;
  const from = process.env.TELNYX_FROM_NUMBER;
  if (!key || !from || !dealer.phone) {
    console.warn('[notify] sms not configured; skipping');
    return;
  }

  const res = await fetch(TELNYX_MESSAGES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: dealer.phone, text: buildSmsBody(lead) }),
  });

  if (!res.ok) {
    // Read the body for the reason, but never let the key reach a log line.
    const detail = await res.text().catch(() => '');
    throw new Error(`Telnyx send failed: ${res.status} ${detail.slice(0, 200)}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- sms`
Expected: PASS, 2 tests

- [ ] **Step 5: Set the dealer's phone and verify end to end**

```bash
npx dotenv -e .env.local -- tsx -e "import {neon} from '@neondatabase/serverless'; const s=neon(process.env.DATABASE_URL); s\`update dealers set phone='+15555550100' where id='tejasmex'\`.then(()=>console.log('ok'))"
```

Submit a quote through the UI. Expected: a text arrives within seconds, and the API still returns 201.

- [ ] **Step 6: Run the whole suite and commit**

Run: `npm test`
Expected: all tests PASS.

```bash
git add lib/notify/sms.ts lib/notify/__tests__/sms.test.ts
git commit -m "feat: text the dealer when a lead arrives (Telnyx)"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1.1 silent submit failure | 7, 8 |
| §1.2 filesystem write | 6 |
| §1.3 no dealer pricing | 5 |
| §1.4 lean-to attachment | 2 |
| §1.5 lean-to is a box | 2 |
| §2 Neon storage + lazy client | 4 |
| §2.1 schema | 4 |
| §3.1 quote API contract | 6 |
| §3.2 submitQuote | 7 |
| §3.3 dealer resolution | 5 |
| §3.4 notifications | 9, 10 |
| §4 wallFrame | 1 |
| §4.1 lean-to changes | 2 |
| §4.2 aframe NOT renamed | Global Constraints |
| §5 testing | 1, 2, 3, 6, 7, 10 |

No spec requirement is unimplemented.

**Known deviations from the spec, deliberate:**
- `dealers` has no `color_palette` / `available_building_types` columns. `DealerSettings` needs both, so `getDealer` fills them with `STANDARD_COLORS` and all building types. Per-dealer overrides are a dealer-admin feature (spec §7 item 1); adding columns now would be unused schema.
- Spec §5 case 4 (openings within wall bounds) is covered by `openingFitsOnWall` in Task 3 rather than a dedicated new test file.

**Open risks carried into execution:**
- Telnyx credentials are verified and in place, so Task 10 has no external blocker. `sendLeadSms` still no-ops safely when env vars are absent, so Tasks 1-9 run independently.
- The seeded `tejasmex` pricing is placeholder data, flagged `_placeholder: true`. **No quote may be presented as a real TejasMex price until spec §6.1 is resolved.**
