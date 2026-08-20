# Steel Sync — Lead Path Repair + `wallFrame`

**Design Specification**
Date: 2026-08-19
Repo: `C:\Users\13183\steel_sync`
Status: awaiting review

---

## 0. What this project does and does not unblock

The business goal is a dealer-priced quote automation system. This project is the
**minimum** work that makes that goal reachable, plus the one geometry fix that
stops the 3D view rendering nonsense.

It **unblocks**: real per-dealer pricing, durable leads, and a correct lean-to.

It does **not** deliver: the section model, roof-profile fidelity, studio
rendering, image export, PDF quotes, email, or Facebook Messenger. Those are
separate projects, listed in §7.

This ordering is deliberate. An earlier draft sequenced a full section-model
restructure ahead of the quote path. Adversarial review found the renderer work
was being done *instead of* the goal rather than toward it, while quote
submissions were failing silently in production. That finding is accepted; this
spec is the re-scope.

---

## 1. Confirmed defects this project fixes

All verified by reading the code, not inferred.

### 1.1 Quote submissions fail silently — leads are lost

`lib/store/designerStore.ts:287-299`

```ts
try {
  const res = await fetch('/api/quote', { ... });
  const data = await res.json();
  if (data.quoteId) { quoteConfig.quoteId = data.quoteId; }
} catch {
  // Offline/error — still save locally so user doesn't lose work
}
set({ config: quoteConfig, isQuoteFormOpen: false });
```

Three faults compound:

1. `res.ok` is never checked — a 400 or 500 falls through to the success path.
2. The `catch` block saves nothing, despite its comment claiming otherwise.
3. Control reaches `set(...)` identically on success and failure, so the UI
   reports "Quote Submitted!" either way.

### 1.2 The persistence target cannot work in production

`app/api/quote/route.ts:26-31` writes to `path.join(process.cwd(), '.quotes')`.
Vercel's runtime filesystem is read-only. Every production submission throws, and
§1.1 swallows the throw.

### 1.3 There is no dealer pricing

`dealerSettings` is declared (`designerStore.ts:33`), initialized to `null`
(`:77`), and never assigned — every reference is a read. `withPricing(config, null)`
always falls back to `DEFAULT_PRICING_RULES`, the placeholder $8.50/sqft figures
in `lib/building/defaultConfig.ts:147`.

### 1.4 Lean-tos render detached from the building

`lib/building/leanTo.ts:127-164`. Verified numerically against a 24x30 footprint:

| wall  | extent runs  | projects | result |
|-------|--------------|----------|--------|
| left  | Z `0 -> -30` | `+X`     | lands off the front end, collinear with the building |
| right | Z `30 -> 60` | `-X`     | lands off the back end, collinear with the building |
| front | X `30 -> 0`  | `-Z`     | direction correct; 30 ft extent on a 24 ft wall |
| back  | X `0 -> 30`  | `+Z`     | direction correct; same 6 ft overhang |

Two faults: `left` and `right` rotations are swapped (`left` needs `-PI/2`,
`right` needs `+PI/2`), and the extent is never clamped to the attached wall.

### 1.5 A lean-to is modelled as a box, not a roof

`leanTo.ts:66-91` unconditionally emits an outer wall and two end walls. The
reference product defaults a lean to **Open Lean** — a shed roof on posts, no
walls — at `5' x 25' x 5'` on a 24x25x9 building. Our default is a fully enclosed
12 ft box.

---

## 2. Storage

**DECISION: Neon Postgres**, provisioned through the Vercel Marketplace
(`vercel integration add neon`), which injects `DATABASE_URL` automatically.

Rejected alternatives:

- **Supabase** — better long-term fit (row-level security maps exactly onto
  "dealer X sees only their leads", auth included). Deferred because dealer
  logins are out of scope here. Migrating later is a Postgres dump/restore; more
  likely we keep Neon and add a separate auth provider.
- **Prisma Postgres** — same auth gap, extra ORM dependency for two tables.

Lazy client initialization is required, because `neon()` throws when
`DATABASE_URL` is absent and Next.js evaluates module top-level code at build time:

```ts
// lib/db/index.ts
import { neon } from '@neondatabase/serverless';

let _sql: ReturnType<typeof neon> | null = null;
export function getSql() {
  if (!_sql) _sql = neon(process.env.DATABASE_URL!);
  return _sql;
}
```

Do **not** wrap the client in a `Proxy` — it breaks libraries that introspect the
client object.

### 2.1 Schema

```sql
CREATE TABLE dealers (
  id            TEXT PRIMARY KEY,          -- URL slug, e.g. 'tejasmex'
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

CREATE TABLE quotes (
  id          TEXT PRIMARY KEY,            -- 'qt_<nanoid>'
  dealer_id   TEXT NOT NULL REFERENCES dealers(id),
  config      JSONB NOT NULL,              -- full BuildingConfig at submit time
  pricing     JSONB,                       -- PricingResult snapshot
  customer    JSONB NOT NULL,
  total_cents BIGINT,
  status      TEXT NOT NULL DEFAULT 'new',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX quotes_dealer_created_idx ON quotes (dealer_id, created_at DESC);
```

`pricing_rules` is `jsonb` rather than normalized columns because
`DealerPricingRules` (`types.ts:222-238`) is a nested structure with open-ended
maps. It is read whole and written whole; there are no per-field queries.

`total_cents` is an integer in cents so reporting never inherits float drift from
`PricingResult`'s floating-point dollars.

---

## 3. Lead path repair

### 3.1 `POST /api/quote`

| Case | Status | Body |
|------|--------|------|
| Success | 201 | `{ quoteId }` |
| Missing/invalid customer fields | 400 | `{ error, fields: string[] }` |
| Unknown or inactive `dealerId` | 404 | `{ error }` |
| Database failure | 503 | `{ error }` |

Server-side rules:

- Validate `firstName`, `email`, `phone`, plus a shape check on `config`.
- **Recompute pricing server-side** via `calculatePrice(config, dealerRules)` and
  persist that — never the client's number. The client total is a display value.
- Never return raw database errors to the client.

### 3.2 `submitQuote`

Returns a result instead of always succeeding. Store gains `isSubmitting` and
`submitError`. The modal renders the error and stays open on failure; **the
success screen renders only on `ok: true`.**

```ts
submitQuote: async (customer) => {
  const { config } = get();
  if (!config) return { ok: false, error: 'No configuration' };
  set({ isSubmitting: true, submitError: null });
  try {
    const res = await fetch('/api/quote', { /* ... */ });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      set({ isSubmitting: false, submitError: body.error ?? 'Submission failed' });
      return { ok: false, error: body.error };
    }
    const { quoteId } = await res.json();
    set({
      config: { ...config, customer, quoteId },
      isQuoteFormOpen: false,
      isSubmitting: false,
    });
    return { ok: true, quoteId };
  } catch {
    set({ isSubmitting: false, submitError: 'Network error — please try again.' });
    return { ok: false, error: 'network' };
  }
}
```

### 3.3 Dealer resolution

`?dealer=<slug>` -> server component reads the `dealers` row -> passes
`DealerSettings` into the store on mount -> `withPricing` uses real rules.

- Unknown slug falls back to the default dealer and logs. Never blank-screen.
- `dealerId` is validated server-side on submit; a forged client value is rejected.

Seed one `tejasmex` row whose `pricing_rules` initially carries the existing
`DEFAULT_PRICING_RULES` values as a **clearly-labelled placeholder** (§6.1).

### 3.4 Lead notification

**DECISION: Telnyx SMS + Resend email**, both fired after the `quotes` row commits.

| Channel | Provider | Provisioning | Carries |
|---------|----------|--------------|---------|
| SMS | Telnyx | Manual — not on the Marketplace. Account and number already provisioned by the owner. `TELNYX_API_KEY`, `TELNYX_FROM_NUMBER` | Instant ping: name, size, price, phone |
| Email | Resend | `vercel integration add resend/resend-email` (auto env vars) | Full quote detail, reply-to the customer |

Telnyx is called over plain REST (`POST https://api.telnyx.com/v2/messages`,
Bearer auth) rather than through the `telnyx` npm SDK. The request is three
fields; a dependency buys nothing and the SDK is substantially heavier.

Sending number: `+18665120244`, active with messaging profile
`40019b00-71ff-4656-9447-aca370088402`. A Telnyx number **must** have a
messaging profile attached or sends fail.

Rules:

- **Notification failure must never fail the request.** The row is already
  committed; the customer has already been told it succeeded. Wrap both sends and
  log failures — never let a Telnyx outage produce a 503 on a lead that was saved.
- Recipients come from the `dealers` row (`phone`, `email`), not from config, so
  each dealer is notified on their own channels.
- SMS body stays under 160 chars: `New lead: {first} {last} — {W}x{L} {type}, ${total}. {phone}`
- Email `reply-to` is the customer's address so the dealer can respond directly.
- Both sends are fire-and-forget relative to the HTTP response. If a send throws,
  record it on the quote row (`status = 'notify_failed'`) so nothing is lost
  silently — the failure mode this whole project exists to eliminate.

Deferred: retry/queue for failed notifications, and per-dealer channel
preferences. A logged failure plus a visible status is sufficient at this volume.

---

## 4. `wallFrame`

New module `lib/building/wallFrame.ts` — single source of truth for wall position
and orientation.

```ts
export interface WallFrame {
  wall: WallId;
  origin: Vec3;        // world position of the wall's u=0 bottom corner
  along: Vec3;         // unit vector in the direction positionFt increases
  normal: Vec3;        // unit outward normal, away from the interior
  lengthFt: number;    // wall extent along `along`
  eaveHeightFt: number;
  isGable: boolean;    // front/back carry a triangular top
  rotationY: number;   // Y-rotation placing a local +X mesh onto this wall
}

export function wallFrame(wall: WallId, b: BuildingDimensions): WallFrame;
export function pointOnWall(f: WallFrame, uFt: number, vFt: number, outFt?: number): Vec3;
```

Convention locked by this module (origin at the front-left ground corner):

| wall  | normal     | along      | rotationY |
|-------|------------|------------|-----------|
| front | `(0,0,-1)` | `(-1,0,0)` | `PI`      |
| back  | `(0,0,1)`  | `(1,0,0)`  | `0`       |
| left  | `(-1,0,0)` | `(0,0,1)`  | `-PI/2`   |
| right | `(1,0,0)`  | `(0,0,-1)` | `PI/2`    |

Consumers migrate to it: `openings.ts`, `trim.ts`, `leanTo.ts`. The
`wall === 'front' || wall === 'back' ? widthFt : lengthFt` ternary in
`geometry.ts:42-44` is absorbed into `WallFrame.lengthFt`.

### 4.1 Lean-to changes

1. Attachment uses `wallFrame(leanTo.wall, building)`; `groupRotationY` comes from
   `frame.rotationY`, so left and right cannot disagree.
2. Extent clamps: `extentL = Math.min(leanTo.lengthFt, frame.lengthFt)`, centred
   at `(frame.lengthFt - extentL) / 2`.
3. `LeanTo` gains `walls: 'open' | 'enclosed'`, defaulting to `'open'`. Open emits
   roof and support posts only.
4. Defaults become projection `5 ft`, length = parent wall length, leg height
   below the main eave.
5. The unused `ridgeRiseFt` import is either used for gable clearance or removed.

### 4.2 Explicitly NOT changed

**`RoofStyle` keeps the member `'aframe'`.** Renaming it to `'boxedEave'` would
silently corrupt pricing: `roofStyleModifiers` is keyed by `RoofStyle`
(`types.ts:231`) and read as `rules.roofStyleModifiers[building.roofStyle] ?? 0`
(`calculatePrice.ts:41`), so a dealer table authored with the old key resolves to
`0` — roughly $540-$1,080 lost on a 24x30, with no error. A display-label map may
show "Boxed Eave" in the UI; the persisted value stays `'aframe'`.

---

## 5. Testing

Vitest is added; the repo has no test runner today.

```
npm i -D vitest
"scripts": { "test": "vitest run", "test:watch": "vitest" }
```

`wallFrame` and the geometry builders are pure functions — none of this needs WebGL.

Required cases:

1. **Wall frame table** — all four walls produce the `normal` / `along` /
   `rotationY` above. Assert `normal` and `along` are unit length and
   perpendicular, and pin handedness as `cross(normal, along) === (0,1,0)` for
   **every** wall. Verified by hand for all four:

   | wall  | `cross(normal, along)` |
   |-------|------------------------|
   | front | `(0,0,-1) x (-1,0,0) = (0,1,0)` |
   | back  | `(0,0,1) x (1,0,0)  = (0,1,0)` |
   | left  | `(-1,0,0) x (0,0,1) = (0,1,0)` |
   | right | `(1,0,0) x (0,0,-1) = (0,1,0)` |

   The arithmetic is written out so a future "fix" cannot flip a basis vector and
   reintroduce mirroring. Note the operand order: `cross(normal, along)`, not the
   reverse, which yields `(0,-1,0)`.
2. **Lean attachment** — for each wall, the lean's outer edge lies on the outward
   side of its wall and within the expected bounding volume. This fails today and
   is the regression guard.
3. **Extent clamping** — a 30 ft lean on a 24 ft wall yields 24 ft, centred.
4. **Openings** — placement stays within wall bounds; `openingFitsOnWall` agrees
   with the generated geometry.
5. **Pricing golden values** — `calculatePrice` on the default config, and on a
   config with one lean carrying a roll-up, asserted before and after the
   `wallFrame` migration. Geometry refactors must not move prices.
6. **Quote API** — success writes a row and returns 201; invalid customer returns
   400 and writes nothing; unknown dealer returns 404. Store test: a non-ok
   response leaves `isQuoteFormOpen` true and sets `submitError`.

---

## 6. Open questions

### 6.1 Real TejasMex prices — and a structural finding

The public configurator shows no prices anonymously; pricing is visible only to a
logged-in dealer. Reading the owner's authenticated session established that
**pricing is computed entirely client-side** (no API call) and revealed the model:

```
Base Price: 24'x25'                        $3,158.00
Engineer Certified: 140 MPH - 35 PSF         $315.00
Leg Height: 9'                               $287.00
                                    Total  $3,760.00
Deposit 18% ($676.80) / balance on delivery
```

From their debug helpers:

```json
"center-section": { "baseSizeLabel": "24x26", "actualWidth": 24,
  "actualLength": 25, "actualRoofLength": 26,
  "priceAdjustmentExpression": "N/A" }
"Section width: 24 (12-24-wide)"
```

Four consequences for the pricing project:

1. **Base price is a size-lookup table, not a rate.** `DealerPricingRules.basePricePerSqft`
   is the wrong shape and must become a bracket table.
2. **The lookup key uses roof length, not building length** — a 24x25 building
   prices as `24x26`. Getting this wrong shifts every quote by one bracket.
3. **Widths are grouped into bands** (`12-24-wide`), so brackets are coarse.
4. **Options are flat line items**, not multipliers. Roof style Vertical vs
   Regular measured at **$587** on a 24x25.

A deposit split (18% / balance) is also unmodelled.

`getFullVendorData()` returns HTTP 403 from their S3 bucket, so bulk extraction is
unavailable. The table must be reconstructed by probing configurations, or taken
from the manufacturer's price sheet. **Until then, no quote should be presented as
matching TejasMex pricing.**

### 6.2 Other open items

- **Dealer notification.** Resolved — see §3.4 (Telnyx SMS + Resend email). Note
  the reference product routes leads into HubSpot; a CRM integration is not in
  scope here but is the natural successor.
- **Telnyx account.** Resolved — account, API key, and number `+18665120244` are
  provisioned and verified against the live API. Credentials live in `.env.local`
  (gitignored) and must also be added to Vercel via `vercel env add` before
  production deploy.
- **Rate limiting.** `POST /api/quote` is unauthenticated and writes to a database.
  Needs at least IP-based limiting before public traffic.
- **Pricing float drift.** `PricingResult` uses floating-point dollars. Not changed
  here; flagged for the pricing project.

---

## 7. Follow-on projects, in order

1. **Dealer pricing + admin** — bracket-table pricing rules per §6.1, an admin UI
   to enter them, and dealer assignment. The stated business goal.
2. **Quote automation** — PDF generation, dealer notification, lead dashboard.
3. **Section model restructure** — center section + lean sections, per-wall
   enclosure, legs. Research complete; their own code calls it `center-section`.
4. **Render fidelity** — roof profiles (rounded eave, fascia, ridge cap), studio
   environment, material accuracy, colour fidelity, image export.
5. **Facebook Messenger quoting** — depends on 1 and 2.
