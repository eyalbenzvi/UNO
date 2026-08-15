/**
 * How the player's hand is arranged across the width it has.
 *
 * Pure arithmetic, kept out of the component so the one thing that decides
 * whether a player can see all of their cards can be tested directly rather than
 * through a layout engine.
 */

/**
 * The narrowest strip of a card that still owns its own centre.
 *
 * A card is a button, and a tap lands in the middle of it. If the visible strip
 * were narrower than half a card, the neighbour lapping over it would own the
 * middle of the card underneath, and a confident tap would play the wrong card —
 * irreversibly, in front of everyone. Just over half keeps every centre honest.
 */
export const MIN_STRIP_RATIO = 0.52;

/** The gap between cards in a hand that has room to spread out, in px. */
export const SPREAD_GAP_PX = 8;

/** Kept clear of the edges so a card never sits flush against them, in px. */
export const EDGE_MARGIN_PX = 4;

export interface HandLayout {
  /** Cards per row. `0` while nothing has been measured yet. */
  readonly perRow: number;
  /** Distance from one card's leading edge to the next, in px. */
  readonly strip: number;
  /** The measured width of a card, in px. */
  readonly card: number;
}

/** Before anything has been measured: the stylesheet's own defaults apply. */
export const UNMEASURED: HandLayout = { perRow: 0, strip: 0, card: 0 };

/**
 * How much of its full size a card is drawn at, for a hand of `count`.
 *
 * A hand of fifteen at full size is two rows about 200 px tall, which on a 660 px
 * phone leaves the table too little to draw itself in — the piles came out cut in
 * half, which is what a player reported. Bringing the cards down a little as the
 * hand grows buys that space back, and it buys it from the part of the screen
 * that has the most of it: a big hand is mostly overlap anyway.
 *
 * A function of the count alone, deliberately. Scaling from the measured width
 * instead would feed the new card size back into the next measurement, and a hand
 * that sits on the boundary would oscillate between two sizes for ever.
 *
 * Five steps rather than two. The largest single jump is about seven per cent,
 * down from fourteen. That was tolerable while the resize was instantaneous and
 * read as nothing at all, but the hand now animates between layouts — and an
 * animated fourteen per cent shrug is something you can watch happen.
 *
 * Every step that wraps to a second row was then taken down a further 4.5 per
 * cent, when the cards took the printed 56 × 88 proportion instead of the 2:3 they
 * had been drawn at. A card 4.7 per cent taller costs about ten pixels per row,
 * and this table's whole job is to keep two rows inside the height the hand is
 * allowed — so a ratio change that nobody would notice on one card is exactly the
 * kind of thing that pushes the second row off a 664 px phone. The single-row
 * sizes keep their full scale: there is only one row's worth of height to find.
 */
export function handCardScale(count: number): number {
  if (count <= 8) {
    return 1;
  }
  if (count <= 9) {
    return 0.93;
  }
  if (count <= 11) {
    return 0.87;
  }
  if (count <= 13) {
    return 0.81;
  }
  return count <= 16 ? 0.77 : 0.73;
}

/**
 * Solves how many cards fit on a row, and how far apart they sit.
 *
 * The hand used to be a single row that scrolled sideways once it stopped
 * fitting, which meant a hand of ten had cards off the edge of the screen and no
 * way to see them but a swipe nobody discovered. So the row is measured instead:
 * cards spread out when there is room, close up to the overlap floor when there
 * is not, and then **wrap onto another row** rather than off the screen.
 *
 * Rows are balanced — eleven cards go 6 + 5, never 9 + 2 — because a nearly
 * empty second row reads as a rendering fault rather than as a hand.
 */
export function solveHandLayout(available: number, card: number, count: number): HandLayout {
  if (available <= 0 || card <= 0 || count <= 0) {
    return UNMEASURED;
  }
  const floor = card * MIN_STRIP_RATIO;
  // How many cards a single row can hold: the first one whole, then one strip per
  // card after it.
  const capacity = card <= available ? Math.floor((available - card) / floor) + 1 : 1;
  const rows = Math.ceil(count / Math.max(1, Math.min(count, capacity)));
  const perRow = Math.ceil(count / rows);
  if (perRow <= 1) {
    return { perRow: 1, strip: card, card };
  }
  const fitted = (available - card) / (perRow - 1);
  const strip = Math.min(card + SPREAD_GAP_PX, Math.max(floor, fitted));
  return { perRow, strip, card };
}

/** How many rows {@link solveHandLayout} produces for a hand of `count`. */
export function rowCount(layout: HandLayout, count: number): number {
  return layout.perRow > 0 ? Math.ceil(count / layout.perRow) : 1;
}
