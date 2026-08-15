import { describe, expect, it } from 'vitest';
import {
  getPlayableCardIds,
  hasPlayableCard,
  isCardPlayable,
  stepIndex,
  type PlayContext,
} from '../../../src/features/game/engine/rules.ts';
import { card, cards } from '../helpers/engineFixtures.ts';

function context(overrides: Partial<PlayContext> = {}): PlayContext {
  return { activeColor: 'red', topCard: card('red:5'), ...overrides };
}

describe('card matching', () => {
  it('accepts a card of the active colour', () => {
    expect(isCardPlayable(card('red:3'), context())).toBe(true);
  });

  it('accepts a card with the same number value', () => {
    expect(isCardPlayable(card('blue:5'), context())).toBe(true);
  });

  it('matches a nought like any other number', () => {
    expect(isCardPlayable(card('blue:0'), context({ topCard: card('red:0') }))).toBe(true);
    expect(isCardPlayable(card('blue:0'), context())).toBe(false);
  });

  it('accepts a card with the same action', () => {
    expect(isCardPlayable(card('blue:skip'), context({ topCard: card('red:skip') }))).toBe(true);
    expect(isCardPlayable(card('blue:reverse'), context({ topCard: card('red:reverse') }))).toBe(true);
    expect(isCardPlayable(card('blue:drawTwo'), context({ topCard: card('red:drawTwo') }))).toBe(true);
  });

  it('does not match one action against another', () => {
    expect(isCardPlayable(card('blue:reverse'), context({ topCard: card('red:skip') }))).toBe(false);
  });

  it('rejects a mismatching colour and symbol', () => {
    expect(isCardPlayable(card('blue:3'), context())).toBe(false);
  });

  it('accepts either wild, on anything', () => {
    for (const top of ['red:5', 'blue:skip', 'green:0'] as const) {
      expect(isCardPlayable(card('wild'), context({ topCard: card(top) }))).toBe(true);
      expect(isCardPlayable(card('wildDrawFour'), context({ topCard: card(top) }))).toBe(true);
    }
  });

  it('accepts a Wild Draw Four even while the hand could follow the colour', () => {
    /*
     * The bluff is the point. A gate here would make the challenge unreachable, and
     * the restriction is enforced by the challenge rather than by the rule — see
     * `isWildDrawFourHonest`.
     */
    expect(isCardPlayable(card('wildDrawFour'), context())).toBe(true);
  });

  it('follows the active colour rather than the top card when they differ', () => {
    // After a wild the table is in a colour the top card is not printed in.
    const afterWild = context({ activeColor: 'green', topCard: card('wild') });
    expect(isCardPlayable(card('green:2'), afterWild)).toBe(true);
    expect(isCardPlayable(card('red:2'), afterWild)).toBe(false);
  });

  it('accepts anything at all when nothing has been played yet', () => {
    const empty = context({ topCard: null });
    expect(isCardPlayable(card('red:2'), empty)).toBe(true);
    // No top card means no symbol to match, so only the colour can carry it.
    expect(isCardPlayable(card('blue:2'), empty)).toBe(false);
  });
});

describe('reading a hand', () => {
  it('lists the playable ids and nothing else', () => {
    const hand = cards('red:3', 'blue:9', 'blue:5', 'wild');
    const ids = getPlayableCardIds(hand, context());
    expect(ids).toHaveLength(3);
    expect(ids).not.toContain(hand[1]!.id);
  });

  it('answers whether there is anything to play', () => {
    expect(hasPlayableCard(cards('blue:9', 'green:8'), context())).toBe(false);
    expect(hasPlayableCard(cards('blue:9', 'wild'), context())).toBe(true);
  });
});

describe('stepping round the table', () => {
  it('wraps in both directions', () => {
    expect(stepIndex(0, 1, 3)).toBe(1);
    expect(stepIndex(2, 1, 3)).toBe(0);
    expect(stepIndex(0, -1, 3)).toBe(2);
    expect(stepIndex(1, -1, 3)).toBe(0);
  });

  it('refuses an empty table rather than looping for ever', () => {
    expect(() => stepIndex(0, 1, 0)).toThrow(RangeError);
  });
});
