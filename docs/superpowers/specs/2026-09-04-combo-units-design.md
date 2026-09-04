# Combo units — design

Date: 2026-09-04

## Problem

The designer offers carports, garages, barns, shops, warehouses and RV covers.
It has no way to express a building that is partly enclosed and partly open,
which is what a combo is — and combos are a product the dealer sells.

TejasMex lists three: **Combo Garage**, **End Combo** and **Side Combo** (styles
5, 6 and 7 in their own configurator). This work covers the first two.

## What a combo is

One structure, one frame. A dividing wall falls somewhere along the length: the
section on one side of it is enclosed, the rest stays open carport. The
enclosure runs the **full width** of the building — the only variable is where
the dividing wall falls.

End Combo and Combo Garage are the same machine. They differ in the typical
share enclosed and in the name the dealer sells them under, not in geometry or
pricing. They are modelled as two building types because a dealer picks them by
name, and because `availableBuildingTypes` gates what each dealer offers.

## Scope

In scope:

- `'end-combo'` and `'combo-garage'` as building types.
- A split: which end is enclosed, and how much of the length.
- Pricing, from the existing captured price table.
- Geometry, so the 3D designer draws it.
- The designer control for setting the split.

Out of scope, deliberately:

- **Side Combo.** The same idea with the split running across the width rather
  than along the length. It is an addition to the same field later, not a
  rewrite, and nobody has asked for it yet.
- **The assistant quoting combos.** Owner's decision: designer first, then the
  numbers get checked against TejasMex, then the bot in a second pass. Until
  then a customer asking the bot for a combo is handed to a human, which is what
  already happens for anything the engine cannot price.
- **New price capture.** None is needed — see below.

## No new capture is needed

This was the open question, and the answer is that the 2026-08-27 snapshot
already carries everything.

The combo styles are in `options.raw.json` (`combo-garage`, `metal-endcombo`,
`side-combo`), and `option-conditions.raw.json` carries their storage-position
availability rules. Neither carries a price, and **no `base-price` row in
`conditions.raw.json` is keyed to a combo style at all**.

That is not a gap. TejasMex's base prices are keyed on **roof type and size**
(`vertical-roof`, `regular-roof`, `boxed-eave-roof`, plus the lean variants),
not on building style. A style is a preset deciding which walls get added — the
frame underneath is priced the same either way. So a combo's frame is already
priced by the table we have.

The walls are too:

- **`sideWalls`** (252 rows) are keyed on `siding × widthBand × length bracket ×
  heightFt`. The length bracket is what makes a partial run expressible: price
  the enclosed length, not the building length.
- **`endWalls`** (434 rows) are keyed on `siding × widthFt × heightFt` — a flat
  price per width. A dividing wall is an end wall at the same width.

## The model

```ts
export type BuildingType =
  | 'carport' | 'garage' | 'barn' | 'shop' | 'warehouse' | 'rv-cover'
  | 'end-combo' | 'combo-garage';

export interface BuildingDimensions {
  // ... unchanged ...
  /**
   * The enclosed share of a combo. Absent on every other type.
   *
   * The building stays ONE box: this says where the dividing wall falls, not
   * that there are two buildings.
   *
   * `end` is which gable end the enclosure is anchored to, and the enclosed
   * section runs `enclosedLengthFt` INWARD from it. `{ end: 'front',
   * enclosedLengthFt: 12 }` on a 30ft building encloses 0-12ft measured from
   * the front, leaving 12-30ft open.
   */
  combo?: { enclosedLengthFt: number; end: 'front' | 'back' };
}
```

`combo` is optional, so every existing config, fixture and test stays valid.

**Validation.** `enclosedLengthFt` must be greater than zero and less than
`lengthFt`. Equal to `lengthFt` is a garage and should be built as one; zero is
a carport. The designer constrains the control, and the pricing path treats an
out-of-range value as unpriceable rather than quoting a guess.

## Pricing

`ManufacturerQuoteInput.enclosed?: boolean` becomes
`enclosedLengthFt: number`:

| Type | `enclosedLengthFt` |
|---|---|
| carport, rv-cover | `0` |
| garage, barn, shop, warehouse | `lengthFt` |
| end-combo, combo-garage | `combo.enclosedLengthFt` |

`enclosed` becomes `enclosedLengthFt > 0`. Every existing case produces exactly
the number it produces today, so no existing quote changes.

The wall block then brackets the side-wall lookup on `enclosedLengthFt` instead
of `lengthFt`. The two end walls are unchanged: on a fully enclosed building
they are the front and back; on a combo one is the outer closed end and the
other is the interior dividing wall.

**The assumption to verify.** That TejasMex charges the interior dividing wall
as a full end wall at the building's width. It is the one thing here not
derivable from the captured data, it is why the owner's checkpoint exists, and
it is a one-line change if it turns out to be wrong.

Outside the measured envelope the engine reports the combo unpriceable, exactly
as it already does for an enclosed building whose size no wall row covers. It
never falls back to the open-carport price.

## Geometry

`buildBuilding` grows walls over the enclosed span only, plus a dividing wall at
the split. Frame, roof, posts and trim are untouched — it is the same building
with walls on part of it.

**Openings need no new field**, but the derivation differs by wall and both
cases must be handled:

- **Left and right walls** run along the length, so `positionFt` is a distance
  along it and decides the section directly. On `{ end: 'front',
  enclosedLengthFt: 12 }`, a walk-in door at 4ft is on the enclosed part and one
  at 20ft is not.
- **Front and back walls** are the gable ends and `positionFt` runs across the
  width, which says nothing about the section. The wall itself does: the front
  wall is enclosed exactly when `end === 'front'`. An opening on the open gable
  end has no wall to sit in and is refused rather than drawn floating.

The front and back walls are the gable ends. On a combo, the wall at the
enclosed end exists and the wall at the open end does not; the dividing wall is
drawn at the split with the same gable profile.

## Designer

Two new entries in the building-type picker. Choosing either reveals one control
for the enclosed length, constrained to the frame length, and the price moves as
it is dragged like every other control.

The existing `showPricing` and placeholder-pricing gates apply unchanged — a
dealer on invented pricing sees no combo price either, for the same reason they
see no other price.

## Testing

- The split prices the side walls at the enclosed length, not the building
  length, and a full-length combo prices identically to the equivalent garage.
- Every existing building type prices exactly as it does today — the
  boolean-to-length change is provably behaviour-preserving.
- An `enclosedLengthFt` of zero, of the full length, or beyond it is refused as
  unpriceable rather than quoted.
- Geometry: walls exist over the enclosed span and nowhere else, and a dividing
  wall is present at the split.
- An opening is assigned to the section its `positionFt` puts it in.

Then the owner prices two or three real combos in TejasMex's own configurator
and compares, which is what settles the dividing-wall assumption.
