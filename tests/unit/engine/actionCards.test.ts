import { describe, expect, it } from 'vitest';
import { applyCommand } from '../../../src/features/game/engine/engine.ts';
import { cards, expectOk, makeState, players } from '../helpers/engineFixtures.ts';

/**
 * Skip, Reverse and Draw Two, at every table size that changes what they mean.
 *
 * The two-seat cases are the ones worth writing down: with two players a Reverse
 * *is* a Skip, and a Skip hands the turn straight back — which is why every
 * assertion below names the seat that ends up on turn rather than counting steps.
 */
function table(seats: string[], hand: string[], top = 'red:5') {
  const list = players(...seats);
  const hands: Record<string, ReturnType<typeof cards>> = {};
  for (const player of list) {
    hands[player.id] = player.id === list[0]!.id ? cards(...hand) : cards('green:9', 'green:8');
  }
  return makeState({
    players: list,
    currentPlayerIndex: 0,
    activeColor: 'red',
    discardPile: cards(top),
    hands,
    drawPile: cards('blue:1', 'blue:2', 'blue:3', 'blue:4', 'blue:5', 'blue:6'),
  });
}

function play(seats: string[], hand: string[]) {
  const state = table(seats, hand);
  const cardId = state.hands[state.players[0]!.id]![0]!.id;
  return expectOk(applyCommand(state, { type: 'playCard', playerId: state.players[0]!.id, cardId }));
}

describe('Skip', () => {
  it('costs the next player their turn', () => {
    const { state, events } = play(['Alice', 'Bob', 'Cara'], ['red:skip', 'red:2']);
    expect(state.players[state.currentPlayerIndex]?.id).toBe('p-cara');
    expect(events).toContainEqual({ type: 'playerSkipped', playerId: 'p-bob' });
  });

  it('hands the turn straight back at two seats', () => {
    const { state } = play(['Alice', 'Bob'], ['red:skip', 'red:2']);
    expect(state.players[state.currentPlayerIndex]?.id).toBe('p-alice');
  });

  it('moves the turn counter exactly once', () => {
    const before = table(['Alice', 'Bob', 'Cara'], ['red:skip', 'red:2']);
    const cardId = before.hands['p-alice']![0]!.id;
    const { state } = expectOk(applyCommand(before, { type: 'playCard', playerId: 'p-alice', cardId }));
    // Skipping is one handover, not two: a client's turn token and the catch window
    // are both measured in this.
    expect(state.turnSeq).toBe(before.turnSeq + 1);
  });
});

describe('Reverse', () => {
  it('turns the play round', () => {
    const { state, events } = play(['Alice', 'Bob', 'Cara'], ['red:reverse', 'red:2']);
    expect(state.direction).toBe(-1);
    expect(state.players[state.currentPlayerIndex]?.id).toBe('p-cara');
    expect(events).toContainEqual({ type: 'directionChanged', direction: -1 });
  });

  it('acts as a Skip at two seats', () => {
    /*
     * Written rather than left to fall out, and this is the test that says why:
     * turning the direction round at two seats moves the turn to the same place
     * turning it round does at any other number — the other player — so without the
     * special case the card would quietly do nothing at all.
     */
    const { state, events } = play(['Alice', 'Bob'], ['red:reverse', 'red:2']);
    expect(state.players[state.currentPlayerIndex]?.id).toBe('p-alice');
    expect(events).toContainEqual({ type: 'playerSkipped', playerId: 'p-bob' });
  });

  it('counts seats rather than who is connected', () => {
    /*
     * A three-player table with one seat temporarily absent is still a three-player
     * table. Only a seat that has *left* the round is out of the count — an empty
     * chair is not the same as an empty seat.
     */
    const state = makeState({
      players: [
        { id: 'p-alice', name: 'Alice' },
        { id: 'p-bob', name: 'Bob' },
        { id: 'p-cara', name: 'Cara', left: true },
      ],
      currentPlayerIndex: 0,
      activeColor: 'red',
      discardPile: cards('red:5'),
      hands: {
        'p-alice': cards('red:reverse', 'red:2'),
        'p-bob': cards('green:9'),
        'p-cara': cards('green:8'),
      },
    });
    const cardId = state.hands['p-alice']![0]!.id;
    const { state: next } = expectOk(applyCommand(state, { type: 'playCard', playerId: 'p-alice', cardId }));
    // Cara has left, so two seats remain and the Reverse is a Skip.
    expect(next.players[next.currentPlayerIndex]?.id).toBe('p-alice');
  });
});

describe('Draw Two', () => {
  it('makes the next player draw two and lose the turn', () => {
    const { state, events } = play(['Alice', 'Bob', 'Cara'], ['red:drawTwo', 'red:2']);
    expect(state.hands['p-bob']).toHaveLength(4);
    expect(state.players[state.currentPlayerIndex]?.id).toBe('p-cara');
    expect(events).toContainEqual({ type: 'playerSkipped', playerId: 'p-bob' });
  });

  it('cannot be answered — official UNO has no stacking', () => {
    /*
     * The penalty resolves at play time, so there is no pending run for the next
     * player to answer. Their turn simply never arrives.
     */
    const { state } = play(['Alice', 'Bob'], ['red:drawTwo', 'red:2']);
    expect(state.hands['p-bob']).toHaveLength(4);
    expect(state.players[state.currentPlayerIndex]?.id).toBe('p-alice');
  });
});

describe('Wild', () => {
  it('is playable on anything and repaints the table', () => {
    const state = table(['Alice', 'Bob'], ['wild', 'red:2'], 'green:7');
    const cardId = state.hands['p-alice']![0]!.id;
    const { state: next } = expectOk(
      applyCommand(state, { type: 'playCard', playerId: 'p-alice', cardId, chosenColor: 'blue' }),
    );
    expect(next.activeColor).toBe('blue');
    expect(next.players[next.currentPlayerIndex]?.id).toBe('p-bob');
  });

  it('may be played while holding a perfectly good colour match', () => {
    // There is no rule against spending one early; it is only usually a waste.
    const state = table(['Alice', 'Bob'], ['wild', 'red:2']);
    const cardId = state.hands['p-alice']![0]!.id;
    expectOk(applyCommand(state, { type: 'playCard', playerId: 'p-alice', cardId, chosenColor: 'green' }));
  });
});

describe('winning on a card that makes somebody draw', () => {
  it('is legal, and the victim still draws', () => {
    const state = makeState({
      players: players('Alice', 'Bob'),
      currentPlayerIndex: 0,
      activeColor: 'red',
      discardPile: cards('red:5'),
      hands: { 'p-alice': cards('red:drawTwo'), 'p-bob': cards('green:9', 'green:8') },
      drawPile: cards('blue:1', 'blue:2', 'blue:3'),
    });
    const cardId = state.hands['p-alice']![0]!.id;
    const { state: next, events } = expectOk(
      applyCommand(state, { type: 'playCard', playerId: 'p-alice', cardId }),
    );
    expect(next.phase).toBe('finished');
    expect(next.winnerId).toBe('p-alice');
    // The two cards are drawn before the round is called, so they count in the score.
    expect(next.hands['p-bob']).toHaveLength(4);
    expect(events.map((event) => event.type)).toContain('playerWon');
  });

  it('is legal on a Wild, and the colour must still be named', () => {
    const state = makeState({
      players: players('Alice', 'Bob'),
      currentPlayerIndex: 0,
      activeColor: 'red',
      discardPile: cards('red:5'),
      hands: { 'p-alice': cards('wild'), 'p-bob': cards('green:9') },
    });
    const cardId = state.hands['p-alice']![0]!.id;
    const { state: next } = expectOk(
      applyCommand(state, { type: 'playCard', playerId: 'p-alice', cardId, chosenColor: 'yellow' }),
    );
    expect(next.winnerId).toBe('p-alice');
    expect(next.activeColor).toBe('yellow');
  });
});
