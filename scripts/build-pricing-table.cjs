#!/usr/bin/env node
/**
 * Compile the RAW TejasMex vendor snapshot into the pricing table the engine reads.
 *
 * Raw in : data/vendor-snapshots/<date>-tejasmex/
 * Table out: lib/pricing/data/tejasmex.json
 *
 * This is deliberately a separate, re-runnable step (dealer-pricing-notes.md §5.3):
 * the raw capture is never edited, so a parsing bug here is fixed by re-running this,
 * not by re-scraping.
 *
 * A mis-parsed bracket is a SILENT money bug, so this script refuses to emit a table
 * when two rows claim the same lookup key with different prices.
 */
const fs = require('fs');
const path = require('path');

const SNAP = path.join(__dirname, '..', 'data', 'vendor-snapshots', '2026-08-27-tejasmex');
const OUT = path.join(__dirname, '..', 'lib', 'pricing', 'data', 'tejasmex.json');

const read = f => JSON.parse(fs.readFileSync(path.join(SNAP, f), 'utf8'));
const conditions = read('conditions.raw.json');
const options = read('options.raw.json');
const config = read('pricing-config.raw.json');

const problems = [];
const note = m => problems.push(m);

// ── roof styles ─────────────────────────────────────────────
// Our RoofStyle union -> the vendor's roofing option key.
const STYLE_TO_VENDOR = { regular: 'regular-roof', aframe: 'boxed-eave-roof', vertical: 'vertical-roof' };
const VENDOR_STYLES = Object.values(STYLE_TO_VENDOR);

// ── base price: width band x ROOF length bracket x roof style ──
const basePrice = [];
{
  const seen = new Map();
  for (const r of conditions) {
    if (r.ct !== 'base-price' || typeof r.p !== 'number' || !r.w || !r.len) continue;
    const styles = r.keys.filter(k => VENDOR_STYLES.includes(k));
    if (!styles.length) continue;               // lean / loafing variants
    // Portable sheds price in THREE dimensions -- their label carries a height
    // ("6x8x6" vs "6x8x7") and two rows otherwise share a width/length bracket.
    // Carports are 2D ("24x26"). Fold height into the key so neither is dropped.
    const m3 = /^(\d+)x(\d+)x(\d+)$/.exec(String(r.lbl || ''));
    const heightFt = m3 ? Number(m3[3]) : null;
    // Classify by the LABEL, not by the presence of a 'portable-shed' key. A row
    // routinely applies to BOTH products ("regular-roof,portable-shed"), and
    // treating the key as exclusive silently deleted every 12ft-wide standard row
    // - 12x21, 12x26, 12x31 - so a 12x25 carport lost its base price entirely and
    // quoted the bare leg-height line. What actually distinguishes the two is
    // dimensionality: portable sheds price in 3D ("6x8x6"), carports in 2D ("12x26").
    const product = heightFt != null ? 'portable-shed' : 'standard';
    for (const style of styles) {
      const key = `${product}|${style}|${r.w[0]}-${r.w[1]}|${r.len[0]}-${r.len[1]}|${heightFt ?? '-'}`;
      if (seen.has(key) && seen.get(key) !== r.p) {
        note(`base-price conflict ${key}: ${seen.get(key)} vs ${r.p}`);
        continue;
      }
      if (seen.has(key)) continue;
      seen.set(key, r.p);
      basePrice.push({ product, style, width: r.w, roofLength: r.len, ...(heightFt != null ? { heightFt } : {}), price: r.p, label: r.lbl });
    }
  }
}

// The Skytrack lift fee (conditions[2945]) is NOT a leg-height price, but it is
// shaped like one: `multi-length-variable-price`, carrying a `-tall` key, a
// `-legs` key and a width band. Left alone it compiles into the ladder as
// "12ft standard legs, width 12-24, length [0,999] = 2400" and — because that
// bracket is the only one covering lengths past 40ft — silently wins the lookup
// for a 24x45x12 build, quoting a $2,160 leg height against a true ~$1,044.
// It is excluded here and modelled as a service fee below.
const SKYTRACK_FEE_GI = 2945;

// ── leg height: width band x length bracket x height x leg type ──
const legHeight = [];
{
  const seen = new Map();
  for (const r of conditions) {
    if (r.gi === SKYTRACK_FEE_GI) continue;                       // a fee, not a leg price
    if (r.ct !== 'multi-length-variable-price' || typeof r.p !== 'number' || !r.len) continue;
    const tall = r.keys.find(k => /^\d+-tall$/.test(k));          // single-section only
    const band = r.keys.find(k => /^\d+-\d+-wide$/.test(k));
    const legType = r.keys.find(k => /-legs$/.test(k));
    if (!tall || !band || !legType) continue;
    const heightFt = Number(tall.match(/^(\d+)-tall$/)[1]);
    const [, wMin, wMax] = band.match(/^(\d+)-(\d+)-wide$/).map(Number);
    const key = `${legType}|${wMin}-${wMax}|${r.len[0]}-${r.len[1]}|${heightFt}`;
    if (seen.has(key) && seen.get(key) !== r.p) { note(`legHeight conflict ${key}: ${seen.get(key)} vs ${r.p}`); continue; }
    if (seen.has(key)) continue;
    seen.set(key, r.p);
    legHeight.push({ legType, width: [wMin, wMax], length: r.len, heightFt, price: r.p });
  }
}

// ── anchor packages: package x length bracket ──
const anchorPackages = [];
{
  const seen = new Map();
  for (const r of conditions) {
    if (typeof r.p !== 'number' || !r.len) continue;
    const pkg = r.keys.find(k => /-anchor-pkg$|-rebar-pkg$/.test(k));
    if (!pkg) continue;
    const key = `${pkg}|${r.len[0]}-${r.len[1]}`;
    if (seen.has(key) && seen.get(key) !== r.p) { note(`anchor conflict ${key}`); continue; }
    if (seen.has(key)) continue;
    seen.set(key, r.p);
    anchorPackages.push({ pkg, length: r.len, price: r.p });
  }
}

// ── flat-priced option records ──
const pick = (type, extra = () => ({})) => options
  .filter(o => o.t === type && typeof o.p === 'number')
  .map(o => ({ key: o.k, label: o.lbl, price: o.p, ...extra(o) }));

// Certification is NOT a flat per-tier price. The six options share one display
// label and are selected by the BUILDING length bracket carried on each record
// ([0,21]->300, [22,26]->350, [27,31]->450, [32,36]->500, [37,41]->600), gated by
// widthTags. widthTags covers only 12-30ft, which is why the certification line
// disappears entirely on a 40ft-wide build. Measured against the live app at
// lengths 20/25/30/35/40 -> 270/315/405/450/540 charged.
const certifications = pick('engineer-certified', o => ({
  ...(Array.isArray(o.l) ? { length: o.l } : {}),
  ...(Array.isArray(o.wt) ? { widthTags: o.wt } : {}),
}));
// `ord` and `def` are how the vendor's own UI orders and pre-selects a
// component. They are the tie-breakers for a size that maps to more than one
// product - a plain "10x10 Roll Up Door" is the outside-latch one (ord 7), not
// the chain-hoist upgrade (ord 8) - so they are carried through and asserted in
// the opening-mapping tests rather than the choice being made by hand.
// `w` is the component's width in INCHES, which is also how the walk-in and
// window labels are dimensioned.
const components = pick('component', o => ({
  ...(typeof o.ord === 'number' ? { order: o.ord } : {}),
  ...(o.def ? { isDefault: true } : {}),
  ...(typeof o.w === 'number' ? { widthIn: o.w } : {}),
}));
const additionalOptions = pick('additional', o => ({
  calc: o.pc || 'amount',
  ...(typeof o.min === 'number' ? { minimumPrice: o.min } : {}),
}));

// ── Enclosed walls (MEASURED, not derived) ─────────────────
//
// Wall prices are computed client-side by the vendor's app and appear NOWHERE
// in the 5.35MB payload - values like 662, 763 and 2545 were read off the live
// estimate and cannot be found in any table. So this half of the model is a
// measurement, captured by scripts/probe-tejasmex.js into walls-measured.json.
//
// Structure established by probing:
//   side wall (spans the LENGTH) = f(width BAND, length BRACKET, height)
//       widths 18/20/24 all price identically at a given length+height, so only
//       the band matters; brackets are [0,20],[21,25],[26,30]... (21/22/23/25
//       all charge the same).
//   end wall (spans the WIDTH)   = f(exact width, height)
//       constant across length, but distinct per width (1155/1305/1606/2094/2545).
//
// Every captured row satisfies total = base + cert + leg + 2*side + 2*end exactly.
const measured = JSON.parse(fs.readFileSync(path.join(SNAP, 'walls-measured.json'), 'utf8'));

// Every length from 20 to 60 on an open 24x9 standard-leg vertical build,
// measured 2026-08-28. The derived tables already reproduced 20-40 exactly, line
// for line; 41-60 were entirely unpriceable (the base table's roof bracket ends
// at [37,41] and the leg ladder at [36,40]) even though the app offers them.
//
// These feed the same override paths as the wall capture. They carry no wall
// prices, which is fine: base, certification and leg height do not depend on
// walls, and the override builders below only read w/l/h/base/cert/leg.
const lengthsMeasured = JSON.parse(fs.readFileSync(path.join(SNAP, 'lengths-measured.json'), 'utf8'));

// Lengths 41/46/51/56 at every remaining base-price WIDTH BAND, measured
// 2026-08-28 (widths 12, 18, 20, 22, 26, 28, 30 - 24 came from the sweep above).
// Four lengths is enough because base price is constant inside [41,45], [46,50],
// [51,55] and [56,60], which the full 24ft sweep established foot by foot.
//
// Two structural facts fell out and both are used below:
//   - certification is WIDTH-INDEPENDENT: 540/585/630/720 at lengths 41/46/51/56
//     for every one of the seven widths, matching the 24ft sweep exactly;
//   - leg height follows the [12,24] / [26,30] bands: 509/574/640/706 for widths
//     12-24 and 784/862/933/1004 for 26-30, with no variation inside a band.
const widthsMeasured = JSON.parse(fs.readFileSync(path.join(SNAP, 'widths-measured.json'), 'utf8'));

// Leg height past length 40 at the heights the sweeps above did not reach,
// measured 2026-08-28: band [12,24] at 11-14ft (7-10 already came from the wall
// capture) and band [26,30] at 7/8/10-14ft (only 9 was known).
//
// These rows carry ONLY a leg price - no base/cert - because that is all they
// were probed for. The override builders below read whichever fields are
// present, so a leg-only row contributes a leg override and nothing else.
//
// Independent confirmation of the Skytrack rule fell out of this capture: on the
// eight width-30 rows at 13ft and 14ft, the estimate total exceeded
// base+cert+leg by EXACTLY 2400 every time, and by nothing anywhere else. That
// is the same width>=26 / height>=13 trigger measured separately earlier.
const legsMeasured = JSON.parse(fs.readFileSync(path.join(SNAP, 'legs-measured.json'), 'utf8'));

// The vendor's own ladder prices 5ft and 6ft legs at 0 for band [12,24] - they
// are included in the base price (confirmed by the owner 2026-08-28, and the app
// renders no leg line at all at those heights). Band [26,30] carries no 5/6ft
// rows anywhere, at any length, so a 30ft-wide build with 6ft legs was
// unpriceable outright. These fill that in at 0. 5ft is included alongside 6ft
// because a shorter leg cannot cost more than one that is already free.
// Band [12,24] needs the same treatment past length 40: its h=6 row already
// spans [0,60], but h=5 stops at [36,40], which left every 12-24ft build with
// 5ft legs unpriceable from 41ft long up.
const FREE_LEG_HEIGHTS = [5, 6];
const freeLegRows = [];
for (const h of FREE_LEG_HEIGHTS) {
  for (const w of [24, 30]) {
    for (const l of [20, 25, 30, 35, 40, 41, 46, 51, 56]) {
      freeLegRows.push({ w, h, l, legType: 'standard-legs', leg: 0 });
    }
  }
}

const allMeasured = [
  ...measured,
  ...lengthsMeasured,
  ...widthsMeasured,
  ...legsMeasured,
  ...freeLegRows,
];

const LENGTH_BRACKETS = [[0,20],[21,25],[26,30],[31,35],[36,40],[41,45],[46,50],[51,55],[56,60]];
const bracketFor = l => LENGTH_BRACKETS.find(b => l >= b[0] && l <= b[1]);
const bandFor = w => (w <= 24 ? [12, 24] : w <= 30 ? [26, 30] : [32, 60]);

// A second wall capture (2026-08-28, 100 probes) filling the grid the first one
// barely touched: 59 of 70 end-wall values and 69 of 126 side-wall values were
// missing, which is why enclosed builds priced at only 7.7%.
//
// It settled the shape of both tables, with zero contradictions across all 100
// rows plus the 62 from the first capture:
//
//   END walls key on the BASE-PRICE width band, not the exact width. 14, 16 and
//     18 all charge 959/1044/1084/1220/1377/1514 - identical at every height -
//     while 12, 20 and 22 each differ. Those are exactly the [13,18] / [0,12] /
//     [19,20] / [21,22] bands. So one measurement covers its whole band, and
//     the rows below are expanded across it.
//   SIDE walls key on the coarse [12,24] / [26,30] band, confirmed directly:
//     26x45x9 and 28x45x9 both charge 1188.
const walls2 = JSON.parse(fs.readFileSync(path.join(SNAP, 'walls2-measured.json'), 'utf8'));

// The base-price width bands, which end walls turn out to share.
const END_WALL_BANDS = [[0, 12], [13, 18], [19, 20], [21, 22], [23, 24], [25, 26], [27, 28], [29, 30]];
const endBandFor = w => END_WALL_BANDS.find(b => w >= b[0] && w <= b[1]);

const sideWalls = [];
const endWalls = [];
{
  const seenSide = new Map(), seenEnd = new Map();
  for (const r of [...measured, ...walls2]) {
    const br = bracketFor(r.l);
    if (!br) continue;
    const band = bandFor(r.w);
    const sk = `${band[0]}-${band[1]}|${br[0]}-${br[1]}|${r.h}`;
    if (seenSide.has(sk)) {
      if (seenSide.get(sk) !== r.side) note(`side wall conflict ${sk}: ${seenSide.get(sk)} vs ${r.side}`);
    } else {
      seenSide.set(sk, r.side);
      sideWalls.push({ widthBand: band, length: br, heightFt: r.h, price: r.side });
    }
    // End walls are band-wide, so one measurement answers for every width in
    // its band. Expanded to exact-width rows here so the engine's lookup stays
    // a simple equality, and so a conflict between two widths in the same band
    // would still be caught by the check below.
    const eb = endBandFor(r.w);
    if (!eb) continue;
    for (let w = eb[0]; w <= eb[1]; w++) {
      const ek = `${w}|${r.h}`;
      if (seenEnd.has(ek)) {
        if (seenEnd.get(ek) !== r.end) {
          note(`end wall conflict ${ek} (band ${eb[0]}-${eb[1]}, from measured w=${r.w}): ${seenEnd.get(ek)} vs ${r.end}`);
        }
      } else {
        seenEnd.set(ek, r.end);
        endWalls.push({ widthFt: w, heightFt: r.h, price: r.end });
      }
    }
  }
}

// ── Measured leg-height overrides ──────────────────────────
//
// The derived legHeight ladder is CORRECT wherever it has a row: at 24x25 it
// gives 536/842/920 at 12/13/14ft and the live app charges exactly that on an
// open build. An earlier cap of 11ft was a mistake - it came from comparing
// against a height-12 sweep that had silently drifted onto DOUBLE legs (861 =
// the double ladder, not a standard-leg price). See scripts/classify-measured-legs.cjs.
//
// So overrides only fill genuine holes: past the [36,40] bracket the ladder has
// no row at all. Each carries the leg type it was measured under, so a
// double-leg measurement can never be quoted for a standard-leg build.
const legRows = legHeight;
const legMeasured = [];
{
  const inB = (n, b) => n >= b[0] && n <= b[1];
  const spanOf = b => b[1] - b[0];
  // Mirror the engine's own lookup: narrowest matching bracket wins. The ladder
  // carries catch-all [0,999] rows, so a length past [36,40] still MATCHES - it
  // just matches the wrong row. Emit an override whenever the ladder is absent
  // OR disagrees with what the app actually charged.
  const derivedCharged = (legType, w, l, h) => {
    const c = legRows.filter(r => r.legType === legType && r.heightFt === h && inB(w, r.width) && inB(l, r.length));
    if (!c.length) return null;
    c.sort((a, b) => spanOf(a.length) - spanOf(b.length));
    return Math.round(c[0].price * 0.9);
  };
  const seen = new Map();
  for (const r of allMeasured) {
    const legPrice = r.leg == null ? 0 : r.leg;
    const legType = r.legType || 'standard-legs';
    const br = bracketFor(r.l);
    if (!br) continue;
    const band = bandFor(r.w);
    if (derivedCharged(legType, r.w, r.l, r.h) === legPrice) continue; // ladder already right
    const k = `${legType}|${band[0]}-${band[1]}|${br[0]}-${br[1]}|${r.h}`;
    if (seen.has(k)) {
      if (seen.get(k) !== legPrice) note(`leg measured conflict ${k}: ${seen.get(k)} vs ${legPrice}`);
      continue;
    }
    seen.set(k, legPrice);
    legMeasured.push({ legType, widthBand: band, length: br, heightFt: r.h, price: legPrice });
  }
}

// ── Measured base / certification overrides ────────────────
//
// The derived tables stop at a 41ft length bracket. Past that the vendor prices
// the building as a COMBINATION of lengths (its debug output exposes an "Is
// combining multiple lengths" flag) - a separate mechanism this repo has not
// modelled - and base price, certification and leg height all run out together.
//
// These overrides are keyed on the EXACT width and length measured, deliberately
// generalising nothing. Trying to key them by width band or by the wall length
// bracket both produced conflicts, which is how we learned that base price keys
// on the exact width bracket (18->2375, 20->2636, 24->3158 all sit inside the
// same 12-24 band) and that certification uses its own length brackets
// ([0,21] vs [22,26]) that do not line up with the wall brackets.
const baseMeasured = [];
const certMeasured = [];
{
  const seenB = new Map(), seenC = new Map();
  for (const r of allMeasured) {
    const k = `${r.w}|${r.l}`;
    if (r.base != null) {
      if (!seenB.has(k)) { seenB.set(k, r.base); baseMeasured.push({ widthFt: r.w, lengthFt: r.l, style: 'vertical-roof', price: r.base }); }
      else if (seenB.get(k) !== r.base) note(`base measured conflict ${k}: ${seenB.get(k)} vs ${r.base}`);
    }
    if (r.cert != null) {
      if (!seenC.has(k)) { seenC.set(k, r.cert); certMeasured.push({ widthFt: r.w, lengthFt: r.l, price: r.cert }); }
      else if (seenC.get(k) !== r.cert) note(`cert measured conflict ${k}: ${seenC.get(k)} vs ${r.cert}`);
    }
  }
}

// ── Band-keyed base / certification overrides (lengths past 40) ────
//
// The exact-width/exact-length overrides above only answer for a size that was
// literally probed. Past length 40 the derived tables have no rows at all, so
// every width x length in 41-60 would otherwise be unpriceable. These two tables
// generalise the measurements along the axes the vendor actually uses, and no
// further:
//
//   base  -> (base-price WIDTH BAND) x (building-length bracket)
//   cert  -> (building length) only, because certification does not vary by
//            width anywhere in 12-30 - verified at seven widths x four lengths
//
// Both are CHARGED amounts, so like every other measured override they bypass
// the -10% surcharge.
const BASE_WIDTH_BANDS = [[0, 12], [13, 18], [19, 20], [21, 22], [23, 24], [25, 26], [27, 28], [29, 30]];
const PAST_40_BRACKETS = [[41, 45], [46, 50], [51, 55], [56, 60]];

const baseMeasuredBands = [];
{
  const seen = new Map();
  for (const r of allMeasured) {
    if (r.base == null || r.l < 41) continue;
    const band = BASE_WIDTH_BANDS.find(b => r.w >= b[0] && r.w <= b[1]);
    const br = PAST_40_BRACKETS.find(b => r.l >= b[0] && r.l <= b[1]);
    if (!band || !br) continue;
    const k = `${band[0]}-${band[1]}|${br[0]}-${br[1]}`;
    if (seen.has(k)) {
      if (seen.get(k) !== r.base) note(`base band conflict ${k} (from ${r.w}x${r.l}): ${seen.get(k)} vs ${r.base}`);
      continue;
    }
    seen.set(k, r.base);
    baseMeasuredBands.push({ widthBand: band, length: br, style: 'vertical-roof', price: r.base });
  }
}

const certMeasuredLengths = [];
{
  const seen = new Map();
  for (const r of allMeasured) {
    if (r.cert == null) continue;
    if (seen.has(r.l)) {
      if (seen.get(r.l) !== r.cert) note(`cert length conflict at ${r.l} (from width ${r.w}): ${seen.get(r.l)} vs ${r.cert}`);
      continue;
    }
    seen.set(r.l, r.cert);
    certMeasuredLengths.push({ lengthFt: r.l, price: r.cert });
  }
  certMeasuredLengths.sort((a, b) => a.lengthFt - b.lengthFt);
}

// ── service fees ──
// Billed in their own group AFTER the subtotal. Not surcharged (the live estimate
// shows 2400 verbatim at 30-wide, where the -10% width surcharge applies), and
// NOT in the deposit base: at 30x25x13 the vendor charged 18% of the 6208
// subtotal (1117.44), not of the 8608 total, then billed the fee in the balance.
//
// Thresholds MEASURED live 2026-08-28 on open, standard-leg, vertical builds at
// length 25 — the pair of them are the 13/15 in the rule's own expression:
//
//   width | 12ft | 13ft | 14ft | 15ft
//   24    |  no  |  no  |  no  | FEE
//   26    |  no  | FEE  |      |
//   28    |      | FEE  |      |
//   30    |      | FEE  |      |
//   40    |      | FEE  |      |
//
// Only `standard-legs` was measured, and the rule's own `refs` name `leg`, so
// the engine refuses fee-range geometry on any other leg type rather than
// guessing a 2400 line either way.
const serviceFees = [
  {
    key: 'skytrack-lift',
    label: 'Skytrack Lift Flat Fee',
    price: 2400,
    measuredLegTypes: ['standard-legs'],
    // Fee applies if ANY band matches. A band carrying `enclosedOnly` is tested
    // only against enclosed builds.
    //
    // ENCLOSING A WIDE BUILD DROPS THE TRIGGER BY A FOOT. Measured 2026-08-28
    // during the wall capture: nine of 100 enclosed rows exceeded
    // base+cert+leg+2*side+2*end by exactly 2400, every one at width >= 26 and
    // height 12 - a height that charges nothing on an OPEN build of the same
    // size (26x25x12 open was measured at 5280, no fee line). Confirmed
    // directly afterwards: enclosed 26x25x11 no fee, enclosed 26x25x12 fee.
    //
    // The narrow branch does NOT shift: enclosed 24x25 charges no fee at 12, 13
    // or 14, same as open.
    bands: [
      { minWidthFt: 26, minLegHeightFt: 12, enclosedOnly: true },
      { minWidthFt: 26, minLegHeightFt: 13 },
      { minWidthFt: 0, minLegHeightFt: 15 },
    ],
    surcharged: false,
    affectsDeposit: false,
  },
];

// ── surcharges + deposit ──
const surcharges = config.surcharges;
const depositTiers = config.dealerDeposit.depositPrice
  .map((minSubtotal, i) => ({ minSubtotal, percent: config.dealerDeposit.depositPercent[i] }))
  .sort((a, b) => b.minSubtotal - a.minSubtotal);

const table = {
  manufacturer: 'tejasmex',
  dealer: config.dealerDeposit.key,
  capturedAt: '2026-08-27',
  sourceVersion: config.serverVersion,
  styleToVendor: STYLE_TO_VENDOR,
  // The reference product always ships a 6" roof overhang per end, and the base
  // price bracket keys on ROOF length, not building length. A 25' building is a
  // 26' roof and prices as "24x26". Confirmed against the vendor's own debug
  // output: actualLength 25 -> actualRoofLength 26 -> baseSizeLabel "24x26".
  standardRoofOverhangFt: 0.5,
  basePrice,
  legHeight,
  anchorPackages,
  certifications,
  components,
  additionalOptions,
  surcharges,
  serviceFees,
  deposit: { tiers: depositTiers },
  // MEASURED, and already CHARGED amounts: walls are not touched by the
  // line-item surcharge (578 and 1606 appear verbatim in the live estimate),
  // so the engine must not apply it again.
  sideWalls,
  endWalls,
  legMeasured,
  baseMeasured,
  certMeasured,
  baseMeasuredBands,
  certMeasuredLengths,
};

console.log('base price rows :', basePrice.length);
console.log('leg height rows :', legHeight.length);
console.log('anchor rows     :', anchorPackages.length);
console.log('certifications  :', certifications.length);
console.log('components      :', components.length);
console.log('additional opts :', additionalOptions.length);
console.log('deposit tiers   :', depositTiers.map(t => `>=${t.minSubtotal}:${t.percent}%`).join(' '));
console.log('service fees    :', serviceFees.length);
console.log('side wall rows  :', sideWalls.length);
console.log('end wall rows   :', endWalls.length);
console.log('leg overrides   :', legMeasured.length);
console.log('base overrides  :', baseMeasured.length);
console.log('cert overrides  :', certMeasured.length);
console.log('base bands      :', baseMeasuredBands.length);
console.log('cert lengths    :', certMeasuredLengths.length);

if (problems.length) {
  console.error('\nCONFLICTS (' + problems.length + ') — refusing to write:');
  problems.slice(0, 20).forEach(p => console.error('  ' + p));
  process.exit(1);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(table, null, 1));
console.log('\nwrote', path.relative(process.cwd(), OUT), '(' + fs.statSync(OUT).size + ' bytes)');
