import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chooseBotMove } from '../../../src/features/game/bot/policy.ts';
import { botViewFor, type BotView } from '../../../src/features/game/bot/view.ts';
import { applyCommand, createGame } from '../../../src/features/game/engine/engine.ts';
import { createRng, nextFloat } from '../../../src/features/game/engine/prng.ts';
import type { Card } from '../../../src/features/game/engine/cards.ts';
import type { GameCommand, GameState, PlayerId } from '../../../src/features/game/engine/state.ts';
import { cards, makeState, players, type StateOverrides } from '../helpers/engineFixtures.ts';

/**
 * The robot's decisions, tested exactly as the engine's rules are: pure inputs,
 * exact outputs, no timers anywhere.
 *
 * Two of these are properties rather than examples, and they are the two that
 * matter most — a robot must never propose a move the engine refuses, and it must
 * not be able to see anybody else's cards.
 */

/** A stream of numbers a decision can be given without asking the clock. */
function seededRandom(seed = 7): () => number {
  let state = createRng(seed);
  return () => {
    const next = nextFloat(state);
    state = next.state;
    return next.value;
  };
}

/** Everything present, which is the ordinary case at a table. */
function viewOf(state: GameState, playerId: PlayerId): BotView {
  return botViewFor(state, playerId, () => true);
}

function decide(state: GameState, playerId: PlayerId, seed = 7): ReturnType<typeof chooseBotMove> {
  return chooseBotMove(viewOf(state, playerId), seededRandom(seed));
}

/** A three-handed table with hands the test dictates. */
function table(overrides: StateOverrides): GameState {
  return makeState({ players: players('Ann', 'Ben', 'Cat'), ...overrides });
}

const ANN = 'p-ann';
const BEN = 'p-ben';
const CAT = 'p-cat';

function idOfKind(hand: readonly Card[], kind: Card['kind']): string {
  const card = hand.find((candidate) => candidate.kind === kind);
  if (!card) {
    throw new Error(`no ${kind} in hand`);
  }
  return card.id;
}

describe('answering a Wild Draw Four', () => {
  it('always answers, because nobody else can', () => {
    /*
     * The one branch that may not decline. Everything else the policy decides may
     * come back `null` and let a human or a timer take it; this cannot, because the
     * table is frozen behind it and this is the only seat that can unfreeze it.
     */
    for (const cardCount of [1, 2, 5, 9]) {
      const state = table({
        hands: {
          [ANN]: cards('red:5'),
          [BEN]: cards(...Array.from({ length: cardCount }, () => 'blue:4')),
          [CAT]: cards('green:4'),
        },
        challenge: { playerId: ANN, targetId: BEN, bluffed: true },
        currentPlayerIndex: 0,
      });
      const move = decide(state, BEN);
      expect(move?.kind, `holding ${String(cardCount)}`).toBe('challenge');
      expect(['acceptWildDrawFour', 'challengeWildDrawFour']).toContain(move?.action.type);
    }
  });

  it('calls the bluff against a hand big enough to have held the colour', () => {
    const state = table({
      hands: {
        [ANN]: cards('red:1', 'red:2', 'red:3', 'red:4', 'red:5', 'red:6'),
        [BEN]: cards('blue:4'),
        [CAT]: cards('green:4'),
      },
      challenge: { playerId: ANN, targetId: BEN, bluffed: true },
      currentPlayerIndex: 0,
    });
    expect(decide(state, BEN)?.action).toEqual({ type: 'challengeWildDrawFour' });
  });

  it('takes the cards from somebody who is nearly out', () => {
    // Few cards means few chances to have held the colour, and being wrong costs six.
    const state = table({
      hands: { [ANN]: cards('red:5'), [BEN]: cards('blue:4'), [CAT]: cards('green:4') },
      challenge: { playerId: ANN, targetId: BEN, bluffed: false },
      currentPlayerIndex: 0,
    });
    expect(decide(state, BEN)?.action).toEqual({ type: 'acceptWildDrawFour' });
  });

  it('decides without seeing the hand it is judging', () => {
    /*
     * The verdict is in the state and the robot must not read it. Two tables
     * identical but for `bluffed` have to produce the same decision, or the policy
     * is peeking at the answer.
     */
    const build = (bluffed: boolean) =>
      table({
        hands: {
          [ANN]: cards('red:1', 'red:2', 'red:3', 'red:4', 'red:5'),
          [BEN]: cards('blue:4'),
          [CAT]: cards('green:4'),
        },
        challenge: { playerId: ANN, targetId: BEN, bluffed },
        currentPlayerIndex: 0,
      });
    expect(decide(build(true), BEN)).toEqual(decide(build(false), BEN));
  });

  it('waits, rather than playing on, while the card it played is unanswered', () => {
    const state = table({
      hands: {
        [ANN]: cards('red:5', 'red:6'),
        [BEN]: cards('blue:4', 'blue:6'),
        [CAT]: cards('green:4', 'green:6'),
      },
      challenge: { playerId: ANN, targetId: BEN, bluffed: false },
      currentPlayerIndex: 0,
    });
    expect(decide(state, ANN)).toBeNull();
  });

  it('still calls its own UNO while the table is frozen', () => {
    const state = table({
      hands: { [ANN]: cards('red:5'), [BEN]: cards('blue:4', 'blue:6'), [CAT]: cards('green:4') },
      challenge: { playerId: BEN, targetId: CAT, bluffed: false },
      currentPlayerIndex: 1,
      declaredUno: [],
    });
    expect(decide(state, ANN)?.action).toEqual({ type: 'declareUno' });
  });
});

describe('a turn that has already drawn', () => {
  function drawn(spec: string) {
    const state = table({
      hands: { [ANN]: cards('blue:9', spec), [BEN]: cards('blue:4'), [CAT]: cards('green:4') },
      currentPlayerIndex: 0,
      activeColor: 'red',
      discardPile: cards('red:5'),
    });
    const card = (state.hands[ANN] ?? [])[1]!;
    return { state: { ...state, drawnCardId: card.id }, card };
  }

  it('plays the drawn card when it fits', () => {
    const { state, card } = drawn('red:7');
    expect(decide(state, ANN)?.action).toEqual({ type: 'playCard', cardId: card.id });
  });

  it('ends the turn when it does not', () => {
    const { state } = drawn('green:7');
    const move = decide(state, ANN);
    expect(move?.action).toEqual({ type: 'passTurn' });
    expect(move?.kind).toBe('pass');
  });

  it('never offers a card the table would refuse', () => {
    /*
     * The livelock this guards against: once a card has been drawn it is the only
     * one the engine accepts, so a policy that went on scoring the whole hand would
     * keep proposing refused moves — re-deciding after each refusal and picking a
     * different illegal card each time — until the stall timer took the seat away.
     */
    const { state } = drawn('green:7');
    const move = decide(state, ANN);
    const command = { ...(move?.action as GameCommand), playerId: ANN };
    expect(applyCommand(state, command).ok).toBe(true);
  });
});

describe('an ordinary turn', () => {
  it('prefers a Draw Two to an ordinary card', () => {
    const hand = cards('red:5', 'red:drawTwo');
    const state = table({
      hands: { [ANN]: hand, [BEN]: cards('blue:4', 'blue:6'), [CAT]: cards('green:4') },
      currentPlayerIndex: 0,
      activeColor: 'red',
      discardPile: cards('red:9'),
    });
    expect(decide(state, ANN)?.action).toEqual({
      type: 'playCard',
      cardId: idOfKind(hand, 'drawTwo'),
    });
  });

  it('hoards the plain wild while something ordinary is legal', () => {
    const hand = cards('red:5', 'wild');
    const state = table({
      hands: { [ANN]: hand, [BEN]: cards('blue:4', 'blue:6'), [CAT]: cards('green:4') },
      currentPlayerIndex: 0,
      activeColor: 'red',
      discardPile: cards('red:9'),
    });
    // It is the one card that is always playable, so it is worth most held back.
    expect(decide(state, ANN)?.action).toEqual({ type: 'playCard', cardId: idOfKind(hand, 'number') });
  });

  it('names the colour it is strongest in when it plays a wild', () => {
    const hand = cards('wild', 'blue:2', 'blue:4', 'green:5');
    const state = table({
      hands: { [ANN]: hand, [BEN]: cards('red:4', 'red:6'), [CAT]: cards('green:4') },
      currentPlayerIndex: 0,
      activeColor: 'red',
      discardPile: cards('red:9'),
    });
    const move = decide(state, ANN);
    expect(move?.action).toMatchObject({ type: 'playCard', chosenColor: 'blue' });
  });

  it('names a colour even when nothing coloured is left to count', () => {
    // The engine refuses a wild with no colour named, so this must be total.
    const hand = cards('wild');
    const state = table({
      hands: { [ANN]: hand, [BEN]: cards('red:4', 'red:6'), [CAT]: cards('green:4') },
      currentPlayerIndex: 0,
      activeColor: 'red',
      discardPile: cards('red:9'),
    });
    const move = decide(state, ANN);
    expect(move?.action).toMatchObject({ type: 'playCard' });
    expect((move?.action as { chosenColor?: string }).chosenColor).toBeDefined();
  });

  it('names a colour for a Wild Draw Four too', () => {
    const hand = cards('wildDrawFour', 'green:2', 'green:4');
    const state = table({
      hands: { [ANN]: hand, [BEN]: cards('red:4'), [CAT]: cards('green:4') },
      currentPlayerIndex: 0,
      activeColor: 'red',
      discardPile: cards('red:9'),
    });
    const move = decide(state, ANN);
    expect(move?.action).toMatchObject({ type: 'playCard', chosenColor: 'green' });
  });

  it('draws when nothing matches at all', () => {
    const state = table({
      hands: { [ANN]: cards('blue:2', 'green:3'), [BEN]: cards('red:4', 'red:6'), [CAT]: cards('green:4') },
      currentPlayerIndex: 0,
      activeColor: 'red',
      discardPile: cards('red:9'),
    });
    expect(decide(state, ANN)?.action).toEqual({ type: 'drawCard' });
  });
});

describe('the last card', () => {
  it('plays the winning card instead of pausing to call UNO', () => {
    const hand = cards('red:5');
    const state = table({
      hands: { [ANN]: hand, [BEN]: cards('blue:4', 'blue:6'), [CAT]: cards('green:4') },
      currentPlayerIndex: 0,
      activeColor: 'red',
      discardPile: cards('red:9'),
      declaredUno: [],
    });
    // The call is not what wins, so pausing to shout would only give the table time
    // to catch it.
    expect(decide(state, ANN)?.action).toEqual({ type: 'playCard', cardId: hand[0]!.id });
  });

  it('calls UNO when it cannot play the card', () => {
    const state = table({
      hands: { [ANN]: cards('blue:5'), [BEN]: cards('red:4', 'red:6'), [CAT]: cards('green:4') },
      currentPlayerIndex: 0,
      activeColor: 'red',
      discardPile: cards('red:9'),
      declaredUno: [],
    });
    expect(decide(state, ANN)?.action).toEqual({ type: 'declareUno' });
  });

  it('calls it out of turn, and only once', () => {
    const state = table({
      hands: {
        [ANN]: cards('blue:5'),
        [BEN]: cards('red:4', 'red:6'),
        [CAT]: cards('green:4', 'green:6'),
      },
      currentPlayerIndex: 1,
      activeColor: 'red',
      discardPile: cards('red:9'),
      declaredUno: [],
    });
    expect(decide(state, ANN)?.action).toEqual({ type: 'declareUno' });
    expect(decide({ ...state, declaredUno: [ANN], unoExposed: {} }, ANN)).toBeNull();
  });
});

describe('calling somebody out', () => {
  it('catches a present seat sitting on one silent card', () => {
    const state = table({
      hands: { [ANN]: cards('red:4', 'red:6'), [BEN]: cards('blue:5'), [CAT]: cards('green:4', 'green:6') },
      currentPlayerIndex: 2,
      declaredUno: [],
    });
    expect(decide(state, ANN)?.action).toEqual({ type: 'catchUno', targetId: BEN });
  });

  it('leaves a seat that has called UNO alone', () => {
    const state = table({
      hands: { [ANN]: cards('red:4', 'red:6'), [BEN]: cards('blue:5'), [CAT]: cards('green:4', 'green:6') },
      currentPlayerIndex: 2,
      declaredUno: [BEN],
    });
    expect(decide(state, ANN)).toBeNull();
  });

  it('never calls out somebody who is not there', () => {
    const state = table({
      hands: { [ANN]: cards('red:4', 'red:6'), [BEN]: cards('blue:5'), [CAT]: cards('green:4', 'green:6') },
      currentPlayerIndex: 2,
      declaredUno: [],
    });
    // Somebody who cannot shout is being farmed rather than caught.
    const view = botViewFor(state, ANN, (playerId) => playerId !== BEN);
    expect(chooseBotMove(view, seededRandom())).toBeNull();
  });

  it('never asks for a catch the window has already closed', () => {
    const state = table({
      hands: { [ANN]: cards('red:4', 'red:6'), [BEN]: cards('blue:5'), [CAT]: cards('green:4', 'green:6') },
      currentPlayerIndex: 2,
      declaredUno: [],
      unoExposed: {},
    });
    expect(decide(state, ANN)).toBeNull();
  });

  it('never calls out a seat that has left the round', () => {
    const state = makeState({
      players: [
        { id: ANN, name: 'Ann' },
        { id: BEN, name: 'Ben', left: true },
        { id: CAT, name: 'Cat' },
      ],
      hands: { [ANN]: cards('red:4', 'red:6'), [BEN]: cards('blue:5'), [CAT]: cards('green:4', 'green:6') },
      currentPlayerIndex: 2,
      declaredUno: [],
    });
    expect(decide(state, ANN)).toBeNull();
  });
});

describe('a round played entirely by robots', () => {
  /**
   * Plays a whole round through the engine, every seat decided by the policy.
   *
   * This is the "never illegal" property: several hundred real decisions, each
   * checked against the authoritative engine. A policy that proposed one refused
   * move would fail here rather than in production, where the same move would be a
   * table waiting for a robot that keeps being told no.
   */
  function playRound(seed: number): { state: GameState; moves: number } {
    const dealt = createGame(players('Ann', 'Ben', 'Cat'), seed);
    if (!dealt.ok) {
      throw new Error('the deal itself was rejected');
    }
    let state = dealt.state;
    const random = seededRandom(seed);
    let moves = 0;

    while (state.phase === 'playing' && moves < 4_000) {
      let acted = false;
      for (const player of state.players) {
        const move = chooseBotMove(viewOf(state, player.id), random);
        if (!move) {
          continue;
        }
        const command = { ...move.action, playerId: player.id } as GameCommand;
        const result = applyCommand(state, command);
        expect(
          result.ok,
          `${player.id} proposed ${JSON.stringify(move.action)} and the engine said ${
            result.ok ? '' : result.rejection.code
          }`,
        ).toBe(true);
        if (!result.ok) {
          return { state, moves };
        }
        state = result.state;
        moves += 1;
        acted = true;
        break;
      }
      expect(acted, 'no seat owed anything, so the table would have stopped').toBe(true);
      if (!acted) {
        return { state, moves };
      }
    }
    return { state, moves };
  }

  it.each([1, 2, 3, 4242, 999_331])('finishes cleanly from seed %i', (seed) => {
    const { state, moves } = playRound(seed);
    expect(state.phase).toBe('finished');
    expect(state.winnerId).not.toBeNull();
    expect(moves).toBeGreaterThan(10);
  });

  it('conserves every card in the deck along the way', () => {
    const { state } = playRound(4242);
    const ids = [
      ...Object.values(state.hands).flatMap((hand) => hand.map((card) => card.id)),
      ...state.drawPile.map((card) => card.id),
      ...state.discardPile.map((card) => card.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(108);
  });
});

describe('what a robot cannot see', () => {
  it('does not put anybody else’s card in the view at all', () => {
    const dealt = createGame(players('Ann', 'Ben', 'Cat'), 4242);
    if (!dealt.ok) {
      throw new Error('the deal itself was rejected');
    }
    const state = dealt.state;
    const serialised = JSON.stringify(viewOf(state, ANN));
    const foreign = [...(state.hands[BEN] ?? []), ...(state.hands[CAT] ?? []), ...state.drawPile].map(
      (card) => card.id,
    );

    for (const id of foreign) {
      expect(serialised, `leaked ${id}`).not.toContain(id);
    }
  });

  it('decides the same way however the other hands are rearranged', () => {
    /*
     * The real assertion is at the seam, not in the types: the view is built from a
     * `GameState` that contains every hand, so this scrambles the *other* players'
     * cards — keeping each hand's size, and keeping the deck honest — and requires
     * both the same decision and a decision the engine still accepts.
     */
    const dealt = createGame(players('Ann', 'Ben', 'Cat'), 20_260_805);
    if (!dealt.ok) {
      throw new Error('the deal itself was rejected');
    }
    const state = dealt.state;
    /*
     * Decided for whoever is actually on turn rather than for a fixed seat: the
     * opening card can be a Skip, a Reverse or a Draw Two, any of which moves the
     * turn before anybody has played.
     */
    const me = state.players[state.currentPlayerIndex]!.id;
    const others = state.players.filter((player) => player.id !== me).map((player) => player.id);
    const baseline = decide(state, me);
    expect(baseline).not.toBeNull();

    const pool = [...others.flatMap((id) => state.hands[id] ?? []), ...state.drawPile];
    for (let rotation = 1; rotation < 8; rotation += 1) {
      const shifted = [...pool.slice(rotation), ...pool.slice(0, rotation)];
      const hands = { ...state.hands };
      let cursor = 0;
      for (const id of others) {
        const size = (state.hands[id] ?? []).length;
        hands[id] = shifted.slice(cursor, cursor + size);
        cursor += size;
      }
      const scrambled: GameState = { ...state, hands, drawPile: shifted.slice(cursor) };

      const move = decide(scrambled, me);
      expect(move).toEqual(baseline);
      const command = { ...(move?.action as GameCommand), playerId: me };
      expect(applyCommand(scrambled, command).ok).toBe(true);
    }
  });
});

describe('when there is nothing to decide', () => {
  it('says nothing once the round is over', () => {
    const state = table({
      hands: { [ANN]: cards('red:5'), [BEN]: cards('blue:4'), [CAT]: cards('green:4') },
      phase: 'finished',
      winnerId: BEN,
      currentPlayerIndex: 0,
    });
    expect(decide(state, ANN)).toBeNull();
  });

  it('says nothing for a seat that has left the round', () => {
    const state = makeState({
      players: [
        { id: ANN, name: 'Ann', left: true },
        { id: BEN, name: 'Ben' },
        { id: CAT, name: 'Cat' },
      ],
      hands: { [ANN]: cards('red:5'), [BEN]: cards('blue:4', 'blue:6'), [CAT]: cards('green:4', 'green:6') },
      currentPlayerIndex: 0,
      discardPile: cards('red:9'),
    });
    // Their cards are frozen out of play, so every command from them is refused —
    // including the declaration their single card would otherwise owe.
    expect(decide(state, ANN)).toBeNull();
  });

  it('scores a table with nobody left to punish without falling over', () => {
    const hand = cards('red:drawTwo', 'red:5');
    const state = makeState({
      players: [
        { id: ANN, name: 'Ann' },
        { id: BEN, name: 'Ben', left: true },
      ],
      hands: { [ANN]: hand, [BEN]: cards('blue:4', 'blue:6') },
      currentPlayerIndex: 0,
      discardPile: cards('red:9'),
    });
    // There is no next seat to weigh, so the Draw Two is scored on its own merits
    // rather than on a card count that does not exist.
    expect(decide(state, ANN)?.action).toEqual({
      type: 'playCard',
      cardId: idOfKind(hand, 'drawTwo'),
    });
  });
});

describe('the shape of the package', () => {
  it('lets only the view see the authoritative state', () => {
    /*
     * The fairness argument is that a robot is handed a projection, not the game.
     * That holds only while `view.ts` is the single door to a `GameState` — so this
     * checks the door rather than trusting the convention, which is the sort of thing
     * a refactor breaks silently and a reviewer reads straight past.
     */
    const directory = join(process.cwd(), 'src/features/game/bot');
    const files = readdirSync(directory).filter((name) => name.endsWith('.ts'));
    expect(files).toContain('view.ts');

    for (const name of files) {
      if (name === 'view.ts') {
        continue;
      }
      const source = readFileSync(join(directory, name), 'utf8');
      // `PlayerId` and the other aliases are fine — they are strings. `GameState` is
      // the one type that carries every hand, so it is the one the door is for.
      expect(source, `${name} reaches for the authoritative state`).not.toMatch(/\bGameState\b/);
    }
  });
});
