import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../../src/i18n/index.ts';
import { describeEvent } from '../../../src/features/game/ui/eventText.ts';
import { cardFaceLabel, colorName, describeCard } from '../../../src/features/game/ui/cardText.ts';
import type { GameEvent } from '../../../src/features/game/engine/state.ts';
import type { Card } from '../../../src/features/game/engine/cards.ts';

const t = createTranslator('en');
const he = createTranslator('he');
const nameOf = (playerId: string): string => (playerId === 'p1' ? 'Dana' : 'Eli');

const red5: Card = { id: 'x1', kind: 'number', color: 'red', value: 5 };
const blueSkip: Card = { id: 'x2', kind: 'skip', color: 'blue' };
const wildFour: Card = { id: 'x3', kind: 'wildDrawFour' };
const green0: Card = { id: 'x4', kind: 'number', color: 'green', value: 0 };

describe('card text', () => {
  it('names numbers, actions and wilds', () => {
    expect(describeCard(t, red5)).toBe('Red 5');
    expect(describeCard(t, green0)).toBe('Green 0');
    expect(describeCard(t, blueSkip)).toBe('Blue Skip');
    expect(describeCard(t, wildFour)).toBe('Wild Draw Four');
  });

  it('prints a short face label', () => {
    expect(cardFaceLabel(t, red5)).toBe('5');
    expect(cardFaceLabel(t, green0)).toBe('0');
    expect(cardFaceLabel(t, blueSkip)).toBe('Skip');
    expect(cardFaceLabel(t, wildFour)).toBe('Wild Draw Four');
  });

  it('localises colours', () => {
    expect(colorName(t, 'yellow')).toBe('Yellow');
    expect(colorName(he, 'yellow')).toBe('צהוב');
  });
});

describe('event descriptions', () => {
  const cases: Array<[GameEvent, string]> = [
    [{ type: 'gameStarted', firstPlayerId: 'p1', activeColor: 'red' }, 'The round begins. Colour: Red.'],
    [{ type: 'cardPlayed', playerId: 'p1', card: red5, resultingColor: 'red' }, 'Dana played Red 5.'],
    [{ type: 'cardDrawn', playerId: 'p2', count: 1 }, 'Eli drew a card.'],
    [{ type: 'cardDrawn', playerId: 'p2', count: 3 }, 'Eli drew 3 cards.'],
    [{ type: 'turnPassed', playerId: 'p1' }, 'Dana ended their turn.'],
    [{ type: 'colorChosen', playerId: 'p1', color: 'blue' }, 'Dana chose Blue.'],
    [{ type: 'playerSkipped', playerId: 'p2' }, 'Eli was skipped.'],
    [
      { type: 'challengeOpened', playerId: 'p1', targetId: 'p2' },
      'Dana played a Wild Draw Four at Eli.',
    ],
    [{ type: 'challengeDeclined', playerId: 'p2', drawn: 4 }, 'Eli took the cards — 4 cards drawn.'],
    [{ type: 'challengeDeclined', playerId: 'p2', drawn: 1 }, 'Eli took the cards — 1 card drawn.'],
    [
      { type: 'challengeResolved', challengerId: 'p2', targetId: 'p1', bluffed: true, drawn: 4 },
      'Eli called the bluff and was right — Dana draws 4.',
    ],
    [
      { type: 'challengeResolved', challengerId: 'p2', targetId: 'p2', bluffed: false, drawn: 6 },
      'Eli called the bluff and was wrong — they draw 6.',
    ],
    [{ type: 'unoDeclared', playerId: 'p1' }, 'Dana called UNO.'],
    [
      { type: 'unoCaught', playerId: 'p1', caughtById: 'p2', penalty: 2 },
      'Eli caught Dana without an UNO — 2 cards drawn.',
    ],
    [{ type: 'directionChanged', direction: 1 }, 'The play order is now forwards.'],
    [{ type: 'directionChanged', direction: -1 }, 'The play order is now reversed.'],
    [{ type: 'turnChanged', playerId: 'p2' }, 'Eli is up.'],
    [{ type: 'drawPileRecycled', count: 12 }, 'The discard pile was shuffled back in (12 cards).'],
    [{ type: 'drawPileExhausted' }, 'There are no cards left to draw.'],
    [{ type: 'playerWon', playerId: 'p1' }, 'Dana has no cards left and wins!'],
    [{ type: 'roundScored', playerId: 'p1', points: 80 }, 'Dana scores 80 for the round.'],
    [{ type: 'turnSkipped', playerId: 'p2', drew: 0 }, 'Eli was away, so their turn was passed.'],
    [
      { type: 'turnSkipped', playerId: 'p2', drew: 1 },
      'Eli was away, so their turn was passed and they drew a card.',
    ],
    [{ type: 'playerLeft', playerId: 'p2' }, 'Eli left the round.'],
    [{ type: 'roundAbandoned' }, 'Too few players are left, so the round was abandoned.'],
  ];

  it.each(cases)('describes %j', (event, expected) => {
    expect(describeEvent(t, event, nameOf)).toBe(expected);
  });

  it('has a Hebrew line for every event type', () => {
    for (const [event] of cases) {
      const line = describeEvent(he, event, nameOf);
      expect(line.length).toBeGreaterThan(0);
      expect(line).not.toContain('{');
    }
  });

  it('never mentions a card that is not already face up', () => {
    // Only `cardPlayed` carries a card, and that card is on the discard pile.
    const withCards = cases.filter(([event]) => 'card' in event);
    expect(withCards).toHaveLength(1);
  });
});
