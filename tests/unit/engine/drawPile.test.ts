import { describe, expect, it } from 'vitest';
import { applyCommand, currentPlayer, topCard } from '../../../src/features/game/engine/engine.ts';
import {
  cards,
  eventTypes,
  expectOk,
  expectRejected,
  makeState,
  players,
} from '../helpers/engineFixtures.ts';

describe('draw pile recycling', () => {
  it('recycles the discard pile, keeping the visible top card', () => {
    const discard = cards('red:9', 'red:3', 'blue:3', 'green:3', 'yellow:3');
    const state = makeState({
      hands: { 'p-alice': cards('blue:8'), 'p-bob': cards('red:1') },
      drawPile: [],
      discardPile: discard,
      activeColor: 'yellow',
    });

    const { state: next, events } = expectOk(applyCommand(state, { type: 'drawCard', playerId: 'p-alice' }));

    // No `turnChanged`: drawing does not end a turn in UNO.
    expect(eventTypes(events)).toEqual(['drawPileRecycled', 'cardDrawn']);
    expect(topCard(next)?.id).toBe(discard.at(-1)!.id);
    expect(next.discardPile).toHaveLength(1);
    // Four cards were recycled, one of which was immediately drawn.
    expect(next.drawPile).toHaveLength(3);
    expect(next.hands['p-alice']).toHaveLength(2);
  });

  it('conserves every card while recycling', () => {
    const state = makeState({
      hands: { 'p-alice': cards('blue:8'), 'p-bob': cards('red:1') },
      drawPile: [],
      discardPile: cards('red:9', 'red:3', 'blue:3'),
    });
    const before = new Set(
      [
        ...state.drawPile,
        ...state.discardPile,
        ...(state.hands['p-alice'] ?? []),
        ...(state.hands['p-bob'] ?? []),
      ].map((card) => card.id),
    );
    const next = expectOk(applyCommand(state, { type: 'drawCard', playerId: 'p-alice' })).state;
    const after = new Set(
      [
        ...next.drawPile,
        ...next.discardPile,
        ...(next.hands['p-alice'] ?? []),
        ...(next.hands['p-bob'] ?? []),
      ].map((card) => card.id),
    );
    expect(after).toEqual(before);
  });

  it('recycles deterministically for a given rng state', () => {
    const build = () =>
      makeState({
        hands: { 'p-alice': cards('blue:8'), 'p-bob': cards('red:1') },
        drawPile: [],
        discardPile: cards('red:9', 'red:3', 'blue:3', 'green:4', 'yellow:5'),
      });
    const a = expectOk(applyCommand(build(), { type: 'drawCard', playerId: 'p-alice' })).state;
    const b = expectOk(applyCommand(build(), { type: 'drawCard', playerId: 'p-alice' })).state;
    expect(a.drawPile.map((card) => card.id.split('#')[0])).toEqual(
      b.drawPile.map((card) => card.id.split('#')[0]),
    );
  });

  it('advances the rng state when recycling', () => {
    const state = makeState({
      hands: { 'p-alice': cards('blue:8'), 'p-bob': cards('red:1') },
      drawPile: [],
      discardPile: cards('red:9', 'red:3', 'blue:3'),
    });
    const next = expectOk(applyCommand(state, { type: 'drawCard', playerId: 'p-alice' })).state;
    expect(next.rng.seed).not.toBe(state.rng.seed);
  });
});

describe('exhausted draw pile', () => {
  function spent() {
    return makeState({
      hands: { 'p-alice': cards('blue:8'), 'p-bob': cards('red:1') },
      drawPile: [],
      discardPile: cards('red:9'),
      activeColor: 'red',
    });
  }

  it('refuses the draw rather than accepting one that takes no card', () => {
    /*
     * Accepted, this was a move that changed nothing and could be made for ever: a
     * draw that takes no card leaves `drawnCardId` empty, so the command stays
     * legal — and every acceptance bumps the version and resets the deadlines that
     * exist to rescue a stalled seat. The screen never offers it, and the robots do
     * not ask for it, but neither of those is the wire.
     */
    expectRejected(applyCommand(spent(), { type: 'drawCard', playerId: 'p-alice' }), 'pileSpent');
  });

  it('lets the turn end anyway, which is the only move left', () => {
    /*
     * The one case where passing is legal without having drawn. Refusing this as
     * well would leave the turn with no legal move at all, which is the deadlock the
     * exception exists to prevent.
     */
    const { state: next } = expectOk(applyCommand(spent(), { type: 'passTurn', playerId: 'p-alice' }));
    expect(currentPlayer(next)?.id).toBe('p-bob');
  });

  it('still reports exhaustion when a penalty empties it mid-draw', () => {
    // The event has to survive the refusal above: a Draw Two against a pile with one
    // card in it is a draw nobody asked for, and the table is told what happened.
    const state = makeState({
      players: players('Alice', 'Bob'),
      currentPlayerIndex: 0,
      activeColor: 'red',
      discardPile: cards('red:9'),
      hands: { 'p-alice': cards('red:drawTwo', 'blue:8'), 'p-bob': cards('green:1') },
      drawPile: [],
    });
    const cardId = state.hands['p-alice']![0]!.id;
    const { events } = expectOk(applyCommand(state, { type: 'playCard', playerId: 'p-alice', cardId }));
    expect(eventTypes(events)).toContain('drawPileExhausted');
  });
});
