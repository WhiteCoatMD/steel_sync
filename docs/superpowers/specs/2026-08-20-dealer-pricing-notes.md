# Dealer Pricing + Admin — decisions captured before speccing

**Date:** 2026-08-20
**Status:** pre-spec notes. Not a design doc. These are settled decisions and hard-won findings
that must survive into the pricing sub-project's spec.

This file exists because these decisions were made during the lead-path project and live nowhere
else in version control.

---

## 1. Business context (changes what "correct" means)

The configurator is being **pitched to TejasMex, the manufacturer** — not merely used as a dealer
tool. Consequences:

- **Do not build pricing on scraping the incumbent vendor's app.** Ask TejasMex for the price
  file. That is a standard proof-of-concept ask, and it qualifies the prospect. Extraction is the
  fallback, not the plan.
- **The demo is the product.** A manufacturer evaluating against IdeaRoom judges the 3D view in
  the first thirty seconds. This is an argument for prioritising render fidelity alongside
  pricing, ahead of quote automation.
- The owner has **no manufacturer price sheet** today. Their logged-in designer is currently the
  only source.

## 2. Pricing is per MANUFACTURER, not per dealer

Every dealer of a manufacturer quotes the same numbers. `DealerPricingRules` therefore models
pricing at the wrong level. Correct shape:

```
manufacturers
  base price brackets        (width band x ROOF length)
  roof style deltas, leg height tiers, certification, gauge, braces, anchors
  colour tiers (standard 29ga vs premium 29ga)
  delivery zones
  deposit split (reference product: 18% due today, balance on delivery)

dealers
  manufacturer_id
  name, contact, branding, service area
```

**Only sales tax varies per dealer** — and see §3, it is not quoted at all.

> **CORRECTED 2026-08-27 by the actual capture.** Two things vary that this section says do not:
> 1. A **vendor-level line-item surcharge** of −10% applies to base price, leg height,
>    certification and anchor package, but ONLY for widths 3–30, and NOT to components or walls.
>    The extracted tables are LIST prices; the quoted number is list minus this surcharge.
> 2. The **deposit schedule is per dealer** and tiered on subtotal (Columbia: ≥30k 21%, ≥20k 20%,
>    ≥3k 18%, ≥1k 12%).
>
> The core claim still holds — pricing is per manufacturer and adding a dealer needs no price
> entry — but a dealer record carries a deposit schedule, and the manufacturer carries surcharge
> rules. See `data/vendor-snapshots/2026-08-27-tejasmex/README.md`.

**Consequence:** adding a dealer of a known manufacturer requires entering **no prices** — just
contact details and a designer URL. That is precisely the original ask ("add other dealers'
pricing just by entering it"). The costly unit of work is adding a *manufacturer*, once.

**Consequence:** one careful extraction serves every dealer of that manufacturer, permanently.

## 3. Tax is NOT quoted in the configurator

Tax is computed from the **customer's** zip, so it belongs on neither the manufacturer nor the
dealer record. Decision: **do not quote tax at all.** Quote pre-tax, label it, defer tax to the
final quote.

This matches the reference product verbatim — it displays no tax and states *"Final pricing —
including pricing adjustments, discounts, delivery, and taxes — will be provided with final quote
prior to purchase."* It also removes an entire external dependency (Stripe Tax / Avalara / a
rotting zip-rate table) from the critical path.

## 4. What we learned about the reference pricing model

Observed directly from the owner's authenticated session. Pricing is computed **100%
client-side** — no API call.

Itemised estimate for a Standard Carport 24x25x9:

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

Four facts that must shape the data model:

1. **Base price is a size-lookup TABLE, not a rate.** `basePricePerSqft` is the wrong shape.
2. **The lookup key uses ROOF length, not building length** — a 24x25 building prices as `24x26`.
   Getting this wrong shifts every quote by one bracket.
3. **Widths are grouped into bands** (`12-24-wide`), so brackets are coarse.
4. **Options are flat line items**, not multipliers. Roof style Vertical vs Regular measured at
   **$587** on a 24x25.

Also unmodelled today: the two-tier colour upcharge (standard 29ga vs "Premium Colors *Extra
cost"), and the deposit split.

## 5. Extraction approach, if it is needed

`getFullVendorData()` returns HTTP 403 from their S3 bucket, so bulk export is unavailable.

1. **Try reading the price data out of client memory first** — pricing is client-side, so the
   table must be loaded. `window.idearoom.api._internal` was never explored (the tab froze).
2. **Fall back to scripted grid probing** of `getTotalPrice()` across the size grid.
3. **Capture RAW to a dated snapshot** before any transformation, so a parsing error does not
   force a re-scrape.
4. **Build a parity harness as the acceptance test:** price N random configurations through our
   engine and theirs, assert they match to the cent. Anything less is us believing our own table.

**Risk:** pricing extracted this way is coupled to their app's internals; a redesign breaks
re-extraction. Asking for a price list removes the dependency entirely.

> **DONE 2026-08-27.** TejasMex confirmed they have no price sheet, so extraction became the
> plan rather than the fallback. Step 1 worked: pricing is client-side, so the entire 5.35 MB
> vendor price file was resident in memory. The Redux store is reachable through the React fiber
> tree (it is not a global); no grid probing was needed. Captured under
> `data/vendor-snapshots/2026-08-27-tejasmex/`, compiled by `scripts/build-pricing-table.cjs`,
> priced by `lib/pricing/manufacturer/`, with the parity harness of §4 in
> `lib/pricing/manufacturer/__tests__/parity.test.ts`.

## 6. PDF price-sheet upload

The admin must accept a price-sheet PDF and import it rather than requiring hand entry.

**Required safeguards** — PDF table parsing is error-prone and a mis-parsed bracket is a *silent*
money bug (every quote in that size range quietly wrong, nothing errors):

- store the raw PDF
- show the parsed table for human confirmation **before** it goes live
- never auto-activate an import
- spot-check after import: price a few known configurations and compare

## 7. Seed / demo pricing

Demo pricing should look realistic for the pitch, but must stay unmistakably marked. The current
seed carries `_placeholder: true` in `pricing_rules` — keep that marker so demo data can never be
mistaken for real pricing.
