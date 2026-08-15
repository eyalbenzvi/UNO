import { describe, expect, it } from 'vitest';
import { applyCommand } from '../../../src/features/game/engine/engine.ts';
import { isWildDrawFourHonest } from '../../../src/features/game/engine/rules.ts';
import { UNO_PENALTY, WILD_DRAW_FOUR_PENALTY } from '../../../src/features/game/engine/cards.ts';
import { catchableSeats, toPublicGameState } from '../../../src/features/game/engine/views.ts';
import { card, cards, expectOk, expectRejected, makeState, players } from '../helpers/engineFixtures.ts';

/**
 * The Wild Draw Four and the challenge that answers it.
 *
 * The subtlest card in UNO and the one clones get wrong most reliably, so the
 * cases below are written against the rule rather than against the implementation:
 * a bluff is legal, the verdict is judged on the colour that was *leading* when the
 * card went down, and a wrong accusation costs six.
 */
describe('playing a Wild Draw Four', () => {
  it('is legal even while holding the colour in play — the bluff is the point', () => {
    const state = makeState({
      players: players('Alice', 'Bob'),
      activeColor: 'red',
      discardPile: cards('red:5'),
      hands: { 'p-alice': cards('wildDrawFour', 'red:9'), 'p-bob': cards('blue:3', 'blue:4') },
    });
    const wild = state.hands['p-alice']![0]!;
    const { state: next } = expectOk(
      applyCommand(state, {
        type: 'playCard',
        playerId: 'p-alice',
        cardId: wild.id,
        chosenColor: 'green',
      }),
    );
    // A gate here would make the challenge unreachable, and with it the card.
    expect(next.challenge).not.toBeNull();
    expect(next.challenge?.bluffed).toBe(true);
  });

  it('names the colour play continues in, whoever ends up drawing', () => {
    const state = makeState({
      players: players('Alice', 'Bob'),
      activeColor: 'red',
      discardPile: cards('red:5'),
      hands: { 'p-alice': cards('wildDrawFour', 'blue:9'), 'p-bob': cards('blue:3', 'blue:4') },
    });
    const wild = state.hands['p-alice']![0]!;
    const { state: played } = expectOk(
      applyCommand(state, {
        type: 'playCard',
        playerId: 'p-alice',
        cardId: wild.id,
        chosenColor: 'green',
      }),
    );
    expect(played.activeColor).toBe('green');
    const { state: after } = expectOk(
      applyCommand(played, { type: 'challengeWildDrawFour', playerId: 'p-bob' }),
    );
    // A challenge decides who draws, never what is led.
    expect(after.activeColor).toBe('green');
  });

  it('refuses a colour choice that is missing, and one that is not asked for', () => {
    const state = makeState({
      hands: { 'p-alice': cards('wildDrawFour', 'red:9'), 'p-bob': cards('blue:3') },
      discardPile: cards('red:5'),
    });
    const wild = state.hands['p-alice']![0]!;
    expectRejected(
      applyCommand(state, { type: 'playCard', playerId: 'p-alice', cardId: wild.id }),
      'colorRequired',
    );
    const plain = state.hands['p-alice']![1]!;
    expectRejected(
      applyCommand(state, {
        type: 'playCard',
        playerId: 'p-alice',
        cardId: plain.id,
        chosenColor: 'green',
      }),
      'colorNotAllowed',
    );
  });

  it('freezes the table: nobody else may move while it waits', () => {
    const state = makeState({
      players: players('Alice', 'Bob', 'Cara'),
      challenge: { playerId: 'p-alice', targetId: 'p-bob', color: 'red', bluffed: false },
      currentPlayerIndex: 0,
      hands: {
        'p-alice': cards('red:2', 'red:3'),
        'p-bob': cards('red:4', 'red:5'),
        'p-cara': cards('red:6', 'red:7'),
      },
    });
    expectRejected(applyCommand(state, { type: 'drawCard', playerId: 'p-cara' }), 'awaitingChallenge');
    const caraCard = state.hands['p-cara']![0]!;
    expectRejected(
      applyCommand(state, { type: 'playCard', playerId: 'p-cara', cardId: caraCard.id }),
      'awaitingChallenge',
    );
    // And only the target may answer it.
    expectRejected(
      applyCommand(state, { type: 'acceptWildDrawFour', playerId: 'p-cara' }),
      'notTheChallenger',
    );
  });
});

describe('the verdict', () => {
  /*
   * The ordering trap, and the reason it has a test of its own.
   *
   * The question is "could you have followed the colour that was in play", so it
   * has to be asked before the card repaints the table. Asked afterwards it becomes
   * "do you hold the colour you just chose", which a player naming their own
   * strongest colour answers yes to almost every time — so every bluff would be
   * exonerated and the challenge would be a coin the challenger always loses.
   */
  it('is judged on the colour that was leading, not the one just chosen', () => {
    const state = makeState({
      players: players('Alice', 'Bob'),
      activeColor: 'red',
      discardPile: cards('red:5'),
      // Holds a red — so this is a bluff — and names green, a colour they hold none of.
      hands: { 'p-alice': cards('wildDrawFour', 'red:9'), 'p-bob': cards('blue:3') },
    });
    const wild = state.hands['p-alice']![0]!;
    const { state: next } = expectOk(
      applyCommand(state, {
        type: 'playCard',
        playerId: 'p-alice',
        cardId: wild.id,
        chosenColor: 'green',
      }),
    );
    expect(next.challenge?.bluffed).toBe(true);
  });

  it('is honest when the hand held no card of the leading colour', () => {
    const state = makeState({
      players: players('Alice', 'Bob'),
      activeColor: 'red',
      discardPile: cards('red:5'),
      hands: { 'p-alice': cards('wildDrawFour', 'blue:9', 'green:2'), 'p-bob': cards('blue:3') },
    });
    const wild = state.hands['p-alice']![0]!;
    const { state: next } = expectOk(
      applyCommand(state, {
        type: 'playCard',
        playerId: 'p-alice',
        cardId: wild.id,
        chosenColor: 'blue',
      }),
    );
    expect(next.challenge?.bluffed).toBe(false);
  });

  it('counts colour only — a matching number or symbol does not make it a bluff', () => {
    // Holding a blue 5 against a red 5 is a legal play by symbol, and irrelevant
    // here: the rule asks about the colour and nothing else.
    expect(isWildDrawFourHonest(cards('blue:5', 'wildDrawFour'), 'red', 'nope')).toBe(true);
    expect(isWildDrawFourHonest(cards('blue:skip'), 'red', 'nope')).toBe(true);
  });

  it('never counts a wild in hand as a colour match', () => {
    // A hand of nothing but wilds is an honest hand: they have no colour to follow with.
    expect(isWildDrawFourHonest(cards('wild', 'wildDrawFour'), 'red', 'nope')).toBe(true);
  });

  it('ignores the card being played', () => {
    const hand = cards('wildDrawFour');
    expect(isWildDrawFourHonest(hand, 'red', hand[0]!.id)).toBe(true);
  });
});

describe('answering it', () => {
  function open(bluffed: boolean) {
    return makeState({
      players: players('Alice', 'Bob', 'Cara'),
      currentPlayerIndex: 0,
      activeColor: 'green',
      discardPile: cards('red:5'),
      challenge: { playerId: 'p-alice', targetId: 'p-bob', color: 'red', bluffed },
      hands: {
        'p-alice': cards('red:2', 'red:3'),
        'p-bob': cards('red:4', 'red:5'),
        'p-cara': cards('red:6', 'red:7'),
      },
      drawPile: cards('blue:1', 'blue:2', 'blue:3', 'blue:4', 'blue:5', 'blue:6', 'blue:7', 'blue:8'),
    });
  }

  it('taken: the victim draws four and loses the turn', () => {
    const { state, events } = expectOk(
      applyCommand(open(false), { type: 'acceptWildDrawFour', playerId: 'p-bob' }),
    );
    expect(state.hands['p-bob']).toHaveLength(6);
    expect(state.challenge).toBeNull();
    // Past Bob, to Cara.
    expect(state.players[state.currentPlayerIndex]?.id).toBe('p-cara');
    expect(events.map((event) => event.type)).toContain('challengeDeclined');
  });

  it('called and it was a bluff: the player draws four, and the challenger keeps their turn', () => {
    const { state, events } = expectOk(
      applyCommand(open(true), { type: 'challengeWildDrawFour', playerId: 'p-bob' }),
    );
    expect(state.hands['p-alice']).toHaveLength(6);
    expect(state.hands['p-bob']).toHaveLength(2);
    expect(state.players[state.currentPlayerIndex]?.id).toBe('p-bob');
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'challengeResolved', bluffed: true, drawn: 4 }),
    );
  });

  it('called wrongly: the challenger draws six and still loses the turn', () => {
    const { state, events } = expectOk(
      applyCommand(open(false), { type: 'challengeWildDrawFour', playerId: 'p-bob' }),
    );
    expect(state.hands['p-bob']).toHaveLength(8);
    expect(state.hands['p-alice']).toHaveLength(2);
    expect(state.players[state.currentPlayerIndex]?.id).toBe('p-cara');
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'challengeResolved', bluffed: false, drawn: 6 }),
    );
  });

  it('advances the turn exactly once, however it is answered', () => {
    for (const [command, bluffed] of [
      ['acceptWildDrawFour', false],
      ['challengeWildDrawFour', true],
      ['challengeWildDrawFour', false],
    ] as const) {
      const before = open(bluffed);
      const { state } = expectOk(applyCommand(before, { type: command, playerId: 'p-bob' }));
      expect(state.turnSeq, `${command} / ${String(bluffed)}`).toBe(before.turnSeq + 1);
    }
  });

  it('refuses an answer when no challenge is open', () => {
    const plain = makeState({ hands: { 'p-alice': cards('red:2'), 'p-bob': cards('red:3') } });
    expectRejected(
      applyCommand(plain, { type: 'acceptWildDrawFour', playerId: 'p-alice' }),
      'noChallengeOpen',
    );
  });
});

describe('the two shouts, while the table is frozen', () => {
  /*
   * Calling UNO and catching somebody are legal at any moment, an open challenge
   * included — they race each other on purpose, and gating them on the turn would
   * hand every tie to whoever broke the rule. `docs/rules.md` spends a paragraph on
   * the consequence, and this is the shape that produces it: a player whose Wild
   * Draw Four was their *second-to-last* card is left on one, and stamped
   * catchable, at the same instant the table freezes behind her. So a catch really
   * can add two cards to the very hand the challenge will be judged against — and
   * the verdict, decided when the card was laid, must not move for it. A bluffer
   * must not be exonerated by being caught out, nor an honest player condemned.
   */
  function frozen() {
    const state = makeState({
      players: players('Alice', 'Bob', 'Cara'),
      currentPlayerIndex: 0,
      activeColor: 'red',
      discardPile: cards('red:9'),
      hands: {
        'p-alice': cards('wildDrawFour', 'red:2'),
        'p-bob': cards('blue:3', 'blue:4'),
        'p-cara': cards('green:5', 'green:6'),
      },
      drawPile: cards('blue:1', 'blue:2', 'blue:5', 'blue:6', 'blue:7', 'blue:8', 'yellow:1'),
    });
    const cardId = state.hands['p-alice']![0]!.id;
    return expectOk(
      applyCommand(state, { type: 'playCard', playerId: 'p-alice', cardId, chosenColor: 'green' }),
    ).state;
  }

  it('lets the player who laid it call UNO, from under the window it opened', () => {
    const open = frozen();
    expect(catchableSeats(open)).toContain('p-alice');
    const { state } = expectOk(applyCommand(open, { type: 'declareUno', playerId: 'p-alice' }));
    expect(state.declaredUno).toContain('p-alice');
    expect(state.challenge).not.toBeNull();
    expect(catchableSeats(state)).not.toContain('p-alice');
  });

  it('lets her be caught, and does not move the verdict when she is', () => {
    const open = frozen();
    const { state: caught } = expectOk(
      applyCommand(open, { type: 'catchUno', playerId: 'p-bob', targetId: 'p-alice' }),
    );
    expect(caught.hands['p-alice']).toHaveLength(1 + UNO_PENALTY);
    expect(caught.challenge).toEqual(open.challenge);

    /*
     * And the bluff still stands. Alice held a red 2 when she laid the card, which
     * is the only moment that counts — the two cards the catch has just put in her
     * hand are not evidence, and re-deriving the verdict here would let a player
     * launder a bluff by being caught out.
     */
    const { state: called } = expectOk(
      applyCommand(caught, { type: 'challengeWildDrawFour', playerId: 'p-bob' }),
    );
    expect(called.hands['p-alice']).toHaveLength(1 + UNO_PENALTY + WILD_DRAW_FOUR_PENALTY);
  });

  it('lets the seat it is aimed at answer, and nobody else', () => {
    const open = frozen();
    expectRejected(
      applyCommand(open, { type: 'challengeWildDrawFour', playerId: 'p-cara' }),
      'notTheChallenger',
    );
    expectRejected(
      applyCommand(open, { type: 'acceptWildDrawFour', playerId: 'p-cara' }),
      'notTheChallenger',
    );
    const { state } = expectOk(applyCommand(open, { type: 'challengeWildDrawFour', playerId: 'p-bob' }));
    expect(state.challenge).toBeNull();
  });
});

describe('what the table is told', () => {
  /*
   * The colour published is the one the challenge is *about*, not the one the card
   * named — and the two are almost never the same, because an honest Wild Draw Four
   * is played precisely when its owner cannot follow the colour in play.
   *
   * This is the fact the target has to decide on, and it is gone from the table by
   * the time they see the prompt: `activeColor` has already moved to the chosen
   * colour. Publishing that instead asks "were you holding the colour you named?",
   * which is a question nobody can answer yes to honestly, and it was on screen.
   */
  it('names the colour the rule is judged against, not the one the card chose', () => {
    const state = makeState({
      players: players('Alice', 'Bob'),
      currentPlayerIndex: 0,
      activeColor: 'red',
      discardPile: cards('red:9'),
      hands: { 'p-alice': cards('wildDrawFour', 'red:2'), 'p-bob': cards('blue:3') },
      drawPile: cards('blue:1', 'blue:2', 'blue:4', 'blue:5', 'blue:6'),
    });
    const cardId = state.hands['p-alice']![0]!.id;
    const { state: next, events } = expectOk(
      applyCommand(state, { type: 'playCard', playerId: 'p-alice', cardId, chosenColor: 'green' }),
    );

    const view = toPublicGameState(next);
    expect(view.activeColor).toBe('green');
    expect(view.challenge?.color).toBe('red');
    expect(events).toContainEqual({
      type: 'challengeOpened',
      playerId: 'p-alice',
      targetId: 'p-bob',
      color: 'red',
    });

    // And it is the colour the verdict was actually reached on: Alice held a red 2.
    const { state: called } = expectOk(
      applyCommand(next, { type: 'challengeWildDrawFour', playerId: 'p-bob' }),
    );
    expect(called.hands['p-alice']).toHaveLength(1 + WILD_DRAW_FOUR_PENALTY);
  });

  it('publishes both seats and the colour, and never the verdict', () => {
    const state = makeState({
      challenge: { playerId: 'p-alice', targetId: 'p-bob', color: 'red', bluffed: true },
    });
    const view = toPublicGameState(state);
    expect(view.challenge).toEqual({ playerId: 'p-alice', targetId: 'p-bob', color: 'red' });
    // Whether it was a bluff is the whole question the challenge exists to ask.
    expect(JSON.stringify(view)).not.toContain('bluffed');
  });
});

describe('a Wild Draw Four as the last card', () => {
  it('opens the window first, and the round ends only once it is answered', () => {
    const state = makeState({
      players: players('Alice', 'Bob'),
      activeColor: 'blue',
      discardPile: cards('blue:5'),
      hands: { 'p-alice': [card('wildDrawFour')], 'p-bob': cards('red:3', 'red:4') },
      drawPile: cards('green:1', 'green:2', 'green:3', 'green:4', 'green:5', 'green:6'),
    });
    const wild = state.hands['p-alice']![0]!;
    const { state: played } = expectOk(
      applyCommand(state, {
        type: 'playCard',
        playerId: 'p-alice',
        cardId: wild.id,
        chosenColor: 'red',
      }),
    );
    // The hand is empty but the round is not over: four cards are still owed.
    expect(played.hands['p-alice']).toHaveLength(0);
    expect(played.phase).toBe('playing');
    expect(played.winnerId).toBeNull();

    const { state: done, events } = expectOk(
      applyCommand(played, { type: 'acceptWildDrawFour', playerId: 'p-bob' }),
    );
    expect(done.hands['p-bob']).toHaveLength(6);
    expect(done.phase).toBe('finished');
    expect(done.winnerId).toBe('p-alice');
    expect(events.map((event) => event.type)).toContain('playerWon');
  });

  it('is necessarily honest, so calling the bluff always costs six', () => {
    const state = makeState({
      players: players('Alice', 'Bob'),
      activeColor: 'blue',
      discardPile: cards('blue:5'),
      hands: { 'p-alice': [card('wildDrawFour')], 'p-bob': cards('red:3', 'red:4') },
      drawPile: cards('green:1', 'green:2', 'green:3', 'green:4', 'green:5', 'green:6', 'green:7'),
    });
    const wild = state.hands['p-alice']![0]!;
    const { state: played } = expectOk(
      applyCommand(state, {
        type: 'playCard',
        playerId: 'p-alice',
        cardId: wild.id,
        chosenColor: 'red',
      }),
    );
    // A player down to one Wild Draw Four genuinely held no colour to follow with.
    expect(played.challenge?.bluffed).toBe(false);
    const { state: done } = expectOk(
      applyCommand(played, { type: 'challengeWildDrawFour', playerId: 'p-bob' }),
    );
    expect(done.hands['p-bob']).toHaveLength(8);
    expect(done.winnerId).toBe('p-alice');
  });
});
