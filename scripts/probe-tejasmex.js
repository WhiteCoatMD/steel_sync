/*
 * TejasMex configurator probe harness.
 *
 * WHY THIS EXISTS
 * ---------------
 * The vendor price file (5.35 MB) can be read straight out of browser memory and
 * covers base price, leg heights, certification, anchors, components, the
 * surcharge rule and the deposit schedule. It does NOT cover everything: enclosed
 * wall prices are computed client-side by expressions, and values such as 662,
 * 763 and 2545 (measured off the live estimate) appear nowhere in the payload.
 * For those, the only source of truth is measuring the running app.
 *
 * HOW TO USE
 * ----------
 * 1. Open https://design.tejasmex.com/?dealer=Columbia and let it finish loading.
 * 2. Paste this whole file into the DevTools console.
 * 3. await P.init()                      // finds the store, hides WebGL, grabs controls
 * 4. await P.grid(24, [20,25,30], 9)     // probe a width x lengths grid at a height
 * 5. copy(JSON.stringify(P.results))     // pull the measurements out
 *
 * DRIVING THIS FROM AN AUTOMATION TOOL
 * ------------------------------------
 * A CDP Runtime.evaluate call typically times out around 45s, and a single probe
 * can exceed that once the app degrades. Do NOT await a whole sweep in one call:
 * kick it off unawaited, let it accumulate into P.results, and poll.
 *
 *   P.sweepDone = false;
 *   (async () => { for (const c of cfgs) await P.probe(...c); P.sweepDone = true; })();
 *
 * A timed-out call does not cancel the work - the loop keeps running in the page.
 * Persist P.results to localStorage every probe so a reload never loses them.
 *
 * THE ONE TRICK THAT MAKES THIS PRACTICAL
 * ---------------------------------------
 * Every configuration change triggers a 3D rebuild that blocks the main thread
 * for ~10s (~27s on an enclosed building), which makes probing unusably slow.
 * Hiding the WebGL canvases and shrinking them to 1x1 drops that to well under a
 * second. A MutationObserver re-hides canvases React recreates on re-render.
 * Pricing is unaffected - it is computed from the Redux store, not the renderer.
 *
 * WHY NOT DISPATCH ACTIONS DIRECTLY
 * ---------------------------------
 * store.dispatch({type:'SELECT_OPTIONS', selection:[{type:'width',key:'30-wide'}]})
 * corrupts the state: the real controls dispatch several coordinated actions and
 * the app reverts or crashes on a bare one. Instead this grabs each control's
 * React `onOptionSelected` / `onChange` prop off the fiber. Those handlers keep
 * working after their panel is collapsed, which is what lets us sit on the
 * Estimate tab (needed to read line items) while still changing the size.
 */

const P = (window.P = {
  results: [],
  ctl: {},

  sleep: ms => new Promise(r => setTimeout(r, ms)),

  /** Hide every WebGL canvas so config changes stop blocking on a scene rebuild. */
  hideGL() {
    for (const c of document.querySelectorAll('canvas')) {
      c.style.display = 'none';
      try { c.width = 1; c.height = 1; } catch (e) { /* detached */ }
    }
  },

  /** The Redux store is not global; reach it through the React fiber tree. */
  findStore() {
    const isStore = o =>
      o && typeof o === 'object' && typeof o.getState === 'function' && typeof o.dispatch === 'function';
    let fiber = null;
    for (const el of document.querySelectorAll('div,main,section')) {
      const k = Object.keys(el).find(
        k => k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$'));
      if (k) { fiber = el[k]; break; }
    }
    let root = fiber, guard = 0;
    while (root && root.return && guard++ < 10000) root = root.return;

    const seen = new Set(), queue = [root];
    let visited = 0;
    while (queue.length && visited < 60000) {
      const f = queue.shift(); visited++;
      if (!f || seen.has(f)) continue;
      seen.add(f);
      for (const prop of ['memoizedProps', 'memoizedState', 'pendingProps']) {
        const x = f[prop];
        if (!x || typeof x !== 'object') continue;
        if (isStore(x)) return x;
        if (isStore(x.store)) return x.store;
        if (x.value && isStore(x.value)) return x.value;
        if (x.value && isStore(x.value.store)) return x.value.store;
      }
      if (f.child) queue.push(f.child);
      if (f.sibling) queue.push(f.sibling);
    }
    return null;
  },

  async tab(name) {
    const hits = [...document.querySelectorAll('div,button,li,span')]
      .filter(e => (e.textContent || '').trim() === name && e.offsetParent !== null);
    if (hits.length) hits[hits.length - 1].click();
    await P.sleep(1200);
    P.hideGL();
  },

  /** Size pickers: a MUI select whose wrapper div's only text is the label. */
  sizeControl(labelText) {
    const wrap = [...document.querySelectorAll('div')].find(
      e => (e.textContent || '').trim() === labelText && e.offsetParent !== null && e.querySelector('input'));
    if (!wrap) return null;
    const input = wrap.querySelector('input');
    const fibKey = Object.keys(input).find(k => k.startsWith('__reactFiber$'));
    let f = input[fibKey];
    for (let i = 0; i < 16 && f; i++) {
      const p = f.memoizedProps;
      if (p && p.onOptionSelected && (p.groupedOptions || p.optionsList)) {
        const keys = p.groupedOptions
          ? p.groupedOptions.flatMap(g => g.options.map(o => o.key))
          : p.optionsList.map(o => o.key);
        return { set: p.onOptionSelected, selected: p.selectedOptionKey, keys };
      }
      f = f.return;
    }
    return null;
  },

  /*
   * Find a control by one of the OPTION KEYS it offers, rather than by its
   * visible label. Prefer this to listControl(): the Style-tab labels drift
   * ("Single Legs" is the label for `standard-legs`), so label matching returned
   * NOT FOUND for both the roof and leg controls on 2026-08-28, while the keys
   * are the same identifiers the pricing data uses.
   *
   * NOTE this must be called while the control's own tab is open - a collapsed
   * panel is unmounted and cannot be found. The handler it returns keeps working
   * afterwards, which is what lets us sit on the Estimate tab while probing.
   */
  controlByKey(key) {
    for (const el of document.querySelectorAll('div,button,span,li,input')) {
      const fibKey = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
      if (!fibKey) continue;
      let f = el[fibKey];
      for (let i = 0; i < 6 && f; i++) {
        const p = f.memoizedProps;
        if (p && typeof p === 'object') {
          const handler = p.onOptionSelected || p.onChange;
          const list = p.groupedOptions ? p.groupedOptions.flatMap(g => g.options) : p.optionsList;
          if (handler && Array.isArray(list) && list.some(o => o.key === key)) {
            return { set: handler, selected: p.selectedOptionKey, keys: list.map(o => o.key) };
          }
        }
        f = f.return;
      }
    }
    return null;
  },

  /*
   * Ground truth for what the app actually has selected. A control's
   * `selectedOptionKey` is captured when the handle is grabbed and goes stale
   * immediately, which is how the leg-type drift below went unnoticed for a
   * whole sweep. The store never lies.
   */
  sel(type) {
    const selection = P.store.getState().options.present.selection || [];
    for (const path of selection) {
      const hit = path.find(s => s.type === type);
      if (hit) return hit.key;
    }
    return null;
  },

  /** Option lists (roofing, legs, walls): grab by one of their visible labels. */
  listControl(labelText) {
    const el = [...document.querySelectorAll('div,button,span,li')]
      .filter(e => (e.textContent || '').trim() === labelText && e.offsetParent !== null).pop();
    if (!el) return null;
    const fibKey = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
    let f = el[fibKey];
    for (let i = 0; i < 16 && f; i++) {
      const p = f.memoizedProps;
      if (p && typeof p === 'object') {
        const handler = p.onOptionSelected || p.onChange;
        const list = p.groupedOptions ? p.groupedOptions.flatMap(g => g.options) : p.optionsList;
        if (handler && Array.isArray(list)) {
          return { set: handler, selected: p.selectedOptionKey, keys: list.map(o => o.key) };
        }
      }
      f = f.return;
    }
    return null;
  },

  /** Parse the Estimate panel into { label, amount } line items. */
  estimate() {
    const t = document.body.innerText;
    const i = t.indexOf('Structure Details');
    if (i < 0) return null;
    const j = t.indexOf('PRICING AND OPTIONS', i);
    const lines = t.slice(i, j > 0 ? j : i + 3000).split('\n').map(s => s.trim()).filter(Boolean);
    const items = [];
    for (let k = 1; k < lines.length; k++) {
      const m = /^\$([\d,]+(?:\.\d+)?)$/.exec(lines[k]);
      if (m) items.push({ label: lines[k - 1], amount: Number(m[1].replace(/,/g, '')) });
    }
    return items;
  },

  /*
   * Read the estimate once it genuinely reflects the requested size.
   *
   * Two staleness traps, both of which produced junk rows before this existed:
   *  - the DOM lags getTotalPrice(), so compare the panel's own Total Estimate
   *    against getTotalPrice() rather than trusting either alone;
   *  - both can lag together by one step, so also require the Base Price label
   *    to name the width and length we just asked for.
   */
  async readFor(w, l) {
    const norm = s => s.replace(/[‘’']/g, "'");
    for (let i = 0; i < 18; i++) {
      await P.sleep(200);
      const total = window.getTotalPrice();
      const items = P.estimate() || [];
      const te = items.find(x => /Total Estimate/i.test(x.label));
      const bp = items.find(x => /Base Price/i.test(x.label));
      if (te && bp && Math.abs(te.amount - total) < 0.5 && norm(bp.label).includes(`${w}'x${l}`)) {
        return { total, items };
      }
    }
    return { total: window.getTotalPrice(), items: P.estimate() || [], stale: true };
  },

  async init() {
    P.store = P.findStore();
    if (!P.store) throw new Error('store not found - is the configurator finished loading?');
    P.hideGL();
    if (!P.observer) {
      P.observer = new MutationObserver(muts => {
        for (const m of muts) {
          for (const n of m.addedNodes) {
            if (n.nodeType !== 1) continue;
            if (n.tagName === 'CANVAS') { n.style.display = 'none'; try { n.width = 1; n.height = 1; } catch (e) {} }
            if (n.querySelectorAll) for (const c of n.querySelectorAll('canvas')) {
              c.style.display = 'none'; try { c.width = 1; c.height = 1; } catch (e) {}
            }
          }
        }
      });
      P.observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    await P.tab('Style');
    P.ctl.roof = P.listControl('Regular Style');
    P.ctl.legs = P.listControl('Double Legs');
    await P.tab('Sides & Ends');
    P.ctl.walls = P.listControl('Fully Enclosed');
    await P.tab('Size');
    P.ctl.w = P.sizeControl('Width');
    P.ctl.l = P.sizeControl('Length');
    P.ctl.h = P.sizeControl('Leg Height');
    await P.tab('Estimate');

    return Object.fromEntries(
      Object.entries(P.ctl).map(([k, v]) => [k, v ? v.keys.length + ' options' : 'NOT FOUND']));
  },

  /** Probe one width x lengths row at a fixed height; appends to P.results. */
  async grid(w, lengths, h) {
    P.ctl.w.set(`${w}-wide`);
    P.ctl.h.set(`${h}-tall`);
    const rows = [];
    for (const l of lengths) {
      P.ctl.l.set(`${l}-deep`);
      const r = await P.readFor(w, l);
      const amt = re => { const it = r.items.find(i => re.test(i.label)); return it ? it.amount : null; };
      const rec = {
        w, l, h, total: r.total, stale: r.stale || false,
        base: amt(/Base Price/), cert: amt(/Certified/), leg: amt(/Leg Height/),
        side: amt(/Left Side/), end: amt(/Front End/),
        items: r.items,
      };
      P.results.push(rec);
      rows.push(rec);
    }
    return rows;
  },
});
