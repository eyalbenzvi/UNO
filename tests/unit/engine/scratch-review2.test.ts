import { describe, expect, it } from 'vitest';
import { applyCommand } from '../../../src/features/game/engine/engine.ts';
import { toPublicGameState } from '../../../src/features/game/engine/views.ts';
import { chooseBotMove } from '../../../src/features/game/bot/policy.ts';
import { cards, expectOk, makeState, players } from '../helpers/engineFixtures.ts';

describe('exhausted pile', () => {
  it('drawCard is accepted but takes nothing, and hasDrawn stays false', () => {
    const list = players('Alice', 'Bob');
    const state = makeState({
      players: list,
      hands: { 'p-alice': cards('blue:3', 'blue:4'), 'p-bob': cards('green:7', 'green:8') },
      drawPile: [],
      discardPile: cards('red:9'),
      currentPlayerIndex: 0,
    });
    const after = expectOk(applyCommand(state, { type: 'drawCard', playerId: 'p-alice' })).state;
    expect(after.drawnCardId).toBeNull();
    expect(toPublicGameState(after).hasDrawn).toBe(false);
    expect(after.version).toBe(state.version + 1);
    expect(after.currentPlayerIndex).toBe(0);

    // The bot, handed exactly this table, asks to draw again — for ever.
    const view = {
      playerId: 'p-alice',
      table: toPublicGameState(after),
      hand: after.hands['p-alice']!,
      drawnCardId: null,
      seats: list.map((p) => ({ id: p.id, present: true })),
      lenientToward: {},
    };
    const move = chooseBotMove(view, () => 0.5);
    expect(move?.action.type).toBe('drawCard');

    // passTurn is legal here — but nothing in the UI or the bot ever offers it.
    expectOk(applyCommand(after, { type: 'passTurn', playerId: 'p-alice' }));
  });
});
