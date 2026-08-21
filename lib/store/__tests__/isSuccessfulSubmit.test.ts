import { describe, it, expect } from 'vitest';
import { isSuccessfulSubmit, type SubmitResult } from '../designerStore';

// Regression coverage for the bug this task fixes: QuoteFormModal's
// handleSubmit (components/designer/BuildingDesigner.tsx) used to call
// setSubmitted(true) unconditionally after awaiting submitQuote(), so the
// "Quote Submitted!" screen appeared even when the submission failed.
// handleSubmit now gates on isSuccessfulSubmit(result) instead of an inline
// `result.ok` check, so this is the same boolean the component renders on.
//
// A full DOM-rendering test of QuoteFormModal itself was attempted and
// found impractical: this repo's vitest setup (rolldown/oxc-based Vite, no
// @vitejs/plugin-react) refuses to transform JSX because the project's
// tsconfig.json sets `compilerOptions.jsx: "preserve"` — which Next.js
// requires, since its own SWC compiler (not tsc) owns the real JSX
// transform for the app. Rolldown's oxc transform has no supported
// per-config override for this; the only fix is changing the shared
// tsconfig, which was judged out of scope/too risky for this task. See the
// task report for what was verified instead (a live dev-server run driven
// by browser automation).
describe('isSuccessfulSubmit', () => {
  it('is true for an { ok: true } result — this is what may show the success screen', () => {
    const result: SubmitResult = { ok: true, quoteId: 'qt_1' };
    expect(isSuccessfulSubmit(result)).toBe(true);
  });

  it('is false for an { ok: false } result — the bug: this must NOT show the success screen', () => {
    const result: SubmitResult = { ok: false, error: 'Network error — please check your connection and try again.' };
    expect(isSuccessfulSubmit(result)).toBe(false);
  });
});
