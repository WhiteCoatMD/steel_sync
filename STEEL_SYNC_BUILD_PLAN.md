# STEEL SYNC — Metal Building Configurator SaaS
## Complete Reverse-Engineering Report & Build Plan

**Date:** 2026-03-16
**Author:** CTO Build Plan — Clean-Room Analysis
**Target Reference:** IdeaRoom 3D Configurator (via design.tejasmex.com)
**Project Codename:** Steel Sync

> **Disclaimer:** This document is a clean-room functional analysis. No proprietary code, assets, or branding were copied. All architecture decisions are original. Assumptions are explicitly labeled.

---

## 1. PRODUCT TEARDOWN

### 1.1 What It Is
The reference product (IdeaRoom) is a white-labeled 3D metal building configurator embedded on dealer websites. Dealers like Tejas Metal Buildings / Columbia embed it as their primary sales tool. Customers configure buildings visually, get real-time pricing, and submit quote requests — all without talking to a salesperson.

### 1.2 Likely User Flow

```
Landing (dealer-branded page)
  → Select Building Type (carport, garage, barn, shop, etc.)
    → Set Base Dimensions (width × length × leg height)
      → Choose Roof Style (regular, A-frame/boxed eave, vertical)
        → Configure Colors (roof, walls, trim)
          → Add Openings (doors, windows, garage doors)
            → Add Options (lean-tos, insulation, anchors, concrete)
              → Review 3D Preview + Price Summary
                → Submit Lead / Request Quote
                  → [Optional] Save Design / Share Link
                    → Dealer receives lead in admin dashboard
```

### 1.3 Major UI Sections

| Section | Location | Purpose |
|---------|----------|---------|
| **Building Type Selector** | Initial screen or top nav | Choose category (carport, garage, barn, etc.) |
| **Configuration Panel** | Left sidebar (desktop) / bottom sheet (mobile) | Step-by-step option controls |
| **3D Viewer** | Center canvas (dominant) | Real-time Three.js/WebGL rendering |
| **Price Summary** | Right sidebar or floating card | Running total, line items |
| **CTA Bar** | Bottom or floating | "Get Quote", "Save Design", "Share" |
| **Dealer Branding** | Header/logo area | Dealer logo, colors, phone number |

### 1.4 Likely Configuration Options

**Structural:**
- Building type/category
- Width (12–60 ft, typically in 2-ft increments)
- Length (20–100+ ft, in 5-ft increments)
- Leg height / eave height (6–16 ft)
- Roof style: Regular, A-Frame (Boxed Eave), Vertical
- Roof pitch (assumption: fixed per roof style, e.g., 3:12, 4:12)

**Panels & Colors:**
- Roof color (15–20 standard metal colors)
- Wall color (same palette)
- Trim/border color
- Wainscot option (two-tone walls)
- Panel direction (horizontal vs vertical for walls)

**Openings:**
- Walk-in doors (3×7 standard)
- Roll-up/garage doors (8×8, 10×10, 12×12, etc.)
- Windows (3×3, 3×4)
- Frame-outs for customer-supplied doors
- Placement: wall selection + position along wall

**Additions:**
- Lean-tos (one or both sides, with independent dimensions)
- Gable extensions / overhangs
- End-wall extensions

**Site & Install:**
- Anchoring (ground, concrete, asphalt)
- Insulation (roof, walls, both)
- Concrete slab (include or exclude)
- Installation (included, optional, DIY)
- Delivery distance / zone

**Certifications:**
- Wind rating / speed (locality-dependent)
- Snow load
- Engineering certification
- Permit package

### 1.5 Dealer-Specific Customization Points

- **Branding:** Logo, company name, phone, colors, favicon
- **Pricing:** Per-dealer markup tables, regional base pricing
- **Product Catalog:** Which building types/sizes to offer
- **Color Palette:** Manufacturer-specific color options
- **Territory:** Delivery zones and pricing by zip code
- **Lead Routing:** Which email/CRM receives the leads
- **Embed Config:** Domain whitelist, iframe parameters

### 1.6 Lead Capture / Quote Flow

**[Assumption]** The tool uses a "value-first" lead capture strategy:
1. Customer configures freely (no login wall)
2. Price is shown in real-time (or "starting from $X")
3. At "Get Quote" → lead form appears (name, email, phone, zip, timeline)
4. Optional: gate exact pricing behind lead capture
5. Confirmation screen with design summary + "a dealer will contact you"
6. Dealer receives email + dashboard notification with full config + contact info

### 1.7 Save/Share Flow

- **Save:** Generates a unique URL with encoded config (or DB-stored design ID)
- **Share:** Copyable link, possibly email/SMS share
- **[Assumption]** No user account required — designs are ephemeral unless saved

### 1.8 Pricing Display Strategy

- Real-time price updates as config changes (strongest UX)
- Some dealers may hide pricing and use "Request Quote" only
- Per-dealer toggle: show price vs. hide price
- Price breakdown likely shows: base building + add-ons + delivery + install + tax

### 1.9 What Makes It Useful for Dealers

1. **24/7 sales tool** — customers self-serve outside business hours
2. **Pre-qualified leads** — customers who configure + submit are high-intent
3. **Reduced phone time** — config is already built when dealer calls back
4. **Visual selling** — 3D is more compelling than spec sheets
5. **Pricing accuracy** — eliminates manual quoting errors
6. **Mobile traffic** — 50%+ of traffic is mobile; configurators capture this
7. **Embed anywhere** — works on dealer's existing website

---

## 2. FEATURE INVENTORY

### 2.1 Customer-Facing Designer

| Feature | Phase | Notes |
|---------|-------|-------|
| Building type selection | MVP | Carport, garage, barn, shop |
| Width/length/height controls | MVP | Slider + numeric input |
| Roof style selection | MVP | Regular, A-frame, vertical |
| Color picker (roof, walls, trim) | MVP | Manufacturer color palette |
| 3D real-time preview | MVP | Three.js WebGL |
| Door placement | MVP | Walk-in, roll-up |
| Window placement | MVP | Standard sizes |
| Price summary | MVP | Running total |
| Quote request form | MVP | Lead capture |
| Lean-to configuration | V2 | Side lean-tos with independent dims |
| Insulation options | V2 | Roof/wall/both |
| Anchor/concrete options | V2 | Ground, concrete, asphalt |
| Save design (shareable link) | V2 | Persistent URL |
| Mobile-optimized layout | V2 | Bottom sheet controls |
| AR preview | V3 | Place building on camera feed |
| Interior view | V3 | Walk-through camera |
| VR support | V3 | WebXR |
| Comparison mode | V3 | Side-by-side configs |

### 2.2 Dealer Admin Dashboard

| Feature | Phase |
|---------|-------|
| Lead inbox (new quotes) | MVP |
| Quote detail view (config + contact) | MVP |
| Pricing table management | MVP |
| Dealer branding settings | MVP |
| Lead status tracking | V2 |
| Follow-up automation triggers | V2 |
| Sales analytics dashboard | V2 |
| Multi-user team access | V2 |
| Territory/zip code management | V3 |
| Inventory/template library | V3 |
| Commission tracking | V3 |

### 2.3 Pricing Engine

| Feature | Phase |
|---------|-------|
| Base price by dimensions | MVP |
| Roof style modifiers | MVP |
| Height modifiers | MVP |
| Door/window add-on pricing | MVP |
| Dealer markup percentage | MVP |
| Per-dealer price overrides | V2 |
| Delivery zone pricing | V2 |
| Install pricing | V2 |
| Promotional discounts | V2 |
| Tax calculation | V2 |
| Historical price tracking | V3 |
| Dynamic pricing (supply-based) | V3 |

### 2.4 Rendering Engine

| Feature | Phase |
|---------|-------|
| Parametric frame geometry | MVP |
| Roof panel generation | MVP |
| Wall panel generation | MVP |
| Color/material application | MVP |
| Orbit camera controls | MVP |
| Door/window cutouts | MVP |
| Lean-to geometry | V2 |
| Shadows and ground plane | V2 |
| Environment lighting (HDR) | V2 |
| Screenshot/thumbnail generation | V2 |
| LOD / performance optimization | V2 |
| Texture-mapped metal panels | V3 |
| Interior rendering | V3 |
| AR mode | V3 |

### 2.5 Lead Capture / CRM

| Feature | Phase |
|---------|-------|
| Quote submission form | MVP |
| Email notification to dealer | MVP |
| Lead list in admin | MVP |
| Lead detail with config | MVP |
| Status pipeline (new → contacted → sold/lost) | V2 |
| Email follow-up sequences | V2 |
| SMS notifications | V2 |
| CRM webhooks (HubSpot, Salesforce) | V2 |
| Quote PDF generation | V2 |
| Automated drip campaigns | V3 |
| Lead scoring | V3 |

### 2.6 Embeddable Widget / Dealer Website Integration

| Feature | Phase |
|---------|-------|
| Iframe embed code | MVP |
| Dealer URL parameter (?dealer=X) | MVP |
| Custom subdomain support | V2 |
| Custom domain CNAME | V2 |
| Embed script tag (lighter than iframe) | V2 |
| WordPress plugin | V3 |
| Shopify integration | V3 |

### 2.7 AI Assistant Features

| Feature | Phase |
|---------|-------|
| Prompt-to-config generation | V2 |
| Missing-field clarification chat | V2 |
| "Similar buildings" recommendations | V3 |
| Natural language config editing | V3 |
| Auto-optimization (cheapest config for needs) | V3 |

---

## 3. PARAMETRIC DATA MODEL

### 3.1 TypeScript Interfaces

See `/lib/building/types.ts` for full TypeScript definitions.

### 3.2 Full Example JSON

```json
{
  "id": "bld_a1b2c3d4",
  "dealerId": "dealer_columbia",
  "quoteId": "qt_2026_0316_001",
  "version": 1,
  "createdAt": "2026-03-16T14:30:00Z",
  "updatedAt": "2026-03-16T15:45:00Z",
  "building": {
    "type": "garage",
    "widthFt": 30,
    "lengthFt": 40,
    "legHeightFt": 10,
    "roofStyle": "vertical",
    "roofPitch": "4:12",
    "orientation": "length-facing-front",
    "panelDirection": {
      "walls": "horizontal",
      "roof": "vertical"
    }
  },
  "colors": {
    "roof": { "id": "barn-red", "hex": "#7B2D26" },
    "walls": { "id": "pewter-gray", "hex": "#8A8D8F" },
    "trim": { "id": "white", "hex": "#FFFFFF" },
    "wainscot": null
  },
  "openings": [
    {
      "id": "door_1",
      "type": "rollup",
      "widthFt": 10,
      "heightFt": 10,
      "wall": "front",
      "positionFt": 10,
      "color": { "id": "white", "hex": "#FFFFFF" }
    },
    {
      "id": "door_2",
      "type": "rollup",
      "widthFt": 10,
      "heightFt": 10,
      "wall": "front",
      "positionFt": 22,
      "color": { "id": "white", "hex": "#FFFFFF" }
    },
    {
      "id": "door_3",
      "type": "walkin",
      "widthFt": 3,
      "heightFt": 7,
      "wall": "left",
      "positionFt": 5,
      "color": { "id": "white", "hex": "#FFFFFF" }
    },
    {
      "id": "win_1",
      "type": "window",
      "widthFt": 3,
      "heightFt": 3,
      "wall": "right",
      "positionFt": 15,
      "color": null
    }
  ],
  "leanTos": [
    {
      "id": "lean_1",
      "wall": "left",
      "widthFt": 10,
      "lengthFt": 40,
      "heightFt": 8,
      "roofColor": { "id": "barn-red", "hex": "#7B2D26" },
      "wallColor": { "id": "pewter-gray", "hex": "#8A8D8F" },
      "openings": []
    }
  ],
  "options": {
    "insulation": { "roof": true, "walls": false },
    "anchoring": "concrete",
    "concrete": { "included": false, "thicknessIn": null },
    "installation": "included",
    "overhangs": { "front": 0, "back": 0, "left": 0, "right": 0 }
  },
  "certifications": {
    "windSpeedMph": 150,
    "snowLoadPsf": 30,
    "engineered": true
  },
  "delivery": {
    "zipCode": "75201",
    "distanceMiles": null,
    "zone": null
  },
  "customer": {
    "firstName": "John",
    "lastName": "Smith",
    "email": "john@example.com",
    "phone": "555-123-4567",
    "zipCode": "75201",
    "timeline": "1-3 months",
    "notes": "Need for workshop, want electricity-ready"
  },
  "pricing": {
    "basePrice": 12500,
    "roofStyleUpcharge": 1200,
    "heightUpcharge": 800,
    "openingsTotal": 2400,
    "leanToTotal": 3200,
    "optionsTotal": 950,
    "certificationUpcharge": 500,
    "subtotal": 21550,
    "deliveryFee": 450,
    "installationFee": 3200,
    "dealerMarkup": 0,
    "discount": 0,
    "taxRate": 0.0825,
    "tax": 1777.88,
    "total": 26977.88,
    "currency": "USD"
  }
}
```

### 3.3 Validation Rules

| Rule | Description |
|------|-------------|
| Width range | 12–60 ft (2-ft increments) |
| Length range | 20–100 ft (5-ft increments) |
| Leg height range | 6–16 ft (1-ft increments) |
| Opening fit | Opening position + width must be ≤ wall length; height ≤ leg height |
| Opening overlap | No two openings on the same wall can overlap (min 3 ft gap) |
| Lean-to height | Must be < main building leg height |
| Lean-to length | Must be ≤ main building length |
| Lean-to width | Typically ≤ 12 ft |
| Color required | Roof and wall colors required; trim defaults to white |
| Roof pitch | Fixed per roof style (regular=2:12, A-frame=3:12, vertical=4:12) |

### 3.4 Mutually Exclusive Options

- **Roof style ↔ Panel direction:** Regular/A-frame roofs → horizontal roof panels. Vertical roof → vertical panels only.
- **Concrete ↔ Anchoring:** If concrete included, anchoring must be "concrete". If not, can be "ground" or "asphalt".
- **Lean-to ↔ Width constraint:** Adding lean-tos may limit minimum main building width.
- **Wind rating ↔ Geography:** High wind ratings may mandate vertical roof and specific anchoring.

---

## 4. RENDERING ARCHITECTURE

### 4.1 Technology Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Framework | Next.js 15 (App Router) | SSR for SEO, API routes, edge functions |
| UI | React 19 + Tailwind CSS 4 | Component model + utility-first styling |
| 3D | Three.js + @react-three/fiber + @react-three/drei | Declarative 3D in React |
| State | Zustand | Lightweight, works great with R3F |
| Database | Supabase (Postgres + Auth + Storage) | Full backend, real-time, row-level security |
| Hosting | Vercel | Natural fit for Next.js |

### 4.2 Folder Structure

```
steel-sync/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                          # Marketing landing
│   ├── designer/
│   │   └── page.tsx                      # Main configurator page
│   ├── admin/
│   │   ├── layout.tsx
│   │   ├── page.tsx                      # Dashboard
│   │   ├── leads/page.tsx
│   │   ├── pricing/page.tsx
│   │   └── settings/page.tsx
│   ├── api/
│   │   ├── quote/route.ts               # Submit quote
│   │   ├── pricing/route.ts             # Get dealer pricing
│   │   ├── ai/generate/route.ts         # AI config generation
│   │   └── webhook/route.ts             # Outbound webhooks
│   └── embed/
│       └── [dealerId]/page.tsx           # Embeddable configurator
├── components/
│   ├── designer/
│   │   ├── BuildingDesigner.tsx          # Main orchestrator
│   │   ├── ConfigPanel.tsx              # Left sidebar controls
│   │   ├── ThreeScene.tsx               # 3D canvas wrapper
│   │   ├── PriceSummary.tsx             # Price display
│   │   ├── QuoteForm.tsx                # Lead capture modal
│   │   └── controls/
│   │       ├── DimensionControls.tsx
│   │       ├── RoofControls.tsx
│   │       ├── ColorControls.tsx
│   │       ├── OpeningControls.tsx
│   │       ├── LeanToControls.tsx
│   │       └── OptionsControls.tsx
│   ├── three/
│   │   ├── BuildingModel.tsx            # Root 3D component
│   │   ├── Frame.tsx                    # Steel frame geometry
│   │   ├── RoofPanels.tsx              # Roof surface
│   │   ├── WallPanels.tsx              # Wall surfaces with cutouts
│   │   ├── TrimPieces.tsx              # Edge trim
│   │   ├── Door.tsx                     # Door geometry
│   │   ├── Window.tsx                   # Window geometry
│   │   ├── LeanTo.tsx                   # Lean-to sub-building
│   │   ├── GroundPlane.tsx             # Ground + shadow
│   │   └── CameraRig.tsx              # Camera controls
│   ├── admin/
│   │   └── ...
│   └── ui/
│       └── ... (shared Tailwind components)
├── lib/
│   ├── building/
│   │   ├── types.ts                     # All TypeScript interfaces
│   │   ├── defaultConfig.ts             # Default building state
│   │   ├── validation.ts                # Config validation
│   │   └── constants.ts                 # Color palettes, size ranges
│   ├── pricing/
│   │   ├── calculatePrice.ts            # Core pricing function
│   │   └── types.ts                     # Pricing rule types
│   ├── ai/
│   │   ├── configFromPrompt.ts          # AI prompt → config
│   │   └── prompts.ts                   # System prompts
│   └── store/
│       └── designerStore.ts             # Zustand store
├── supabase/
│   └── migrations/
│       ├── 001_dealers.sql
│       ├── 002_designs.sql
│       ├── 003_pricing_rules.sql
│       ├── 004_leads.sql
│       └── 005_dealer_settings.sql
└── public/
    └── textures/
        └── metal-panel-normal.jpg
```

### 4.3 Scene Graph Breakdown

```
<Canvas>
  <CameraRig />            ← OrbitControls, auto-framing
  <ambientLight />
  <directionalLight />     ← Cast shadows
  <BuildingModel>
    <Frame />              ← Steel tube frame (legs, rafters, purlins)
    <RoofPanels />         ← Generated quad geometry, colored material
    <WallPanels>           ← One mesh per wall face
      <Door />             ← CSG cutout + door mesh inset
      <Window />           ← CSG cutout + glass mesh inset
    </WallPanels>
    <TrimPieces />         ← Edge extrusions
    <LeanTo />             ← Recursive mini-building
  </BuildingModel>
  <GroundPlane />          ← Shadow receiver, grid helper
</Canvas>
```

### 4.4 Geometry Strategy: Generated Geometry (Not GLTF)

**Recommendation: 100% procedural geometry for MVP.**

Why:
- Building dimensions are fully parametric — prebuilt models don't scale
- Geometry is simple (boxes, planes, extrusions) — no organic shapes
- Color changes = material swap, not model swap
- Faster iteration, smaller bundle, no asset pipeline

How:
- **Frame:** `THREE.TubeGeometry` or `THREE.BoxGeometry` for each member
- **Roof:** `THREE.BufferGeometry` with computed vertices based on pitch + width
- **Walls:** `THREE.PlaneGeometry` with CSG boolean subtraction for openings (use `three-bvh-csg` or simpler: build wall as multiple planes around openings)
- **Trim:** Thin `THREE.BoxGeometry` along edges
- **Doors/Windows:** `THREE.BoxGeometry` inset into wall cutouts

**V2 upgrade path:** Add normal-mapped metal panel textures for realism.

### 4.5 Opening Placement on Walls

```
Wall = full rectangular plane
For each opening on this wall:
  1. Sort openings by positionFt (left to right)
  2. Build wall segments between/around openings
  3. Each segment is its own PlaneGeometry
  4. Opening gets its own mesh (door/window) inset slightly from wall plane

Example: 40ft wall with a 10ft door at position 15ft
  → Segment 1: 0–15ft (left of door)
  → Opening: 15–25ft (door mesh)
  → Segment 2: 25–40ft (right of door)
```

This avoids CSG entirely and is much more performant.

### 4.6 Camera Controls

- Use `@react-three/drei`'s `<OrbitControls>` with:
  - `enablePan={true}`
  - `maxPolarAngle={Math.PI / 2}` (prevent going underground)
  - `minDistance` / `maxDistance` based on building size
- Auto-frame on dimension change: compute bounding box, animate camera to fit
- Preset views: Front, Back, Left, Right, Top, Isometric (buttons in UI)

### 4.7 Geometry Updates on Dimension Change

- Zustand store holds `BuildingConfig`
- React Three Fiber components read from store via `useDesignerStore()`
- When width/length/height changes, components re-render with new geometry
- Key: **don't recreate geometry objects** — update `position`, `scale`, and vertex attributes
- Use `useMemo` to cache geometry, recompute only when relevant dimensions change

### 4.8 Performance

- **Target:** 60fps on mid-range mobile, <2s initial load
- **Techniques:**
  - Merge static geometries with `THREE.BufferGeometryUtils.mergeGeometries()`
  - Use instanced meshes for repeated elements (purlins, girts)
  - Single material per color (shared across all same-colored parts)
  - Limit shadow map resolution (1024×1024)
  - Use `<AdaptiveDpr>` from drei for mobile
  - Lazy-load Three.js (dynamic import, code-split the 3D scene)

### 4.9 React Component Tree

```
<BuildingDesigner>
  ├── <ConfigPanel>
  │   ├── <DimensionControls />
  │   ├── <RoofControls />
  │   ├── <ColorControls />
  │   ├── <OpeningControls />
  │   ├── <LeanToControls />
  │   └── <OptionsControls />
  ├── <ThreeScene>
  │   └── <Canvas>
  │       └── <BuildingModel />
  ├── <PriceSummary />
  └── <QuoteForm />       ← Modal, triggered by CTA
```

### 4.10 State Management (Zustand)

```typescript
interface DesignerStore {
  config: BuildingConfig;
  pricing: PricingResult | null;
  dealerSettings: DealerSettings | null;
  activeStep: ConfigStep;
  isQuoteFormOpen: boolean;

  // Actions
  updateBuilding: (partial: Partial<BuildingDimensions>) => void;
  setRoofStyle: (style: RoofStyle) => void;
  setColor: (target: ColorTarget, color: ColorOption) => void;
  addOpening: (opening: Opening) => void;
  updateOpening: (id: string, partial: Partial<Opening>) => void;
  removeOpening: (id: string) => void;
  addLeanTo: (leanTo: LeanTo) => void;
  removeLeanTo: (id: string) => void;
  recalculatePrice: () => void;
  submitQuote: (customer: CustomerInfo) => Promise<void>;
}
```

### 4.11 Pricing Calculation Hooks

```typescript
// In the store, after any config change:
updateBuilding: (partial) => {
  set((state) => {
    const newConfig = { ...state.config, building: { ...state.config.building, ...partial } };
    const pricing = calculatePrice(newConfig, state.dealerSettings?.pricing);
    return { config: newConfig, pricing };
  });
}
```

Price recalculation is synchronous and runs on every config change (~1ms, no debounce needed).

### 4.12 Mobile Usability

- **Layout:** Single column — 3D viewer on top (60vh), config panel below as scrollable sheet
- **Touch:** OrbitControls supports touch natively (pinch zoom, two-finger rotate)
- **Config panel:** Collapsible accordion sections, large touch targets (44px min)
- **Price:** Sticky bottom bar with total + "Get Quote" CTA
- **Performance:** `<AdaptiveDpr>` drops resolution on low-end devices; consider 2D fallback rendering for very old devices

---

## 5. PRICING ENGINE DESIGN

### 5.1 Database Tables

```sql
-- Manufacturer-level default pricing
CREATE TABLE pricing_defaults (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manufacturer_id UUID REFERENCES manufacturers(id),
  effective_date DATE NOT NULL,
  base_price_per_sqft DECIMAL(10,2) NOT NULL,          -- e.g., $8.50/sqft
  roof_style_modifiers JSONB NOT NULL,                   -- { "regular": 0, "aframe": 0.75, "vertical": 1.50 }
  height_modifier_per_ft DECIMAL(10,2) NOT NULL,         -- per ft above 8ft base
  opening_prices JSONB NOT NULL,                         -- { "walkin_3x7": 350, "rollup_10x10": 850, ... }
  lean_to_price_per_sqft DECIMAL(10,2) NOT NULL,
  insulation_per_sqft JSONB NOT NULL,                    -- { "roof": 1.25, "walls": 1.00 }
  anchoring_prices JSONB NOT NULL,                       -- { "ground": 0, "concrete": 2.50, "asphalt": 3.00 }
  install_price_per_sqft DECIMAL(10,2),
  certification_prices JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Dealer-specific overrides (sparse — only overridden fields populated)
CREATE TABLE dealer_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id UUID REFERENCES dealers(id),
  effective_date DATE NOT NULL,
  markup_percent DECIMAL(5,2) DEFAULT 0,                 -- e.g., 15% on top of mfr pricing
  base_price_override_per_sqft DECIMAL(10,2),            -- NULL = use default
  roof_style_overrides JSONB,
  height_modifier_override DECIMAL(10,2),
  opening_price_overrides JSONB,
  lean_to_override_per_sqft DECIMAL(10,2),
  delivery_zones JSONB,                                  -- [{ "maxMiles": 50, "fee": 0 }, { "maxMiles": 100, "fee": 450 }]
  install_override_per_sqft DECIMAL(10,2),
  tax_rate DECIMAL(5,4),                                 -- e.g., 0.0825
  promotional_discounts JSONB,                           -- [{ "code": "SPRING2026", "percent": 10, "expires": "2026-04-01" }]
  show_pricing BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(dealer_id, effective_date)
);

-- Delivery zones (normalized)
CREATE TABLE delivery_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id UUID REFERENCES dealers(id),
  zip_prefix VARCHAR(5) NOT NULL,
  zone_name VARCHAR(50),
  delivery_fee DECIMAL(10,2) NOT NULL,
  install_available BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 5.2 Pricing Rule Examples

| Rule | Formula | Example |
|------|---------|---------|
| Base price | width × length × base_per_sqft | 30 × 40 × $8.50 = $10,200 |
| Roof upgrade | width × length × roof_modifier | 30 × 40 × $1.50 (vertical) = $1,800 |
| Height charge | (legHeight - 8) × length × 2 × height_per_ft | (10 - 8) × 40 × 2 × $3.00 = $480 |
| Roll-up door | flat fee per size | 10×10 = $850 each |
| Walk-in door | flat fee | 3×7 = $350 each |
| Window | flat fee | 3×3 = $175 each |
| Lean-to | lean_width × lean_length × lean_per_sqft | 10 × 40 × $6.00 = $2,400 |
| Insulation (roof) | width × length × insul_roof_per_sqft | 30 × 40 × $1.25 = $1,500 |
| Delivery | zone-based flat fee | Zone 2 (50–100mi) = $450 |
| Installation | width × length × install_per_sqft | 30 × 40 × $2.50 = $3,000 |
| Dealer markup | subtotal × markup_percent | $18,930 × 15% = $2,839.50 |
| Tax | (subtotal + markup) × tax_rate | $21,769.50 × 8.25% = $1,795.98 |

### 5.3 Pseudo-Code

See `/lib/pricing/calculatePrice.ts` for full implementation.

### 5.4 Dealer-Specific Overrides Strategy

```
For each pricing field:
  1. Check dealer_pricing for dealer-specific override
  2. If NULL → fall back to pricing_defaults for manufacturer
  3. After computing subtotal → apply dealer markup_percent
  4. After markup → apply promotional discount if valid
  5. After discount → apply tax_rate
```

This lets manufacturers set baseline pricing while dealers control their margins.

---

## 6. UX / UI BLUEPRINT

### 6.1 Desktop Layout (≥1024px)

```
┌─────────────────────────────────────────────────────────────┐
│  [Logo]  DEALER NAME              [Phone] [Save] [Share]    │
├──────────────┬──────────────────────────┬───────────────────┤
│              │                          │                   │
│  CONFIG      │     3D VIEWER            │  PRICE SUMMARY    │
│  PANEL       │                          │                   │
│  (280px)     │     (flex-1)             │  (300px)          │
│              │                          │                   │
│  ┌────────┐  │  ┌──────────────────┐    │  Base: $10,200    │
│  │ SIZE   │  │  │                  │    │  Roof: +$1,800    │
│  ├────────┤  │  │   Three.js       │    │  Doors: +$2,050   │
│  │ ROOF   │  │  │   Canvas         │    │  Lean-to: +$2,400 │
│  ├────────┤  │  │                  │    │  Install: +$3,000 │
│  │ COLORS │  │  │                  │    │  ─────────────    │
│  ├────────┤  │  └──────────────────┘    │  Total: $21,245   │
│  │ DOORS  │  │  [Front][Back][L][R][Top] │                   │
│  ├────────┤  │  (camera preset buttons)  │  ┌─────────────┐ │
│  │ ADD-ONS│  │                          │  │ GET QUOTE   │ │
│  └────────┘  │                          │  └─────────────┘ │
│              │                          │                   │
├──────────────┴──────────────────────────┴───────────────────┤
│  © Dealer Name  |  Powered by Steel Sync                    │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 Mobile Layout (<768px)

```
┌──────────────────────────┐
│ [Logo] DEALER   [≡ Menu] │
├──────────────────────────┤
│                          │
│     3D VIEWER            │
│     (60vh, touch orbit)  │
│                          │
│  [Front][Back][L][R]     │
├──────────────────────────┤
│  ▼ Size                  │
│  ▼ Roof Style            │
│  ▼ Colors                │
│  ▼ Doors & Windows       │
│  ▼ Add-ons               │
│  (accordion, scrollable) │
├──────────────────────────┤
│ [$21,245]  [GET QUOTE ➜] │  ← sticky bottom bar
└──────────────────────────┘
```

### 6.3 Lead Form (Modal)

Triggered by "Get Quote" CTA. Appears as modal overlay.

```
┌──────────────────────────────┐
│     Request Your Quote       │
│                              │
│  First Name: [____________]  │
│  Last Name:  [____________]  │
│  Email:      [____________]  │
│  Phone:      [____________]  │
│  Zip Code:   [____________]  │
│  Timeline:   [▼ dropdown  ]  │
│  Notes:      [____________]  │
│              [____________]  │
│                              │
│  Your Design Summary:        │
│  30×40 Vertical Roof Garage  │
│  2 Roll-up Doors, 1 Lean-to │
│  Est. Total: $21,245         │
│                              │
│  [Submit Quote Request]      │
│                              │
│  🔒 Your info is only shared │
│     with [Dealer Name]       │
└──────────────────────────────┘
```

### 6.4 Trust-Building Elements

- Dealer logo and name prominently displayed
- Phone number always visible
- "Your info is only shared with [Dealer Name]" on lead form
- BBB/review badges if dealer provides them
- "Certified [Manufacturer] dealer" badge
- SSL lock icon near forms
- "No obligation quote" language

### 6.5 Lead Form Timing

- **Never gate the configurator** — let users explore freely
- Show price in real-time (if dealer enables it)
- Trigger lead form only on "Get Quote" / "Request Quote" click
- Optional: soft prompt after 2+ minutes of engagement ("Want to save your design?")

---

## 7. EMBED / WHITE-LABEL STRATEGY

### 7.1 Multi-Tenant Architecture

```
┌─────────────────────────────────────────┐
│            Steel Sync Platform           │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐  │
│  │ Dealer A │ │ Dealer B │ │ Dealer C │  │
│  │ Config   │ │ Config   │ │ Config   │  │
│  │ Pricing  │ │ Pricing  │ │ Pricing  │  │
│  │ Branding │ │ Branding │ │ Branding │  │
│  │ Leads    │ │ Leads    │ │ Leads    │  │
│  └─────────┘ └─────────┘ └─────────┘  │
│                                         │
│  Shared: 3D Engine, UI, AI, Infra      │
│  Isolated: Data, Pricing, Branding     │
└─────────────────────────────────────────┘
```

**Database isolation:** Row-level security in Supabase. Every table has `dealer_id`. RLS policies ensure dealers only see their own data.

### 7.2 Dealer Onboarding Flow

1. Admin creates dealer account → generates `dealer_id`
2. Upload logo, set brand colors, configure pricing
3. System generates embed code: `<iframe src="https://app.steelsync.com/embed/{dealerId}" />`
4. Dealer pastes embed on their website
5. Alternatively: CNAME `design.dealersite.com` → `app.steelsync.com`

### 7.3 Embed Options

**Option A: Iframe (MVP)**
```html
<iframe
  src="https://app.steelsync.com/embed/dealer_columbia?theme=light"
  width="100%"
  height="800"
  frameborder="0"
  allow="autoplay; xr-spatial-tracking"
></iframe>
```

**Option B: Script Tag (V2)**
```html
<div id="steel-sync-designer" data-dealer="dealer_columbia"></div>
<script src="https://cdn.steelsync.com/embed.js"></script>
```

**Option C: Custom Domain (V2)**
- Dealer sets CNAME: `design.dealerdomain.com` → `custom.steelsync.com`
- Vercel handles SSL via automatic certificate provisioning
- Middleware reads hostname → resolves dealer → applies branding

### 7.4 Theme Settings (per dealer)

```typescript
interface DealerTheme {
  logoUrl: string;
  primaryColor: string;       // Buttons, accents
  secondaryColor: string;     // Hover, secondary actions
  backgroundColor: string;    // Page background
  headerStyle: 'dark' | 'light';
  fontFamily?: string;        // Optional Google Font
  showPoweredBy: boolean;     // "Powered by Steel Sync" footer
  customCss?: string;         // Advanced: raw CSS overrides
}
```

### 7.5 Webhook / API for Dealer CRMs

```
POST https://api.steelsync.com/webhooks/v1/quote.submitted
Headers: X-Dealer-ID, X-Signature (HMAC)
Body: { quote, customer, config, pricing }

Supported events:
  - quote.submitted
  - quote.updated
  - design.saved
  - lead.created
```

Integration targets: HubSpot, Salesforce, Zapier, custom endpoints.

---

## 8. AI GENERATOR

### 8.1 System Design

```
User Prompt → Claude API → Structured JSON → Validation → Config State
     ↓                                            ↓
  "30x40 shop                               Fill missing
   with 2 rollups"                           with defaults
     ↓                                            ↓
  Clarification ← ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─   Return config
  (if critical fields missing)
```

### 8.2 Prompt Design

See `/lib/ai/configFromPrompt.ts` for full implementation.

**System prompt strategy:**
1. Define the JSON schema the AI must output
2. Provide the valid ranges and enumerations for every field
3. Instruct the AI to fill missing fields with sensible defaults
4. Instruct the AI to flag clearly invalid requests

### 8.3 Clarification Strategy

**Auto-default (don't ask):**
- Roof pitch (derive from roof style)
- Panel direction (derive from roof style)
- Colors (default: white roof, gray walls, white trim)
- Anchoring (default: ground)
- Insulation (default: none)

**Clarify if ambiguous:**
- Building type unclear (is "building" a garage? shop? barn?)
- Dimensions missing entirely
- Door type ambiguous ("door" → walk-in or roll-up?)

**Reject if invalid:**
- Width > 60ft or < 12ft
- Doors that won't fit on the specified wall
- Contradictory requirements

### 8.4 Sample Inputs and Outputs

**Input:** "I want a 30x40 vertical roof shop with two roll-up doors and a 10-foot lean-to"

**Output:**
```json
{
  "building": {
    "type": "garage",
    "widthFt": 30,
    "lengthFt": 40,
    "legHeightFt": 10,
    "roofStyle": "vertical",
    "roofPitch": "4:12",
    "orientation": "length-facing-front",
    "panelDirection": { "walls": "horizontal", "roof": "vertical" }
  },
  "colors": {
    "roof": { "id": "white", "hex": "#FFFFFF" },
    "walls": { "id": "pewter-gray", "hex": "#8A8D8F" },
    "trim": { "id": "white", "hex": "#FFFFFF" },
    "wainscot": null
  },
  "openings": [
    { "id": "door_1", "type": "rollup", "widthFt": 10, "heightFt": 10, "wall": "front", "positionFt": 3 },
    { "id": "door_2", "type": "rollup", "widthFt": 10, "heightFt": 10, "wall": "front", "positionFt": 17 }
  ],
  "leanTos": [
    { "id": "lean_1", "wall": "left", "widthFt": 10, "lengthFt": 40, "heightFt": 8 }
  ],
  "options": {
    "insulation": { "roof": false, "walls": false },
    "anchoring": "ground",
    "installation": "included"
  },
  "inferredDefaults": ["legHeightFt", "roofPitch", "colors", "door sizes", "lean-to wall/height"],
  "clarifications": []
}
```

**Input:** "big red barn"

**Output:**
```json
{
  "clarifications": [
    "What dimensions do you need? (e.g., 30x40, 40x60)",
    "Do you need any doors or windows?"
  ],
  "partialConfig": {
    "building": { "type": "barn", "roofStyle": "aframe" },
    "colors": { "roof": { "id": "barn-red" }, "walls": { "id": "barn-red" } }
  }
}
```

### 8.5 Preventing Invalid Configurations

1. **Schema validation:** AI output is validated against Zod schema before applying
2. **Range clamping:** Values outside valid ranges are clamped (e.g., width 80 → 60)
3. **Opening collision check:** Verify doors don't overlap after AI placement
4. **Dependency enforcement:** Vertical roof → vertical panels, etc.
5. **Human review:** AI-generated config loads in the designer for user to review/tweak before submitting

---

## 9. BUILD PLAN

### Phase 1 — JSON Schema & Pricing Engine (Weeks 1–2)

**Deliverables:**
- TypeScript types and interfaces
- Zod validation schemas
- Default config factory
- `calculatePrice()` function with full test coverage
- Supabase schema (dealers, pricing_defaults, dealer_pricing)
- Seed data for 2–3 test dealers

**Difficulty:** Low-Medium
**Risk:** Low — pure logic, no UI dependencies
**Dependencies:** None

### Phase 2 — Basic 3D Building Renderer (Weeks 3–5)

**Deliverables:**
- Three.js scene with parametric building (frame + roof + walls)
- Color application
- Camera controls (orbit, preset views)
- Dimension controls (width, length, height sliders)
- Roof style selector
- Real-time price display
- Responsive layout (desktop + mobile)

**Difficulty:** High — 3D geometry is the hardest part
**Risk:** Medium — performance on mobile, geometry edge cases
**Dependencies:** Phase 1 (types, config)

### Phase 3 — Doors, Windows, Openings (Weeks 6–7)

**Deliverables:**
- Wall segmentation around openings
- Door placement UI (select wall, drag position)
- Window placement UI
- Roll-up, walk-in, window geometry
- Opening validation (fit, overlap)
- Lean-to geometry and controls

**Difficulty:** High — wall cutting logic, drag UX
**Risk:** Medium — interaction design on mobile
**Dependencies:** Phase 2

### Phase 4 — Dealer Admin & Saved Quotes (Weeks 8–10)

**Deliverables:**
- Dealer auth (Supabase Auth)
- Admin dashboard (leads list, quote detail)
- Pricing management UI
- Branding settings (logo, colors)
- Quote submission flow + email notifications
- Save/load designs
- Quote PDF generation

**Difficulty:** Medium
**Risk:** Low — standard CRUD
**Dependencies:** Phases 1–3

### Phase 5 — AI Generator (Weeks 11–12)

**Deliverables:**
- `configFromPrompt()` using Claude API
- Chat UI in configurator
- Clarification flow
- Validation and default-filling
- 50+ test cases

**Difficulty:** Medium
**Risk:** Low — Claude handles the hard part; validation is the key work
**Dependencies:** Phase 1 (schema)

### Phase 6 — Embeds & White-Label Rollout (Weeks 13–15)

**Deliverables:**
- Iframe embed route
- Dealer-specific theming middleware
- Custom domain support (CNAME)
- Webhook system for CRM integration
- Onboarding flow for new dealers
- Marketing site

**Difficulty:** Medium
**Risk:** Medium — cross-origin issues, SSL for custom domains
**Dependencies:** Phases 1–4

### Total estimated timeline: ~15 weeks for full V1

---

## 10. STARTER CODE

See generated files:
- `/app/designer/page.tsx`
- `/components/designer/BuildingDesigner.tsx`
- `/components/designer/ThreeScene.tsx`
- `/lib/building/types.ts`
- `/lib/building/defaultConfig.ts`
- `/lib/pricing/calculatePrice.ts`
- `/lib/ai/configFromPrompt.ts`

---

## 11. COMPETITIVE INSIGHTS

### What Dealers Love Most
1. **Real-time pricing** — eliminates back-and-forth quoting calls
2. **24/7 availability** — customers configure at midnight, lead arrives by morning
3. **Pre-qualified leads** — someone who spent 10 min configuring is serious
4. **Visual selling power** — 3D beats a spec sheet every time
5. **Reduced errors** — configurator enforces valid combinations

### What Usually Frustrates Customers
1. **Slow loading** — heavy 3D scenes on mobile data connections
2. **Confusing options** — too many choices without guidance
3. **No pricing** — "Request Quote" with no ballpark = abandonment
4. **Can't save progress** — close browser, lose everything
5. **No mobile support** — pinch-zooming a desktop layout
6. **Unclear next steps** — submitted form, now what?

### Where Current Configurators Fall Short
1. **No AI assistance** — users must know exactly what they want
2. **Cookie-cutter UX** — identical interface for every dealer
3. **No follow-up automation** — lead goes into email, dies there
4. **No design templates** — every customer starts from scratch
5. **Poor admin UX** — dealer dashboards are afterthoughts
6. **No analytics** — dealers can't see funnel data
7. **Expensive** — IdeaRoom pricing is premium; small dealers priced out
8. **Slow onboarding** — weeks to get set up

### How Steel Sync Can Beat Them
1. **AI-first** — "Describe your building" as the primary entry point
2. **Instant pricing** — always show price, never hide it
3. **Mobile-native** — designed for 60%+ mobile traffic
4. **Fast loading** — procedural geometry, code-split Three.js
5. **Self-serve dealer setup** — sign up, configure, embed in 1 hour
6. **Transparent pricing** — simple monthly subscription, no setup fee bait-and-switch
7. **Built-in follow-up** — automated email/SMS sequences
8. **Template library** — popular configs as starting points

---

## 12. RECOMMENDED DIFFERENTIATORS

### 10 Ways to Outperform Existing Metal Building Configurators

1. **AI Building Generation** — Natural language → 3D building. No competitor has this. "I need a 30x40 shop for my truck and woodworking tools" → fully configured building. This alone is a launch-worthy differentiator.

2. **Instant Live Pricing (Never Gated)** — Show real-time pricing by default. Make "hide pricing" the dealer opt-in, not the default. Customers who see price stay longer and convert at higher rates than "Request Quote" black holes.

3. **Smart Dealer Lead Routing** — Multi-dealer marketplace mode: customer enters zip code, system routes to nearest authorized dealer. Manufacturers can use Steel Sync as a dealer locator + configurator in one.

4. **Automated Quote Follow-Up** — Built-in email/SMS drip: "You designed a 30×40 garage — ready to move forward?" at 1 hour, 24 hours, 3 days, 7 days. Most dealers lose leads by not following up fast enough. Automate this out of the box.

5. **Template Marketplace** — Pre-configured popular buildings: "The Workshop" (30×40 with 2 roll-ups), "The RV Cover" (18×36 carport), "The Horse Barn" (40×60 with lean-tos). Customers click to start with 80% of config done. Dealers can create and promote their own templates.

6. **Saved Designs + Magic Link** — Customer gets an email with a link to their exact design. No account needed. Click link → back to their building. This single feature reduces abandonment dramatically.

7. **Quote PDF with 3D Renders** — Auto-generate a professional PDF with: 3D screenshots from 4 angles, full spec sheet, itemized pricing, dealer branding. Dealers currently create these manually. This saves hours per quote.

8. **SMS-First Lead Capture** — Offer "Text me my quote" as primary CTA alongside email. SMS open rates are 98% vs 20% for email. Send the design link via SMS for highest re-engagement.

9. **Dealer Analytics Dashboard** — Funnel metrics: views → configurations started → configurations completed → quotes submitted → quotes closed. Show which building types convert best, average deal size, time-to-close. No competitor does this well.

10. **Inventory-Ready Building Packages** — Dealers with buildings in stock can mark them as "Ready to Ship" with a discount badge. Customer sees: "This 24×30 carport is in stock — ships in 3 days. Save 10%." Combines configurator with inventory management.

---

## CLOSING SUMMARY

### Recommended MVP Scope

**Include in MVP (Phases 1–3, ~7 weeks):**
- Full parametric 3D building designer (width, length, height, roof, colors)
- Door and window placement
- Real-time pricing engine
- Quote submission with lead capture
- Single dealer support (hardcoded or URL param)
- Desktop + mobile responsive layout
- Basic admin page to view leads

**Defer to V2:**
- AI generator
- Lean-tos
- Dealer self-service admin
- Embeds / white-label
- Follow-up automations
- Template library

### Biggest Technical Risks

1. **3D Performance on Mobile** — Three.js on low-end Android is the #1 risk. Mitigation: procedural geometry, LOD, `AdaptiveDpr`, aggressive code-splitting. Test on a $150 Android phone early and often.

2. **Wall Opening Geometry** — Cutting holes in walls and handling edge cases (adjacent doors, doors at wall edges, multiple openings) is fiddly. Mitigation: use wall segmentation (multiple planes), not CSG. Build comprehensive test cases.

3. **Pricing Accuracy** — If pricing doesn't match real dealer costs, the tool is useless. Mitigation: build a pricing rule test suite, validate with 2–3 real dealers during Phase 1.

4. **Dealer Adoption** — The tool must be trivially embeddable. If onboarding takes more than 1 hour, dealers won't bother. Mitigation: iframe embed with single URL param. Zero-config for dealer's first experience.

5. **Scope Creep** — Metal buildings have infinite variations (gables, hip roofs, monitor barns, multi-span...). Mitigation: Start with carports/garages only. Expand building types only after MVP validates.

### Fastest Path to Launch

```
Week 1-2:   Types + Pricing Engine + Supabase schema
Week 3-5:   3D renderer (basic building + colors + camera)
Week 6-7:   Openings (doors/windows) + quote form
Week 8:     Polish, mobile optimization, deploy to Vercel
Week 9:     Beta with 2-3 real dealers
Week 10:    Iterate on feedback, launch publicly
```

**Total time to working MVP: 8 weeks.**
**Total time to public launch: 10 weeks.**

The fastest path is: skip lean-tos, skip AI, skip admin dashboard, skip embeds. Build a beautiful 3D configurator that takes dimensions + colors + doors → shows price → captures lead. Everything else is V2.

**Ship it.**
