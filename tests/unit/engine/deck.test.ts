import { describe, expect, it } from 'vitest';
import {
  CARDS_DEALT_PER_PLAYER,
  CARD_COLORS,
  CHALLENGE_LOSS_PENALTY,
  DECK_SIZE,
  DRAW_TWO_PENALTY,
  NUMBER_VALUES,
  UNO_PENALTY,
  WILD_DRAW_FOUR_PENALTY,
  buildDeck,
  cardColor,
  cardPoints,
  cardSymbol,
  handPoints,
  isCardColor,
  isColoredCard,
  isNumberCard,
  isWildCard,
  requiresColorChoice,
} from '../../../src/features/game/engine/cards.ts';
import { cards } from '../helpers/engineFixtures.ts';

describe('deck composition', () => {
  const deck = buildDeck();

  it('contains exactly the 108 cards of a standard deck', () => {
    expect(deck).toHaveLength(108);
    expect(DECK_SIZE).toBe(108);
  });

  it('uses unique card ids', () => {
    const ids = new Set(deck.map((card) => card.id));
    expect(ids.size).toBe(deck.length);
  });

  it('has 76 number cards: one nought and two of every other value per colour', () => {
    const numbers = deck.filter(isNumberCard);
    expect(numbers).toHaveLength(76);
    for (const color of CARD_COLORS) {
      for (const value of NUMBER_VALUES) {
        const matches = numbers.filter((card) => card.color === color && card.value === value);
        // The nought is the one number printed once. Four of the deck's 108 cards.
        expect(matches, `${color} ${String(value)}`).toHaveLength(value === 0 ? 1 : 2);
      }
    }
    expect(numbers.filter((card) => card.value === 0)).toHaveLength(4);
  });

  it('has two of every coloured action card per colour', () => {
    for (const color of CARD_COLORS) {
      for (const kind of ['skip', 'reverse', 'drawTwo'] as const) {
        const matches = deck.filter((card) => card.kind === kind && cardColor(card) === color);
        expect(matches, `${color} ${kind}`).toHaveLength(2);
      }
    }
    expect(deck.filter((card) => card.kind === 'skip')).toHaveLength(8);
    expect(deck.filter((card) => card.kind === 'reverse')).toHaveLength(8);
    expect(deck.filter((card) => card.kind === 'drawTwo')).toHaveLength(8);
  });

  it('has four of each wild', () => {
    expect(deck.filter((card) => card.kind === 'wild')).toHaveLength(4);
    expect(deck.filter((card) => card.kind === 'wildDrawFour')).toHaveLength(4);
    expect(deck.filter(isWildCard)).toHaveLength(8);
    expect(deck.filter(isColoredCard)).toHaveLength(100);
  });

  it('asks for a colour on both wilds and on nothing else', () => {
    for (const card of deck) {
      // The line clones get wrong: a Wild Draw Four is a wild, and its owner names
      // the colour play continues in.
      expect(requiresColorChoice(card), card.id).toBe(isWildCard(card));
    }
  });

  it('reports colour as null for wild cards only', () => {
    for (const card of deck) {
      expect(cardColor(card)).toBe(isWildCard(card) ? null : (card as { color: string }).color);
    }
  });

  it('derives comparable symbols', () => {
    expect(cardSymbol({ id: 'x', kind: 'number', color: 'red', value: 7 })).toBe('number:7');
    expect(cardSymbol({ id: 'z', kind: 'number', color: 'blue', value: 0 })).toBe('number:0');
    expect(cardSymbol({ id: 'y', kind: 'skip', color: 'blue' })).toBe('skip');
    expect(cardSymbol({ id: 'w', kind: 'reverse', color: 'yellow' })).toBe('reverse');
    expect(cardSymbol({ id: 'v', kind: 'wild' })).toBe('wild');
    expect(cardSymbol({ id: 'u', kind: 'wildDrawFour' })).toBe('wildDrawFour');
  });

  it('validates colour strings', () => {
    expect(isCardColor('red')).toBe(true);
    expect(isCardColor('purple')).toBe(false);
    expect(isCardColor(7)).toBe(false);
  });

  it('is built in a stable order', () => {
    expect(buildDeck().map((card) => card.id)).toEqual(deck.map((card) => card.id));
  });
});

describe('the rules’ own numbers', () => {
  it('deals seven', () => {
    expect(CARDS_DEALT_PER_PLAYER).toBe(7);
  });

  it('uses the official penalties', () => {
    expect(DRAW_TWO_PENALTY).toBe(2);
    expect(WILD_DRAW_FOUR_PENALTY).toBe(4);
    // The four they owed anyway, plus two for the accusation.
    expect(CHALLENGE_LOSS_PENALTY).toBe(6);
    expect(UNO_PENALTY).toBe(2);
  });

  it('leaves a viable draw pile at the largest table', () => {
    // Six seats is this build's cap. 6 x 7 = 42 dealt, one turned up, 65 left.
    expect(DECK_SIZE - 6 * CARDS_DEALT_PER_PLAYER - 1).toBe(65);
  });
});

describe('scoring', () => {
  it('scores a number at its face value', () => {
    for (const value of NUMBER_VALUES) {
      expect(cardPoints({ id: 'n', kind: 'number', color: 'red', value })).toBe(value);
    }
  });

  it('scores every coloured action card at twenty', () => {
    for (const kind of ['skip', 'reverse', 'drawTwo'] as const) {
      expect(cardPoints({ id: 'a', kind, color: 'green' })).toBe(20);
    }
  });

  it('scores either wild at fifty', () => {
    expect(cardPoints({ id: 'w', kind: 'wild' })).toBe(50);
    expect(cardPoints({ id: 'f', kind: 'wildDrawFour' })).toBe(50);
  });

  it('sums a hand', () => {
    expect(handPoints(cards('red:9', 'blue:skip', 'wildDrawFour'))).toBe(9 + 20 + 50);
    expect(handPoints([])).toBe(0);
  });

  it('scores the whole deck at the sum of its parts', () => {
    // Numbers: nought is worth nothing, and 1..9 twice per colour is 2 x 45 = 90 a
    // colour. Then 24 action cards at 20, and 8 wilds at 50.
    const numbers = 4 * 90;
    const actions = 24 * 20;
    const wilds = 8 * 50;
    expect(numbers + actions + wilds).toBe(1240);
    expect(handPoints(buildDeck())).toBe(1240);
  });
});
