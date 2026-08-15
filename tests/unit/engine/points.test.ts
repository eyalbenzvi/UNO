import { describe, expect, it } from 'vitest';
import { applyCommand } from '../../../src/features/game/engine/engine.ts';
import { computeStandings, toPublicGameState } from '../../../src/features/game/engine/views.ts';
import { cards, expectOk, makeState, players } from '../helpers/engineFixtures.ts';

/**
 * The official 500-point match: whoever goes out scores what everybody else is
 * still holding.
 *
 * The engine does the arithmetic for one round; keeping the running total is the
 * room's job, because a match outlives the rounds it is made of.
 */
function roundEndingWith(mode: 'classic' | 'points', losers: Record<string, string[]>) {
  const hands: Record<string, ReturnType<typeof cards>> = { 'p-alice': cards('red:9') };
  for (const [id, spec] of Object.entries(losers)) {
    hands[id] = cards(...spec);
  }
  return makeState({
    players: players('Alice', 'Bob', 'Cara'),
    mode,
    currentPlayerIndex: 0,
    activeColor: 'red',
    discardPile: cards('red:5'),
    hands,
  });
}

function finish(state: ReturnType<typeof roundEndingWith>) {
  const cardId = state.hands['p-alice']![0]!.id;
  return expectOk(applyCommand(state, { type: 'playCard', playerId: 'p-alice', cardId }));
}

describe('scoring a round', () => {
  it('gives the winner the sum of every other hand', () => {
    const { state, events } = finish(
      roundEndingWith('points', {
        // 7 + 20 = 27, and 50 + 3 = 53. The winner takes 80.
        'p-bob': ['blue:7', 'blue:skip'],
        'p-cara': ['wildDrawFour', 'green:3'],
      }),
    );
    expect(state.points['p-alice']).toBe(80);
    expect(state.points['p-bob']).toBe(27);
    expect(state.points['p-cara']).toBe(53);
    expect(events).toContainEqual({ type: 'roundScored', playerId: 'p-alice', points: 80 });
  });

  it('uses the official values: face value, twenty, fifty', () => {
    const { state } = finish(
      roundEndingWith('points', {
        'p-bob': ['blue:0', 'blue:9'],
        'p-cara': ['green:reverse', 'green:drawTwo', 'wild'],
      }),
    );
    expect(state.points['p-bob']).toBe(0 + 9);
    expect(state.points['p-cara']).toBe(20 + 20 + 50);
  });

  it('scores nothing at all in a classic round', () => {
    const { state, events } = finish(
      roundEndingWith('classic', { 'p-bob': ['blue:7'], 'p-cara': ['green:3'] }),
    );
    expect(state.points).toEqual({});
    expect(events.map((event) => event.type)).not.toContain('roundScored');
  });

  it('counts a seat that left: the round was won against the table as it stood', () => {
    const state = makeState({
      players: [
        { id: 'p-alice', name: 'Alice' },
        { id: 'p-bob', name: 'Bob' },
        { id: 'p-cara', name: 'Cara', left: true },
      ],
      mode: 'points',
      currentPlayerIndex: 0,
      activeColor: 'red',
      discardPile: cards('red:5'),
      hands: { 'p-alice': cards('red:9'), 'p-bob': cards('blue:7'), 'p-cara': cards('green:8') },
    });
    const cardId = state.hands['p-alice']![0]!.id;
    const { state: next } = expectOk(applyCommand(state, { type: 'playCard', playerId: 'p-alice', cardId }));
    expect(next.points['p-alice']).toBe(7 + 8);
  });

  it('scores nothing when a round is abandoned', () => {
    const state = roundEndingWith('points', { 'p-bob': ['blue:7'], 'p-cara': ['green:3'] });
    const { state: next } = expectOk(applyCommand(state, { type: 'abandonRound', playerId: 'p-alice' }));
    expect(next.points).toEqual({});
    expect(next.winnerId).toBeNull();
  });

  it('includes the cards a winning Draw Two forced on somebody', () => {
    const state = makeState({
      players: players('Alice', 'Bob'),
      mode: 'points',
      currentPlayerIndex: 0,
      activeColor: 'red',
      discardPile: cards('red:5'),
      hands: { 'p-alice': cards('red:drawTwo'), 'p-bob': [] },
      drawPile: cards('blue:9', 'blue:8'),
    });
    const cardId = state.hands['p-alice']![0]!.id;
    const { state: next } = expectOk(applyCommand(state, { type: 'playCard', playerId: 'p-alice', cardId }));
    // The two cards are drawn before the round is called, so they are in the score.
    expect(next.points['p-alice']).toBe(9 + 8);
  });
});

describe('what the standings show', () => {
  it('carries the round points beside the cards, in a points round', () => {
    const { state } = finish(
      roundEndingWith('points', { 'p-bob': ['blue:7'], 'p-cara': ['green:3', 'green:4'] }),
    );
    const rows = computeStandings(toPublicGameState(state));
    expect(rows[0]?.playerId).toBe('p-alice');
    expect(rows[0]?.roundPoints).toBe(7 + 3 + 4);
    expect(rows.find((row) => row.playerId === 'p-bob')?.roundPoints).toBe(7);
  });

  it('omits them entirely in a classic round', () => {
    const { state } = finish(roundEndingWith('classic', { 'p-bob': ['blue:7'], 'p-cara': ['green:3'] }));
    for (const row of computeStandings(toPublicGameState(state))) {
      expect(row.roundPoints).toBeUndefined();
    }
  });

  it('ranks by cards left, with ties sharing a place', () => {
    const { state } = finish(
      roundEndingWith('points', { 'p-bob': ['blue:7'], 'p-cara': ['green:3'] }),
    );
    const rows = computeStandings(toPublicGameState(state));
    expect(rows.map((row) => row.rank)).toEqual([1, 2, 2]);
  });
});
