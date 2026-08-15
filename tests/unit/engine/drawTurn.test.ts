import { describe, expect, it } from 'vitest';
import { applyCommand } from '../../../src/features/game/engine/engine.ts';
import { toPrivateHandView, toPublicGameState } from '../../../src/features/game/engine/views.ts';
import { cards, expectOk, expectRejected, makeState, players } from '../helpers/engineFixtures.ts';

/**
 * UNO's draw rule, which is the most-played rule in the game and the one a port
 * from another game is likeliest to get wrong.
 *
 * You take exactly one card. The turn does not end. If it fits you may play it —
 * that card and nothing else from your hand — or you end the turn yourself.
 */
function table() {
  return makeState({
    players: players('Alice', 'Bob'),
    activeColor: 'red',
    discardPile: cards('red:5'),
    hands: { 'p-alice': cards('blue:3', 'blue:4'), 'p-bob': cards('green:8', 'green:9') },
    drawPile: cards('red:7', 'green:2', 'green:3'),
  });
}

describe('drawing', () => {
  it('takes exactly one card and leaves the turn open', () => {
    const before = table();
    const { state } = expectOk(applyCommand(before, { type: 'drawCard', playerId: 'p-alice' }));
    expect(state.hands['p-alice']).toHaveLength(3);
    expect(state.players[state.currentPlayerIndex]?.id).toBe('p-alice');
    expect(state.turnSeq).toBe(before.turnSeq);
    expect(state.drawnCardId).not.toBeNull();
  });

  it('is voluntary — a player holding a playable card may still draw', () => {
    const state = makeState({
      activeColor: 'red',
      discardPile: cards('red:5'),
      hands: { 'p-alice': cards('red:9'), 'p-bob': cards('green:8') },
      drawPile: cards('blue:1', 'blue:2'),
    });
    expectOk(applyCommand(state, { type: 'drawCard', playerId: 'p-alice' }));
  });

  it('refuses a second card in one turn', () => {
    const { state } = expectOk(applyCommand(table(), { type: 'drawCard', playerId: 'p-alice' }));
    expectRejected(applyCommand(state, { type: 'drawCard', playerId: 'p-alice' }), 'alreadyDrew');
  });

  it('lets the drawn card be played, when it fits', () => {
    const { state: drew } = expectOk(applyCommand(table(), { type: 'drawCard', playerId: 'p-alice' }));
    const drawn = drew.drawnCardId as string;
    const { state } = expectOk(applyCommand(drew, { type: 'playCard', playerId: 'p-alice', cardId: drawn }));
    expect(state.hands['p-alice']).toHaveLength(2);
    expect(state.drawnCardId).toBeNull();
    expect(state.players[state.currentPlayerIndex]?.id).toBe('p-bob');
  });

  it('refuses every other card in the hand once one has been drawn', () => {
    const { state: drew } = expectOk(applyCommand(table(), { type: 'drawCard', playerId: 'p-alice' }));
    const other = (drew.hands['p-alice'] ?? []).find((card) => card.id !== drew.drawnCardId)!;
    expectRejected(
      applyCommand(drew, { type: 'playCard', playerId: 'p-alice', cardId: other.id }),
      'onlyDrawnCardPlayable',
    );
  });
});

describe('ending a turn', () => {
  it('is legal once a card has been drawn', () => {
    const { state: drew } = expectOk(applyCommand(table(), { type: 'drawCard', playerId: 'p-alice' }));
    const { state, events } = expectOk(applyCommand(drew, { type: 'passTurn', playerId: 'p-alice' }));
    expect(state.players[state.currentPlayerIndex]?.id).toBe('p-bob');
    expect(state.turnSeq).toBe(drew.turnSeq + 1);
    expect(state.drawnCardId).toBeNull();
    expect(events.map((event) => event.type)).toContain('turnPassed');
  });

  it('is refused before drawing — there is no free pass in UNO', () => {
    expectRejected(applyCommand(table(), { type: 'passTurn', playerId: 'p-alice' }), 'nothingToPass');
  });

  it('is legal without drawing when there is nothing anywhere left to draw', () => {
    /*
     * The one exception, and it exists to stop a deadlock rather than to bend a
     * rule: `drawCard` takes nothing from an empty pile, so refusing the pass as
     * well would leave the turn with no legal move at all.
     */
    const stuck = makeState({
      activeColor: 'red',
      discardPile: cards('red:5'),
      hands: { 'p-alice': cards('blue:3'), 'p-bob': cards('green:8') },
      drawPile: [],
    });
    const { state } = expectOk(applyCommand(stuck, { type: 'passTurn', playerId: 'p-alice' }));
    expect(state.players[state.currentPlayerIndex]?.id).toBe('p-bob');
  });
});

describe('what the drawn card reveals', () => {
  it('is never published to the table — the ids in this deck name the card', () => {
    const { state } = expectOk(applyCommand(table(), { type: 'drawCard', playerId: 'p-alice' }));
    const view = toPublicGameState(state);
    expect(view.hasDrawn).toBe(true);
    expect(JSON.stringify(view)).not.toContain(state.drawnCardId as string);
  });

  it('reaches its owner, and nobody else', () => {
    const { state } = expectOk(applyCommand(table(), { type: 'drawCard', playerId: 'p-alice' }));
    expect(toPrivateHandView(state, 'p-alice').drawnCardId).toBe(state.drawnCardId);
    // Bob is not on turn, so there is nothing of his to report.
    expect(toPrivateHandView(state, 'p-bob').drawnCardId).toBeUndefined();
  });
});
