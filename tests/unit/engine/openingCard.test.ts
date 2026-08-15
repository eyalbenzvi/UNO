import { describe, expect, it } from 'vitest';
import { buildDeck, type Card } from '../../../src/features/game/engine/cards.ts';
import { createGame } from '../../../src/features/game/engine/engine.ts';
import { expectOk, players } from '../helpers/engineFixtures.ts';

/**
 * The card turned up to start the round, and what it does to the first player.
 *
 * Five cases, and three of them move the turn before anybody has played. They are
 * checked by searching seeds for a deal that produces each opening rather than by
 * reaching into the engine, so what is asserted is what a table would actually see.
 */

/** The first seed at which the opening card is of the given kind. */
function seedFor(kind: Card['kind'], seats = 3): number {
  for (let seed = 1; seed < 4000; seed += 1) {
    const result = createGame(players('Alice', 'Bob', 'Cara').slice(0, seats), seed);
    if (result.ok) {
      const top = result.state.discardPile[result.state.discardPile.length - 1];
      if (top?.kind === kind) {
        return seed;
      }
    }
  }
  throw new Error(`no seed produced a ${kind} opening`);
}

describe('the opening card', () => {
  it('is never a wild — both kinds are buried and another is turned up', () => {
    for (let seed = 1; seed < 400; seed += 1) {
      const { state } = expectOk(createGame(players('Alice', 'Bob'), seed));
      const top = state.discardPile[state.discardPile.length - 1]!;
      expect(top.kind, `seed ${String(seed)}`).not.toBe('wild');
      expect(top.kind, `seed ${String(seed)}`).not.toBe('wildDrawFour');
    }
  });

  it('buries them rather than removing them: every card is still in the game', () => {
    for (let seed = 1; seed < 60; seed += 1) {
      const { state } = expectOk(createGame(players('Alice', 'Bob', 'Cara'), seed));
      const held = Object.values(state.hands).flat().length;
      const total = held + state.drawPile.length + state.discardPile.length;
      expect(total, `seed ${String(seed)}`).toBe(buildDeck().length);
    }
  });

  it('deals seven to everybody', () => {
    const { state } = expectOk(createGame(players('Alice', 'Bob', 'Cara'), 7));
    for (const player of state.players) {
      expect(state.hands[player.id]).toHaveLength(7);
    }
  });

  it('starts the turn counter at nought in every case', () => {
    /*
     * Load-bearing rather than tidy: clients gate a move on `turnSeq`, and the
     * catch window is measured in it. An opening Skip that moved the seat through
     * the ordinary turn machinery would start such a round one turn ahead of every
     * other one, and every window calculation in it would be off by that turn.
     */
    for (const kind of ['number', 'skip', 'reverse', 'drawTwo'] as const) {
      const { state } = expectOk(createGame(players('Alice', 'Bob', 'Cara'), seedFor(kind)));
      expect(state.turnSeq, kind).toBe(0);
    }
  });

  it('a number opens with the first player, and nothing else happens', () => {
    const { state, events } = expectOk(createGame(players('Alice', 'Bob', 'Cara'), seedFor('number')));
    expect(state.players[state.currentPlayerIndex]?.id).toBe('p-alice');
    expect(state.direction).toBe(1);
    expect(events.map((event) => event.type)).toEqual(['gameStarted', 'turnChanged']);
  });

  it('a Skip costs the first player their turn', () => {
    const { state, events } = expectOk(createGame(players('Alice', 'Bob', 'Cara'), seedFor('skip')));
    expect(state.players[state.currentPlayerIndex]?.id).toBe('p-bob');
    expect(events).toContainEqual({ type: 'playerSkipped', playerId: 'p-alice' });
  });

  it('a Draw Two costs the first player two cards and the turn', () => {
    const { state, events } = expectOk(createGame(players('Alice', 'Bob', 'Cara'), seedFor('drawTwo')));
    expect(state.hands['p-alice']).toHaveLength(9);
    expect(state.players[state.currentPlayerIndex]?.id).toBe('p-bob');
    expect(events).toContainEqual({ type: 'playerSkipped', playerId: 'p-alice' });
  });

  it('a Reverse turns the play round and hands the first turn to the dealer', () => {
    /*
     * The dealer is the seat before the one that would nominally open, because play
     * starts to the dealer's left. Official rules: on an opening Reverse the dealer
     * goes first and the player to their right is next.
     */
    const { state, events } = expectOk(createGame(players('Alice', 'Bob', 'Cara'), seedFor('reverse')));
    expect(state.direction).toBe(-1);
    expect(state.players[state.currentPlayerIndex]?.id).toBe('p-cara');
    expect(events).toContainEqual({ type: 'directionChanged', direction: -1 });
  });

  it('at two seats an opening Reverse and an opening Skip name the same player', () => {
    // A Reverse acts as a Skip when only two are playing, so the two rules have to
    // agree here or one of them is wrong.
    const reverse = expectOk(createGame(players('Alice', 'Bob'), seedFor('reverse', 2))).state;
    const skip = expectOk(createGame(players('Alice', 'Bob'), seedFor('skip', 2))).state;
    expect(reverse.players[reverse.currentPlayerIndex]?.id).toBe('p-bob');
    expect(skip.players[skip.currentPlayerIndex]?.id).toBe('p-bob');
  });

  it('names the seat that actually moves, not the one that nominally would', () => {
    const { state, events } = expectOk(createGame(players('Alice', 'Bob', 'Cara'), seedFor('skip')));
    const started = events.find((event) => event.type === 'gameStarted');
    const changed = events.find((event) => event.type === 'turnChanged');
    const opener = state.players[state.currentPlayerIndex]?.id;
    expect(started).toMatchObject({ firstPlayerId: opener });
    expect(changed).toMatchObject({ playerId: opener });
  });
});

describe('dealing', () => {
  it('is deterministic from the seed', () => {
    const a = expectOk(createGame(players('Alice', 'Bob'), 4242)).state;
    const b = expectOk(createGame(players('Alice', 'Bob'), 4242)).state;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('rotates who opens, round after round', () => {
    const openers = [0, 1, 2].map((round) => {
      const { state } = expectOk(createGame(players('Alice', 'Bob', 'Cara'), seedFor('number'), 1, round));
      return state.players[state.currentPlayerIndex]?.id;
    });
    expect(new Set(openers).size).toBeGreaterThan(1);
  });
});
