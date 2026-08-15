import { describe, expect, it } from 'vitest';
import { activePlayers, applyCommand, currentPlayer } from '../../../src/features/game/engine/engine.ts';
import type { GameState } from '../../../src/features/game/engine/state.ts';
import {
  cards,
  eventTypes,
  expectOk,
  expectRejected,
  makeState,
  players,
} from '../helpers/engineFixtures.ts';

/**
 * The rules for a player who is not there.
 *
 * Two properties are asserted throughout, because they are the ones whose failure
 * is unrecoverable rather than merely annoying:
 *
 * - **the table never stops** — after any absence transition somebody live is on
 *   turn, or the round is over;
 * - **cards are conserved** — a skip or a departure never creates or destroys a
 *   card, so the draw pile count on screen always means what it says.
 */

function totalCards(state: GameState): number {
  const inHands = Object.values(state.hands).reduce((sum, hand) => sum + hand.length, 0);
  return inHands + state.drawPile.length + state.discardPile.length;
}

function expectTableMoves(state: GameState): void {
  if (state.phase === 'finished') {
    return;
  }
  if (state.challenge !== null) {
    // A challenge window is a legitimate pause, but only if the seat it names is
    // still in the round and can therefore end it.
    const target = state.players.find((player) => player.id === state.challenge?.targetId);
    expect(target, 'the seat being waited for must still exist').toBeDefined();
    expect(target?.left).not.toBe(true);
    return;
  }
  const onTurn = currentPlayer(state);
  expect(onTurn, 'somebody must be on turn').not.toBeNull();
  expect(onTurn?.left).not.toBe(true);
}

function threeSeats(overrides: Parameters<typeof makeState>[0] = {}) {
  return makeState({
    players: players('Alice', 'Bob', 'Carol'),
    currentPlayerIndex: 0,
    activeColor: 'red',
    discardPile: cards('red:5'),
    hands: {
      'p-alice': cards('blue:3', 'blue:4'),
      'p-bob': cards('green:6', 'green:7'),
      'p-carol': cards('yellow:8', 'yellow:9'),
    },
    drawPile: cards('red:1', 'red:2', 'red:3', 'red:4', 'red:6', 'red:7'),
    ...overrides,
  });
}

describe('skipping the turn of a player who is away', () => {
  it('costs them the card the turn itself would have cost', () => {
    const before = threeSeats();
    const { state, events } = expectOk(applyCommand(before, { type: 'skipTurn', playerId: 'p-alice' }));
    expect(state.hands['p-alice']).toHaveLength(3);
    expect(state.players[state.currentPlayerIndex]?.id).toBe('p-bob');
    expect(events).toContainEqual({ type: 'turnSkipped', playerId: 'p-alice', drew: 1 });
    expect(totalCards(state)).toBe(totalCards(before));
    expectTableMoves(state);
  });

  it('charges nothing further to a seat that had already drawn', () => {
    /*
     * They have taken their card. Charging a second would punish somebody for the
     * moment their phone chose to die, which is the opposite of holding a seat.
     */
    const drew = expectOk(applyCommand(threeSeats(), { type: 'drawCard', playerId: 'p-alice' })).state;
    expect(drew.hands['p-alice']).toHaveLength(3);
    const { state, events } = expectOk(applyCommand(drew, { type: 'skipTurn', playerId: 'p-alice' }));
    expect(state.hands['p-alice']).toHaveLength(3);
    expect(events).toContainEqual({ type: 'turnSkipped', playerId: 'p-alice', drew: 0 });
    expect(state.drawnCardId).toBeNull();
    expectTableMoves(state);
  });

  it('refuses to skip somebody the table is not waiting for', () => {
    expectRejected(applyCommand(threeSeats(), { type: 'skipTurn', playerId: 'p-bob' }), 'nothingToSkip');
  });

  it('still passes the turn when there is no card left to charge', () => {
    const before = threeSeats({ drawPile: [], discardPile: cards('red:5') });
    const { state, events } = expectOk(applyCommand(before, { type: 'skipTurn', playerId: 'p-alice' }));
    expect(eventTypes(events)).toContain('drawPileExhausted');
    expect(state.players[state.currentPlayerIndex]?.id).toBe('p-bob');
    expect(totalCards(state)).toBe(totalCards(before));
    expectTableMoves(state);
  });

  it('takes the cards for a seat that is not there to answer a challenge', () => {
    /*
     * A skip is free in this game, but a penalty somebody else created is paid in
     * full — or pulling the plug becomes the cheapest answer to a Wild Draw Four.
     */
    const before = threeSeats({
      challenge: { playerId: 'p-alice', targetId: 'p-bob', color: 'red', bluffed: true },
    });
    const { state } = expectOk(applyCommand(before, { type: 'skipTurn', playerId: 'p-bob' }));
    expect(state.hands['p-bob']).toHaveLength(6);
    expect(state.challenge).toBeNull();
    expect(totalCards(state)).toBe(totalCards(before));
    expectTableMoves(state);
  });

  it('refuses to answer a challenge on behalf of a seat it is not addressed to', () => {
    const before = threeSeats({
      challenge: { playerId: 'p-alice', targetId: 'p-bob', color: 'red', bluffed: false },
    });
    expectRejected(applyCommand(before, { type: 'skipTurn', playerId: 'p-carol' }), 'nothingToSkip');
  });
});

describe('a player who leaves the round', () => {
  it('keeps their seat, their cards and their place in the standings', () => {
    const before = threeSeats();
    const { state } = expectOk(applyCommand(before, { type: 'leaveGame', playerId: 'p-bob' }));
    expect(state.players).toHaveLength(3);
    expect(state.players.find((player) => player.id === 'p-bob')?.left).toBe(true);
    // Frozen, not destroyed: no reshuffle, and the count still comes out right.
    expect(state.hands['p-bob']).toHaveLength(2);
    expect(totalCards(state)).toBe(totalCards(before));
    expect(activePlayers(state)).toHaveLength(2);
  });

  it('steps over them when the turn comes round', () => {
    const left = expectOk(applyCommand(threeSeats(), { type: 'leaveGame', playerId: 'p-bob' })).state;
    const { state } = expectOk(applyCommand(left, { type: 'skipTurn', playerId: 'p-alice' }));
    expect(state.players[state.currentPlayerIndex]?.id).toBe('p-carol');
    expectTableMoves(state);
  });

  it('moves the turn on when the player on turn is the one leaving', () => {
    const before = threeSeats();
    const { state } = expectOk(applyCommand(before, { type: 'leaveGame', playerId: 'p-alice' }));
    expect(state.players[state.currentPlayerIndex]?.id).toBe('p-bob');
    expectTableMoves(state);
  });

  it('does not shift the turn onto the wrong player when an earlier seat goes', () => {
    const before = threeSeats({ currentPlayerIndex: 2 });
    const { state } = expectOk(applyCommand(before, { type: 'leaveGame', playerId: 'p-alice' }));
    // Carol was on turn and still is: marking a seat rather than splicing it out is
    // what keeps `currentPlayerIndex` meaning what it meant.
    expect(state.players[state.currentPlayerIndex]?.id).toBe('p-carol');
    expectTableMoves(state);
  });

  it('cancels a challenge whose author has left rather than charging the table', () => {
    const before = threeSeats({
      challenge: { playerId: 'p-alice', targetId: 'p-bob', color: 'red', bluffed: true },
    });
    const { state } = expectOk(applyCommand(before, { type: 'leaveGame', playerId: 'p-alice' }));
    expect(state.challenge).toBeNull();
    // Nobody drew: there is no longer anybody to have bluffed.
    expect(state.hands['p-bob']).toHaveLength(2);
    expect(totalCards(state)).toBe(totalCards(before));
    expectTableMoves(state);
  });

  it('releases a challenge window that was waiting on them', () => {
    const before = threeSeats({
      challenge: { playerId: 'p-alice', targetId: 'p-bob', color: 'red', bluffed: false },
    });
    const { state } = expectOk(applyCommand(before, { type: 'leaveGame', playerId: 'p-bob' }));
    expect(state.challenge).toBeNull();
    // Their hand is frozen out of play, so there is nothing to add four cards to.
    expect(state.hands['p-bob']).toHaveLength(2);
    expect(totalCards(state)).toBe(totalCards(before));
    expectTableMoves(state);
  });

  it('ends the round with no winner when too few players are left', () => {
    const left = expectOk(applyCommand(threeSeats(), { type: 'leaveGame', playerId: 'p-bob' })).state;
    const { state, events } = expectOk(applyCommand(left, { type: 'leaveGame', playerId: 'p-carol' }));
    expect(state.phase).toBe('finished');
    expect(state.winnerId).toBeNull();
    expect(state.endReason).toBe('abandoned');
    expect(eventTypes(events)).toContain('roundAbandoned');
  });

  it('cannot be caught on their last card once they have gone', () => {
    const before = threeSeats({
      hands: {
        'p-alice': cards('blue:3', 'blue:4'),
        'p-bob': cards('green:6'),
        'p-carol': cards('yellow:8', 'yellow:9'),
      },
    });
    const { state } = expectOk(applyCommand(before, { type: 'leaveGame', playerId: 'p-bob' }));
    expectRejected(
      applyCommand(state, { type: 'catchUno', playerId: 'p-alice', targetId: 'p-bob' }),
      'nothingToCatch',
    );
  });

  it('cannot act again', () => {
    const left = expectOk(applyCommand(threeSeats(), { type: 'leaveGame', playerId: 'p-bob' })).state;
    expectRejected(applyCommand(left, { type: 'drawCard', playerId: 'p-bob' }), 'alreadyLeft');
    expectRejected(applyCommand(left, { type: 'leaveGame', playerId: 'p-bob' }), 'alreadyLeft');
  });

  it('is stepped over by a Skip rather than wasting the card', () => {
    const before = threeSeats({
      hands: {
        'p-alice': cards('red:skip', 'blue:4'),
        'p-bob': cards('green:6', 'green:7'),
        'p-carol': cards('yellow:8', 'yellow:9'),
      },
    });
    const left = expectOk(applyCommand(before, { type: 'leaveGame', playerId: 'p-bob' })).state;
    const skip = left.hands['p-alice']![0]!;
    const { state, events } = expectOk(
      applyCommand(left, { type: 'playCard', playerId: 'p-alice', cardId: skip.id }),
    );
    // Carol is skipped, not Bob: the card must not be spent on an empty seat.
    expect(events).toContainEqual({ type: 'playerSkipped', playerId: 'p-carol' });
    expect(state.players[state.currentPlayerIndex]?.id).toBe('p-alice');
    expectTableMoves(state);
  });
});

describe('the turn counter', () => {
  it('moves only when the turn does', () => {
    const before = threeSeats({
      hands: {
        'p-alice': cards('blue:3', 'blue:4'),
        'p-bob': cards('green:6'),
        'p-carol': cards('yellow:8', 'yellow:9'),
      },
    });
    // A call and a catch are shouts rather than moves, so neither touches it.
    const called = expectOk(applyCommand(before, { type: 'declareUno', playerId: 'p-bob' })).state;
    expect(called.turnSeq).toBe(before.turnSeq);
    expect(called.version).toBe(before.version + 1);

    // Drawing does not end a turn, so it does not move it either.
    const drew = expectOk(applyCommand(called, { type: 'drawCard', playerId: 'p-alice' })).state;
    expect(drew.turnSeq).toBe(before.turnSeq);

    // Ending the turn does.
    const passed = expectOk(applyCommand(drew, { type: 'passTurn', playerId: 'p-alice' })).state;
    expect(passed.turnSeq).toBe(before.turnSeq + 1);
  });
});
