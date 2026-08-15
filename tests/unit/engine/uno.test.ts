import { describe, expect, it } from 'vitest';
import { applyCommand } from '../../../src/features/game/engine/engine.ts';
import { catchableSeats, toPublicGameState } from '../../../src/features/game/engine/views.ts';
import { cards, expectOk, expectRejected, makeState, players } from '../helpers/engineFixtures.ts';

/**
 * Calling UNO, and the window in which forgetting to costs you.
 *
 * The window is the half of this rule that makes it a game: officially you are
 * safe once the next player begins their turn, so the catch is a two-second reflex
 * rather than a bounty standing for the rest of the round.
 */
function onOneCard() {
  return makeState({
    players: players('Alice', 'Bob', 'Cara'),
    currentPlayerIndex: 1,
    activeColor: 'red',
    discardPile: cards('red:5'),
    hands: {
      'p-alice': cards('blue:3'),
      'p-bob': cards('red:9', 'red:8'),
      'p-cara': cards('green:2', 'green:3'),
    },
    drawPile: cards('blue:1', 'blue:2', 'blue:4', 'blue:6', 'blue:7'),
  });
}

describe('calling UNO', () => {
  it('is legal from any seat, in or out of turn, on a single card', () => {
    const { state, events } = expectOk(
      applyCommand(onOneCard(), { type: 'declareUno', playerId: 'p-alice' }),
    );
    expect(state.declaredUno).toContain('p-alice');
    expect(events).toContainEqual({ type: 'unoDeclared', playerId: 'p-alice' });
  });

  it('is refused on any other number of cards', () => {
    expectRejected(applyCommand(onOneCard(), { type: 'declareUno', playerId: 'p-bob' }), 'nothingToDeclare');
  });

  it('cannot be made twice for the same card', () => {
    const { state } = expectOk(applyCommand(onOneCard(), { type: 'declareUno', playerId: 'p-alice' }));
    expectRejected(applyCommand(state, { type: 'declareUno', playerId: 'p-alice' }), 'alreadyDeclared');
  });

  it('closes the window it was racing', () => {
    const { state } = expectOk(applyCommand(onOneCard(), { type: 'declareUno', playerId: 'p-alice' }));
    expect(catchableSeats(state)).not.toContain('p-alice');
    expectRejected(
      applyCommand(state, { type: 'catchUno', playerId: 'p-bob', targetId: 'p-alice' }),
      'nothingToCatch',
    );
  });

  it('is owed again once the hand stops being one card', () => {
    // The call belongs to the card, not to the player: a hand that grows drops it,
    // and coming back down to one card needs a fresh one.
    const state = makeState({
      players: players('Alice', 'Bob'),
      currentPlayerIndex: 1,
      activeColor: 'red',
      discardPile: cards('red:5'),
      hands: { 'p-alice': cards('blue:3'), 'p-bob': cards('red:drawTwo', 'red:8') },
      drawPile: cards('blue:1', 'blue:2', 'blue:4'),
      declaredUno: ['p-alice'],
    });
    expect(state.declaredUno).toContain('p-alice');
    const drawTwo = state.hands['p-bob']![0]!;
    const { state: next } = expectOk(
      applyCommand(state, { type: 'playCard', playerId: 'p-bob', cardId: drawTwo.id }),
    );
    expect(next.hands['p-alice']).toHaveLength(3);
    expect(next.declaredUno).not.toContain('p-alice');
  });
});

describe('catching a silent player', () => {
  it('costs them two cards', () => {
    const { state, events } = expectOk(
      applyCommand(onOneCard(), { type: 'catchUno', playerId: 'p-bob', targetId: 'p-alice' }),
    );
    expect(state.hands['p-alice']).toHaveLength(3);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'unoCaught', playerId: 'p-alice', caughtById: 'p-bob', penalty: 2 }),
    );
  });

  it('cannot be done to yourself', () => {
    expectRejected(
      applyCommand(onOneCard(), { type: 'catchUno', playerId: 'p-alice', targetId: 'p-alice' }),
      'nothingToCatch',
    );
  });

  it('cannot be done to somebody who has left', () => {
    const state = makeState({
      players: [
        { id: 'p-alice', name: 'Alice', left: true },
        { id: 'p-bob', name: 'Bob' },
        { id: 'p-cara', name: 'Cara' },
      ],
      hands: { 'p-alice': cards('blue:3'), 'p-bob': cards('red:9', 'red:8'), 'p-cara': cards('green:2') },
    });
    expectRejected(
      applyCommand(state, { type: 'catchUno', playerId: 'p-bob', targetId: 'p-alice' }),
      'nothingToCatch',
    );
  });
});

describe('the window', () => {
  it('opens when a hand becomes a single uncalled card', () => {
    const state = makeState({
      players: players('Alice', 'Bob'),
      currentPlayerIndex: 0,
      activeColor: 'red',
      discardPile: cards('red:5'),
      hands: { 'p-alice': cards('red:9', 'red:8'), 'p-bob': cards('green:2', 'green:3') },
    });
    const cardId = state.hands['p-alice']![0]!.id;
    const { state: next } = expectOk(applyCommand(state, { type: 'playCard', playerId: 'p-alice', cardId }));
    expect(catchableSeats(next)).toEqual(['p-alice']);
  });

  it('shuts the moment the next player begins their turn', () => {
    /*
     * The official rule: caught *before the next player begins*. A draw is a
     * beginning, so the window has to close on it — not only when the next turn
     * ends, which would leave the offender exposed through the whole of it.
     */
    const exposed = onOneCard();
    expect(catchableSeats(exposed)).toContain('p-alice');
    const { state: drew } = expectOk(applyCommand(exposed, { type: 'drawCard', playerId: 'p-bob' }));
    expect(catchableSeats(drew)).not.toContain('p-alice');
    expectRejected(
      applyCommand(drew, { type: 'catchUno', playerId: 'p-cara', targetId: 'p-alice' }),
      'nothingToCatch',
    );
  });

  it('shuts on the next player playing a card', () => {
    const exposed = onOneCard();
    const cardId = exposed.hands['p-bob']![0]!.id;
    const { state } = expectOk(applyCommand(exposed, { type: 'playCard', playerId: 'p-bob', cardId }));
    expect(catchableSeats(state)).not.toContain('p-alice');
  });

  it('does not re-open on later turns', () => {
    // The stamp is made on the transition to one card, never on merely *being* on
    // one — which is what would make the window eternal.
    const exposed = onOneCard();
    const cardId = exposed.hands['p-bob']![0]!.id;
    let state = expectOk(applyCommand(exposed, { type: 'playCard', playerId: 'p-bob', cardId })).state;
    // Cara takes an ordinary turn — she holds nothing playable, so she draws and
    // passes, which is two more beginnings the window must not survive.
    state = expectOk(applyCommand(state, { type: 'drawCard', playerId: 'p-cara' })).state;
    state = expectOk(applyCommand(state, { type: 'passTurn', playerId: 'p-cara' })).state;
    expect(catchableSeats(state)).not.toContain('p-alice');
  });

  it('is published resolved, so no screen can offer a catch that has gone', () => {
    const exposed = onOneCard();
    expect(toPublicGameState(exposed).catchableUno).toEqual(['p-alice']);
    const { state: drew } = expectOk(applyCommand(exposed, { type: 'drawCard', playerId: 'p-bob' }));
    expect(toPublicGameState(drew).catchableUno).toEqual([]);
  });

  it('stays open while the turn comes straight back to the player it is open on', () => {
    /*
     * The one shape in which a player is on turn with their own window open: at two
     * seats, a Skip played as the second-to-last card hands the turn straight back.
     * Alice is down to one uncalled card and on turn again without Bob ever having
     * begun a turn — so the half of the rule that closes a window when the *next*
     * player begins has not fired, and Bob's two seconds to catch her are still
     * running. If taking her own turn back closed it, a Skip would be a free pass.
     */
    const state = makeState({
      players: players('Alice', 'Bob'),
      currentPlayerIndex: 0,
      activeColor: 'red',
      discardPile: cards('red:5'),
      hands: { 'p-alice': cards('red:skip', 'red:8'), 'p-bob': cards('green:2', 'green:3') },
      drawPile: cards('blue:1', 'blue:2', 'blue:3'),
    });
    const cardId = state.hands['p-alice']![0]!.id;
    const played = expectOk(applyCommand(state, { type: 'playCard', playerId: 'p-alice', cardId })).state;
    expect(played.currentPlayerIndex).toBe(0);
    expect(catchableSeats(played)).toContain('p-alice');

    // She draws instead of playing her last card, which is the whole of her second
    // turn — and puts her back on two, where nobody can be caught at all.
    const drew = expectOk(applyCommand(played, { type: 'drawCard', playerId: 'p-alice' })).state;
    expect(drew.hands['p-alice']).toHaveLength(2);
    expect(catchableSeats(drew)).not.toContain('p-alice');
  });
});

describe('calling it with the card', () => {
  it('is honoured when the play really does leave one card', () => {
    const state = makeState({
      players: players('Alice', 'Bob'),
      currentPlayerIndex: 0,
      activeColor: 'red',
      discardPile: cards('red:5'),
      hands: { 'p-alice': cards('red:9', 'red:8'), 'p-bob': cards('green:2') },
    });
    const cardId = state.hands['p-alice']![0]!.id;
    const { state: next } = expectOk(
      applyCommand(state, { type: 'playCard', playerId: 'p-alice', cardId, declareUno: true }),
    );
    expect(next.declaredUno).toContain('p-alice');
    expect(catchableSeats(next)).not.toContain('p-alice');
  });

  it('is ignored on a play that wins the round', () => {
    const state = makeState({
      players: players('Alice', 'Bob'),
      currentPlayerIndex: 0,
      activeColor: 'red',
      discardPile: cards('red:5'),
      hands: { 'p-alice': cards('red:9'), 'p-bob': cards('green:2') },
    });
    const cardId = state.hands['p-alice']![0]!.id;
    const { state: next } = expectOk(
      applyCommand(state, { type: 'playCard', playerId: 'p-alice', cardId, declareUno: true }),
    );
    expect(next.winnerId).toBe('p-alice');
    expect(next.declaredUno).not.toContain('p-alice');
  });
});
