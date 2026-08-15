/**
 * Card model for UNO.
 *
 * The deck is the standard 108-card one: ten numbers and three action cards in
 * four colours, plus the two colourless wilds. Cards are plain serialisable
 * objects so they can travel over the network unchanged. See `docs/rules.md`.
 */

/**
 * The four suits, in the order the deck is built and everything else sorts by.
 *
 * One order, declared once. The original this game is built from carried two —
 * the deck's and the hand-sorter's — which disagreed, so a hand was laid out in a
 * different order from the one the deck was made in. Nothing depended on it, which
 * is exactly why it survived; `selectors.ts` now reads this list rather than
 * repeating it.
 */
export const CARD_COLORS = ['red', 'yellow', 'green', 'blue'] as const;
export type CardColor = (typeof CARD_COLORS)[number];

/**
 * The numbers printed on the deck.
 *
 * Nought through nine, and the nought is the odd one: every other number is
 * printed twice per colour and the nought exactly once, which is where four of
 * the deck's 108 cards go and why a nought is worth waiting for.
 */
export const NUMBER_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export type NumberValue = (typeof NUMBER_VALUES)[number];

/** Action cards that carry a colour. */
export const COLORED_ACTIONS = ['skip', 'reverse', 'drawTwo'] as const;
export type ColoredActionKind = (typeof COLORED_ACTIONS)[number];

/**
 * Cards without a colour of their own.
 *
 * Both of them ask their owner to name the next colour — see
 * {@link requiresColorChoice}, which is the single most commonly mis-implemented
 * line in the game.
 */
export const WILD_KINDS = ['wild', 'wildDrawFour'] as const;
export type WildKind = (typeof WILD_KINDS)[number];

export type CardKind = 'number' | ColoredActionKind | WildKind;

export type CardId = string;

export interface NumberCard {
  readonly id: CardId;
  readonly kind: 'number';
  readonly color: CardColor;
  readonly value: NumberValue;
}

export interface ColoredActionCard {
  readonly id: CardId;
  readonly kind: ColoredActionKind;
  readonly color: CardColor;
}

export interface WildCard {
  readonly id: CardId;
  readonly kind: WildKind;
}

export type Card = NumberCard | ColoredActionCard | WildCard;

/** Number of copies of every card, per colour where applicable. */
export const DECK_COMPOSITION = {
  /** The nought exists once per colour, unlike every other number. */
  zeroCopiesPerColor: 1,
  /** Each number 1-9 exists twice per colour. */
  numberCopiesPerColor: 2,
  /** Each coloured action card exists twice per colour. */
  actionCopiesPerColor: 2,
  /** Wild cards in the whole deck. */
  wildCount: 4,
  /** Wild Draw Four cards in the whole deck. */
  wildDrawFourCount: 4,
} as const;

export const CARDS_DEALT_PER_PLAYER = 7;

/** How many cards a Draw Two makes the next player draw. */
export const DRAW_TWO_PENALTY = 2;

/** How many cards a Wild Draw Four makes its victim draw. */
export const WILD_DRAW_FOUR_PENALTY = 4;

/**
 * What a failed challenge costs the player who made it.
 *
 * The four they were going to draw anyway, plus two for the accusation. Derived
 * rather than written as a six, so the two numbers can never drift apart.
 */
export const CHALLENGE_LOSS_PENALTY = WILD_DRAW_FOUR_PENALTY + 2;

/**
 * How many cards a player draws when another player catches them holding a
 * single card they never called UNO on. See `docs/rules.md`.
 */
export const UNO_PENALTY = 2;

/** The score a match is played to, in the points mode. */
export const TARGET_SCORE = 500;

export function isWildCard(card: Card): card is WildCard {
  return (WILD_KINDS as readonly string[]).includes(card.kind);
}

export function isColoredCard(card: Card): card is NumberCard | ColoredActionCard {
  return !isWildCard(card);
}

export function isNumberCard(card: Card): card is NumberCard {
  return card.kind === 'number';
}

/**
 * Whether playing this card asks its owner to name the next colour.
 *
 * **Both** wilds do, and this is the line clones get wrong: a Wild Draw Four is
 * not "a Draw Four that happens to be colourless", it is a wild — the player
 * names the colour play continues in, and they do so whether the card was honest
 * or a bluff, and whether or not the challenge that follows goes against them.
 * Getting this wrong leaves the table in whatever colour preceded the card, which
 * looks almost right and is not.
 */
export function requiresColorChoice(card: Card): boolean {
  return isWildCard(card);
}

/** Colour of a card, or `null` for colourless cards. */
export function cardColor(card: Card): CardColor | null {
  return isWildCard(card) ? null : card.color;
}

/**
 * Stable identifier used for "same symbol" matching. Two cards match by symbol
 * when this value is equal (e.g. any `skip` matches any other `skip`).
 *
 * The wilds get one too, and it is never consulted: they are playable on
 * anything by colour-independent rule, so nothing ever asks whether a wild
 * matches a symbol. Keeping the function total is what stops a caller having to
 * remember that.
 */
export function cardSymbol(card: Card): string {
  return isNumberCard(card) ? `number:${card.value}` : card.kind;
}

/**
 * What this card is worth to the winner, when a round is scored.
 *
 * The official table: a number is worth its face value, the three coloured
 * action cards twenty each, and either wild fifty. See `docs/rules.md`.
 */
export function cardPoints(card: Card): number {
  if (isNumberCard(card)) {
    return card.value;
  }
  return isWildCard(card) ? 50 : 20;
}

/** What a whole hand is worth to the player who went out. */
export function handPoints(hand: readonly Card[]): number {
  return hand.reduce((total, card) => total + cardPoints(card), 0);
}

export function isCardColor(value: unknown): value is CardColor {
  return typeof value === 'string' && (CARD_COLORS as readonly string[]).includes(value);
}

/**
 * Builds the full ordered deck. The order is deterministic; shuffling is a
 * separate, seeded step so games can be replayed exactly.
 */
export function buildDeck(): Card[] {
  const cards: Card[] = [];
  const push = (card: Card): void => {
    cards.push(card);
  };

  for (const color of CARD_COLORS) {
    for (const value of NUMBER_VALUES) {
      const copies = value === 0 ? DECK_COMPOSITION.zeroCopiesPerColor : DECK_COMPOSITION.numberCopiesPerColor;
      for (let copy = 0; copy < copies; copy += 1) {
        push({ id: `n-${color}-${value}-${copy}`, kind: 'number', color, value });
      }
    }
    for (const kind of COLORED_ACTIONS) {
      for (let copy = 0; copy < DECK_COMPOSITION.actionCopiesPerColor; copy += 1) {
        push({ id: `a-${kind}-${color}-${copy}`, kind, color });
      }
    }
  }

  const wildCounts: Readonly<Record<WildKind, number>> = {
    wild: DECK_COMPOSITION.wildCount,
    wildDrawFour: DECK_COMPOSITION.wildDrawFourCount,
  };
  for (const kind of WILD_KINDS) {
    for (let copy = 0; copy < wildCounts[kind]; copy += 1) {
      push({ id: `w-${kind}-${copy}`, kind });
    }
  }

  return cards;
}

/**
 * Total number of cards produced by {@link buildDeck}.
 *
 * Derived rather than written as 108, so a change to the composition above
 * cannot leave a constant behind saying otherwise. The tests assert it *is* 108,
 * which is the other half of the same guard.
 */
export const DECK_SIZE =
  CARD_COLORS.length *
    (DECK_COMPOSITION.zeroCopiesPerColor +
      (NUMBER_VALUES.length - 1) * DECK_COMPOSITION.numberCopiesPerColor) +
  CARD_COLORS.length * COLORED_ACTIONS.length * DECK_COMPOSITION.actionCopiesPerColor +
  DECK_COMPOSITION.wildCount +
  DECK_COMPOSITION.wildDrawFourCount;
