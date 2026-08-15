import { cardColor, cardSymbol, isWildCard, type Card, type CardColor, type CardId } from './cards.ts';
import type { TurnDirection } from './state.ts';

/**
 * Minimal information needed to decide whether a card may be played.
 *
 * Two fields, and that is the whole of UNO's matching rule. Deliberately smaller
 * than {@link import('./state.ts').GameState} so that clients — which only ever
 * hold public state plus their own hand — can run exactly the same rule checks as
 * the room.
 */
export interface PlayContext {
  readonly activeColor: CardColor;
  /** Visible top card of the discard pile, or `null` before the first play. */
  readonly topCard: Card | null;
}

/**
 * Core matching rule: colour, symbol, or a wild.
 *
 * A card is playable when it matches the colour in play, when it matches the top
 * card's symbol (its number, or its action), or when it is one of the two wilds.
 *
 * Both wilds are playable **unconditionally**, and the Wild Draw Four's famous
 * restriction — that you may only play it holding no card of the colour in play —
 * is deliberately *not* enforced here. That is not an oversight, it is the rule:
 * the official game lets you play it as a bluff and gives the next player a
 * challenge to catch you with. A gate here would make the bluff impossible, and
 * with it the challenge, and with it the most interesting card in the deck. What
 * the restriction governs is whether the bluff *succeeds* — see
 * {@link isWildDrawFourHonest}, which the table's own highlight uses to guide an
 * honest player and which the challenge uses to judge a dishonest one.
 *
 * A wild may also be played while holding a perfectly good colour match. There is
 * no rule against spending one early; it is simply usually a waste.
 *
 * See `docs/rules.md`.
 */
export function isCardPlayable(card: Card, context: PlayContext): boolean {
  if (isWildCard(card)) {
    return true;
  }
  if (cardColor(card) === context.activeColor) {
    return true;
  }
  return context.topCard !== null && cardSymbol(card) === cardSymbol(context.topCard);
}

/**
 * Whether a Wild Draw Four played out of this hand was an honest one.
 *
 * The single question a challenge asks, asked once at the moment the card is laid
 * and never re-derived.
 *
 * Nothing warns a player who is about to bluff, and that is the rule rather than
 * an omission: {@link isCardPlayable} returns true for both wilds unconditionally,
 * so a Wild Draw Four is always offered and its owner is always free to lay one
 * they should not. A table that greyed the card out would have removed the bluff
 * from the game, and with it the only decision the challenge exists to make. This
 * lives beside the matching rules rather than inside the challenge code because it
 * is a fact about a hand and a colour, which is what this file is about.
 *
 * **Colour only.** Holding a matching number or action does not bar the card —
 * only a card of the colour actually in play does. And a wild in hand never
 * counts: it has no colour to match with, so a hand of nothing but wilds is an
 * honest hand.
 *
 * `playedId` is excluded because the card being judged is still in the hand at
 * the moment the question is asked, and a Wild Draw Four is colourless anyway —
 * excluding it costs nothing and removes the need for the caller to think about
 * when it is removed.
 */
export function isWildDrawFourHonest(
  hand: readonly Card[],
  activeColor: CardColor,
  playedId: CardId,
): boolean {
  return !hand.some((card) => card.id !== playedId && cardColor(card) === activeColor);
}

export function getPlayableCardIds(hand: readonly Card[], context: PlayContext): CardId[] {
  return hand.filter((card) => isCardPlayable(card, context)).map((card) => card.id);
}

export function hasPlayableCard(hand: readonly Card[], context: PlayContext): boolean {
  return hand.some((card) => isCardPlayable(card, context));
}

/** Seat index that follows `index` in the given direction, wrapping around. */
export function stepIndex(index: number, direction: TurnDirection, playerCount: number): number {
  if (playerCount <= 0) {
    throw new RangeError('playerCount must be greater than 0');
  }
  return (((index + direction) % playerCount) + playerCount) % playerCount;
}
