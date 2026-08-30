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

/**
 * The tallest side walls that may be quoted automatically.
 *
 * 14ft and up goes to the dealer (owner, 2026-08-29). The engine will happily
 * price an open 24x30x14 at $5,077 from the measured table, so this is not
 * about a missing number -- it is that buildings this tall carry questions the
 * bot cannot settle (anchoring, permits, site access, what actually has to fit
 * inside), and getting one wrong is expensive in a way a carport is not.
 */
export const MAX_AUTO_QUOTE_LEG_HEIGHT_FT = 14;

/** True when side walls this tall must be handed to a person. */
export function needsDealerReview(legHeightFt: number): boolean {
  return Number.isFinite(legHeightFt) && legHeightFt >= MAX_AUTO_QUOTE_LEG_HEIGHT_FT;
}

/**
 * The sizes this manufacturer actually builds.
 *
 * Checked BEFORE we start collecting details, because "i need a 100x200 shop"
 * was answered with questions about roof style and door sizes -- three more
 * turns of a customer's time spent specifying a building we could never have
 * priced (owner, 2026-08-29). Saying so at once is the respectful answer.
 */
export const MIN_WIDTH_FT = 12;
export const MAX_WIDTH_FT = 30;
export const MAX_LENGTH_FT = 60;

export interface OutOfRange {
  /** Customer-facing, and it names what we DO build. */
  message: string;
}

export function checkBuildable(b: {
  widthFt?: unknown;
  lengthFt?: unknown;
}): OutOfRange | null {
  const w = typeof b.widthFt === 'number' ? b.widthFt : null;
  const l = typeof b.lengthFt === 'number' ? b.lengthFt : null;

  if (w != null && w > MAX_WIDTH_FT) {
    // "40x30" is as likely to be a 30 wide by 40 long as a genuine 40ft span,
    // and one of those we build. Offer it rather than refusing the sale.
    const swapped =
      l != null && l >= MIN_WIDTH_FT && l <= MAX_WIDTH_FT && w <= MAX_LENGTH_FT;
    return {
      message: swapped
        ? `Just to check — did you mean ${l} wide by ${w} long? ${MAX_WIDTH_FT}ft ` +
          `is the widest we build, so a ${w}ft span is not something we make, ` +
          `but a ${l}x${w} is.`
        : `${w}ft is wider than we build — ${MAX_WIDTH_FT}ft is the widest single ` +
          `unit. Anything bigger is a different kind of job, so someone will ` +
          `follow up to talk it through with you.`,
    };
  }
  if (w != null && w < MIN_WIDTH_FT) {
    return {
      message:
        `${MIN_WIDTH_FT}ft is the narrowest we build, so a ${w}ft one is not ` +
        `something we make — the smallest is ${MIN_WIDTH_FT}x${MIN_LENGTH_FT}. ` +
        `Someone will follow up if you want to talk through the options.`,
    };
  }
  if (l != null && l > MAX_LENGTH_FT) {
    return {
      message:
        `${l}ft is longer than we build — ${MAX_LENGTH_FT}ft is the longest we ` +
        `go. Someone will follow up about what to do with a run that long.`,
    };
  }
  return null;
}
