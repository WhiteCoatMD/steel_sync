#!/usr/bin/env node
/**
 * Label each measured row with the LEG TYPE it was actually captured under.
 *
 * The probe runs did not pin the leg type, and the configurator silently switches
 * it (a width change to 40ft flips the build to double legs, and the choice
 * sticks). That produced a whole height-12 sweep captured on DOUBLE legs while
 * every other sweep was on standard legs — which briefly looked like "enclosing a
 * building changes its leg price" and nearly got encoded as a measured override.
 *
 * The leg price itself identifies the type: at 24x25x12 the vendor ladder gives
 * 536 standard / 861 double / 1279 deluxe, and the row recorded 861. So each row
 * is classified by matching its leg amount against the derived ladder. Rows past
 * the 40ft bracket have no derived counterpart, so they inherit the type resolved
 * for the same height where coverage does exist.
 */
const fs = require('fs');
const path = require('path');

const SNAP = path.join(__dirname, '..', 'data', 'vendor-snapshots', '2026-08-27-tejasmex');
const MEASURED = path.join(SNAP, 'walls-measured.json');
const table = require(path.join(__dirname, '..', 'lib', 'pricing', 'data', 'tejasmex.json'));

const inB = (n, b) => n >= b[0] && n <= b[1];
const span = b => b[1] - b[0];
const LEG_TYPES = ['standard-legs', 'double-legs', 'deluxe-legs'];

function derivedCharged(legType, w, l, h) {
  const c = table.legHeight.filter(
    r => r.legType === legType && r.heightFt === h && inB(w, r.width) && inB(l, r.length));
  if (!c.length) return null;
  c.sort((a, b) => span(a.length) - span(b.length));
  return Math.round(c[0].price * 0.9);
}

const rows = JSON.parse(fs.readFileSync(MEASURED, 'utf8'));

// pass 1: classify where the derived ladder can identify the type
const byHeight = new Map();
for (const r of rows) {
  const want = r.leg == null ? 0 : r.leg;
  let match = null;
  for (const lt of LEG_TYPES) {
    const d = derivedCharged(lt, r.w, r.l, r.h);
    if (d != null && d === want) { match = lt; break; }
  }
  r.legType = match;
  if (match) {
    const seen = byHeight.get(r.h) || new Set();
    seen.add(match);
    byHeight.set(r.h, seen);
  }
}

// pass 2: rows with no derived coverage inherit the type resolved at that height
let inherited = 0, ambiguous = 0;
for (const r of rows) {
  if (r.legType) continue;
  const seen = byHeight.get(r.h);
  if (seen && seen.size === 1) { r.legType = [...seen][0]; inherited++; }
  else { r.legType = 'unknown'; ambiguous++; }
}

const summary = {};
for (const r of rows) {
  const k = r.h + ':' + r.legType;
  summary[k] = (summary[k] || 0) + 1;
}
console.log('rows', rows.length, '| inherited', inherited, '| ambiguous', ambiguous);
for (const k of Object.keys(summary).sort((a, b) => Number(a.split(':')[0]) - Number(b.split(':')[0]))) {
  console.log('   h=' + k.padEnd(22), summary[k]);
}
fs.writeFileSync(MEASURED, JSON.stringify(rows, null, 1));
console.log('written', path.relative(process.cwd(), MEASURED));
