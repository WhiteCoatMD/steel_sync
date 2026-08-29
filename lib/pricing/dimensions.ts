/**
 * How a requested size becomes a size the manufacturer actually builds.
 *
 * Kept in one place because the same rule has to hold in two independent
 * spots: the pricing engine (which number gets a price) and the reply text
 * (which number the customer is told they are buying). If those two ever
 * disagree, we quote one building and describe another.
 */

/** Nothing shorter is built; a 16ft request is sold and priced as a 20. */
export const MIN_LENGTH_FT = 20;

/**
 * Length is sold in 5ft increments with a 20ft floor (owner, 2026-08-29).
 *
 * Below the floor we round UP rather than refusing: someone asking for an 18ft
 * carport wants the smallest one we make, and the smallest one we make is 20ft.
 * Telling them so beats a handoff.
 */
export function normalizeLengthFt(requested: number): number {
  if (!Number.isFinite(requested)) return requested;
  return Math.max(requested, MIN_LENGTH_FT);
}

/**
 * Width is built in 2ft increments, so an odd width is quoted at the next one
 * up: a 21ft building is priced as a 22ft (owner, 2026-08-28).
 */
export function normalizeWidthFt(requested: number): number {
  if (!Number.isFinite(requested)) return requested;
  return requested % 2 === 0 ? requested : requested + 1;
}
