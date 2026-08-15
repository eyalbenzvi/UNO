import { describe, expect, it } from 'vitest';
import { applyCommand } from '../../../src/features/game/engine/engine.ts';
import {
  cards,
  eventTypes,
  expectOk,
  expectRejected,
  makeState,
  players,
} from '../helpers/engineFixtures.ts';

function playFirst(state: ReturnType<typeof makeState>, playerId: string, chosenColor?: 'red' | 'blue') {
  const cardId = (state.hands[playerId] ?? [])[0]!.id;
  return applyCommand(
    state,
    chosenColor
      ? { type: 'playCard', playerId, cardId, chosenColor }
      : { type: 'playCard', playerId, cardId },
  );
}

describe('win detection', () => {
  it('ends the round when the last card is played', () => {
    const state = makeState({
      hands: { 'p-alice': cards('red:3'), 'p-bob': cards('red:1', 'blue:3') },
      discardPile: cards('red:9'),
      activeColor: 'red',
    });
    const { state: next, events } = expectOk(playFirst(state, 'p-alice'));
    expect(next.phase).toBe('finished');
    expect(next.winnerId).toBe('p-alice');
    expect(next.endReason).toBe('won');
    expect(eventTypes(events)).toEqual(['cardPlayed', 'turnChanged', 'playerWon']);
  });

  it('does not depend on having called UNO', () => {
    /*
     * The call is not what wins the round — putting the last card down is. What
     * silence costs is being caught, and only inside its own window.
     */
    const state = makeState({
      hands: { 'p-alice': cards('red:3'), 'p-bob': cards('red:1', 'blue:3') },
      discardPile: cards('red:9'),
      activeColor: 'red',
      declaredUno: [],
    });
    expect(expectOk(playFirst(state, 'p-alice')).state.winnerId).toBe('p-alice');
  });

  it('wins on a wild after naming a colour', () => {
    const state = makeState({
      hands: { 'p-alice': cards('wild'), 'p-bob': cards('red:1', 'blue:3') },
      discardPile: cards('green:9'),
      activeColor: 'green',
    });
    const { state: next } = expectOk(playFirst(state, 'p-alice', 'blue'));
    expect(next.winnerId).toBe('p-alice');
    expect(next.activeColor).toBe('blue');
  });

  it('clears everything the round was holding open', () => {
    const state = makeState({
      hands: { 'p-alice': cards('red:3'), 'p-bob': cards('red:1') },
      discardPile: cards('red:9'),
      activeColor: 'red',
    });
    const { state: next } = expectOk(playFirst(state, 'p-alice'));
    expect(next.challenge).toBeNull();
    expect(next.drawnCardId).toBeNull();
    expect(next.unoExposed).toEqual({});
  });

  it('locks the round after a win', () => {
    const state = makeState({
      hands: { 'p-alice': cards('red:3'), 'p-bob': cards('red:1') },
      discardPile: cards('red:9'),
      activeColor: 'red',
    });
    const { state: next } = expectOk(playFirst(state, 'p-alice'));
    expectRejected(applyCommand(next, { type: 'drawCard', playerId: 'p-bob' }), 'gameFinished');
    expectRejected(applyCommand(next, { type: 'declareUno', playerId: 'p-bob' }), 'gameFinished');
  });

  it('does not end the round while cards remain', () => {
    const state = makeState({
      hands: { 'p-alice': cards('red:3', 'red:4'), 'p-bob': cards('red:1') },
      discardPile: cards('red:9'),
      activeColor: 'red',
    });
    const { state: next } = expectOk(playFirst(state, 'p-alice'));
    expect(next.phase).toBe('playing');
    expect(next.winnerId).toBeNull();
  });
});

describe('a round that is stopped rather than won', () => {
  it('ends with no winner and every hand intact', () => {
    const before = makeState({
      players: players('Alice', 'Bob', 'Carol'),
      hands: {
        'p-alice': cards('red:3', 'red:4'),
        'p-bob': cards('blue:1'),
        'p-carol': cards('green:2', 'green:5'),
      },
    });
    const { state, events } = expectOk(applyCommand(before, { type: 'abandonRound', playerId: 'p-bob' }));
    expect(state.phase).toBe('finished');
    expect(state.winnerId).toBeNull();
    expect(state.endReason).toBe('abandoned');
    expect(state.hands).toEqual(before.hands);
    expect(eventTypes(events)).toEqual(['roundAbandoned']);
  });

  it('marks nobody as having left', () => {
    const before = makeState({ players: players('Alice', 'Bob', 'Carol') });
    const { state } = expectOk(applyCommand(before, { type: 'abandonRound', playerId: 'p-bob' }));
    for (const player of state.players) {
      expect(player.left).not.toBe(true);
    }
  });
});
