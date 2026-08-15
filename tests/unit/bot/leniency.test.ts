import { describe, expect, it } from 'vitest';
import { chooseBotMove } from '../../../src/features/game/bot/policy.ts';
import { BotRunner } from '../../../src/features/game/bot/runner.ts';
import { botViewFor, type BotView } from '../../../src/features/game/bot/view.ts';
import type { Card } from '../../../src/features/game/engine/cards.ts';
import { createRng, nextFloat } from '../../../src/features/game/engine/prng.ts';
import type { GameState, PlayerId } from '../../../src/features/game/engine/state.ts';
import {
  BOT_DECLARE_MAX_MS,
  BOT_SOFT_DECLARE_MAX_MS,
  BOT_SOFT_DECLARE_MIN_MS,
} from '../../../src/features/game/network/timing.ts';
import { cards, makeState, players, type StateOverrides } from '../helpers/engineFixtures.ts';

/**
 * What a robot does differently at a table that is leaning towards somebody.
 *
 * Four things, and none of them is a rule: it stops calling that seat out, it stops
 * aiming the punishing cards at it, it sometimes plays the second-best card instead
 * of the best, and it leaves a window on its own last card that a person can
 * actually reach. Every one of them is something a mediocre human player does by
 * accident, which is the point.
 */

const ANN = 'p-ann';
const BEN = 'p-ben';
const CAT = 'p-cat';

function seededRandom(seed = 7): () => number {
  let state = createRng(seed);
  return () => {
    const next = nextFloat(state);
    state = next.state;
    return next.value;
  };
}

function table(overrides: StateOverrides): GameState {
  return makeState({ players: players('Ann', 'Ben', 'Cat'), ...overrides });
}

function viewOf(state: GameState, playerId: PlayerId): BotView {
  return botViewFor(state, playerId, () => true);
}

function decide(state: GameState, playerId: PlayerId, seed = 7): ReturnType<typeof chooseBotMove> {
  return chooseBotMove(viewOf(state, playerId), seededRandom(seed));
}

/** The kind of card the robot chose to play, or `undefined` if it played none. */
function playedKind(state: GameState, playerId: PlayerId, seed = 7): Card['kind'] | undefined {
  const move = decide(state, playerId, seed);
  if (!move || move.action.type !== 'playCard') {
    return undefined;
  }
  const cardId = move.action.cardId;
  return (state.hands[playerId] ?? []).find((card) => card.id === cardId)?.kind;
}

describe('what a robot is told', () => {
  it('is a weight per seat, and never its own', () => {
    const state = table({ assist: { [ANN]: 2, [BEN]: 3 } });
    expect(viewOf(state, ANN).lenientToward).toEqual({ [BEN]: 3 });
    expect(viewOf(state, CAT).lenientToward).toEqual({ [ANN]: 2, [BEN]: 3 });
  });

  it('carries no cards, so the fairness argument is untouched', () => {
    const state = table({
      hands: { [ANN]: cards('red:5'), [BEN]: cards('wild'), [CAT]: cards('blue:3') },
      assist: { [BEN]: 1 },
    });
    const serialised = JSON.stringify(viewOf(state, ANN).lenientToward);
    for (const card of state.hands[BEN] ?? []) {
      expect(serialised).not.toContain(card.id);
    }
  });

  it('says nothing at all at an ordinary table', () => {
    expect(viewOf(table({}), ANN).lenientToward).toEqual({});
  });
});

describe('calling somebody out', () => {
  const silent = {
    hands: { [ANN]: cards('red:5', 'red:6'), [BEN]: cards('blue:4', 'blue:5'), [CAT]: cards('red:3') },
    currentPlayerIndex: 0,
  };

  it('is what a robot does to a seat nobody is looking after', () => {
    expect(decide(table({ ...silent, currentPlayerIndex: 1 }), ANN)?.action).toEqual({
      type: 'catchUno',
      targetId: CAT,
    });
  });

  it('is exactly what it does not do to a seat the table is leaning towards', () => {
    /*
     * Four cards for forgetting to shout is the harshest thing in the game and the
     * one a small child forgets most reliably. The humans may still call it — the
     * rule is untouched — but the machine stops policing it.
     */
    const state = table({ ...silent, currentPlayerIndex: 1, assist: { [CAT]: 1 } });
    expect(decide(state, ANN)).toBeNull();
  });
});

describe('aiming the punishing cards', () => {
  it('would rather not put a Draw Two on the seat it is looking after', () => {
    const hands = {
      [ANN]: cards('red:drawTwo', 'red:5'),
      [BEN]: cards('blue:4'),
      [CAT]: cards('green:3'),
    };
    const plain = table({ hands, discardPile: cards('red:9'), currentPlayerIndex: 0 });
    const leaned = table({
      hands,
      discardPile: cards('red:9'),
      currentPlayerIndex: 0,
      // A light lean, which carries no slack at all — so the only thing that can
      // move this choice is the demotion itself, and the answer is exact.
      assist: { [BEN]: 1 },
    });
    expect(playedKind(plain, ANN)).toBe('drawTwo');
    expect(playedKind(leaned, ANN)).toBe('number');
  });

  it('would rather not put a Wild Draw Four on the seat it is looking after', () => {
    const hands = {
      [ANN]: cards('wildDrawFour', 'red:5'),
      [BEN]: cards('blue:4', 'blue:5'),
      [CAT]: cards('green:3', 'green:4'),
    };
    const base = { hands, discardPile: cards('red:9'), currentPlayerIndex: 0 };
    expect(playedKind(table(base), ANN)).toBe('wildDrawFour');
    expect(playedKind(table({ ...base, assist: { [BEN]: 1 } }), ANN)).toBe('number');
  });

  it('spares only the seat the card would actually land on', () => {
    /*
     * Unlike the game this was built from, no card here punishes the whole table:
     * a Wild Draw Four lands on the next seat and nobody else. So leniency towards
     * somebody two seats away changes nothing, and pretending otherwise would make
     * the robot play worse for no one's benefit.
     */
    const hands = {
      [ANN]: cards('wildDrawFour', 'red:5'),
      [BEN]: cards('blue:4', 'blue:5'),
      [CAT]: cards('green:3', 'green:4'),
    };
    const base = { hands, discardPile: cards('red:9'), currentPlayerIndex: 0 };
    expect(playedKind(table({ ...base, assist: { [CAT]: 1 } }), ANN)).toBe('wildDrawFour');
  });

  it('still plays a punishing card when it is the only legal one, rather than freezing the table', () => {
    const state = table({
      hands: { [ANN]: cards('red:drawTwo'), [BEN]: cards('blue:4'), [CAT]: cards('green:3') },
      discardPile: cards('red:9'),
      currentPlayerIndex: 0,
      assist: { [BEN]: 3 },
    });
    expect(decide(state, ANN)?.action.type).toBe('playCard');
  });
});

describe('playing a little worse', () => {
  it('sometimes takes the second-best card, and never at an ordinary table', () => {
    const hands = {
      [ANN]: cards('red:skip', 'red:5', 'red:6'),
      [BEN]: cards('blue:4', 'blue:5'),
      [CAT]: cards('green:3', 'green:4'),
    };
    const base = { hands, discardPile: cards('red:9'), currentPlayerIndex: 0 };
    const kindsOver = (state: GameState): Set<string> => {
      const seen = new Set<string>();
      for (let seed = 0; seed < 40; seed += 1) {
        const kind = playedKind(state, ANN, seed);
        if (kind !== undefined) {
          seen.add(kind);
        }
      }
      return seen;
    };
    // Ben is not being looked after here, so the Stop keeps its ordinary score and
    // the only thing that can move the choice is the slack itself.
    expect(kindsOver(table(base))).toEqual(new Set(['skip']));
    expect(kindsOver(table({ ...base, assist: { [CAT]: 3 } }))).toEqual(new Set(['skip', 'number']));
  });

  it('takes it less often at the gentler of the two settings than at the harsher one', () => {
    /*
     * Two settings do this and they are meant to differ: a quarter of the time at 2,
     * half at 3. The dial is the difference between "the table is being a bit kind"
     * and "the table is carrying somebody", and a step that changed nothing would
     * make the middle of the dial a lie.
     */
    const base = {
      hands: {
        [ANN]: cards('red:skip', 'red:5', 'red:6'),
        [BEN]: cards('blue:4', 'blue:5'),
        [CAT]: cards('green:3', 'green:4'),
      },
      discardPile: cards('red:9'),
      currentPlayerIndex: 0,
    };
    const secondBestRate = (level: 2 | 3): number => {
      let taken = 0;
      for (let seed = 0; seed < 200; seed += 1) {
        if (playedKind(table({ ...base, assist: { [CAT]: level } }), ANN, seed) === 'number') {
          taken += 1;
        }
      }
      return taken / 200;
    };
    const gentle = secondBestRate(2);
    const generous = secondBestRate(3);
    expect(gentle).toBeGreaterThan(0.1);
    expect(gentle).toBeLessThan(0.4);
    expect(generous).toBeGreaterThan(gentle);
  });

  it('draws no randomness it would not have drawn, when nobody is being looked after', () => {
    /*
     * The seat's stream is what makes a round replay exactly, so an extra call at an
     * ordinary table would change every robot's game. The slack is only allowed to
     * ask for a number when there is a real chance of using it.
     */
    const state = table({
      hands: { [ANN]: cards('red:5', 'red:6'), [BEN]: cards('blue:4'), [CAT]: cards('green:3') },
      discardPile: cards('red:9'),
      currentPlayerIndex: 0,
    });
    let calls = 0;
    const counted = (): number => {
      calls += 1;
      return 0.5;
    };
    chooseBotMove(viewOf(state, ANN), counted);
    expect(calls).toBe(1);
  });
});

describe('calling a bluff', () => {
  /** A Wild Draw Four laid by `by`, waiting on Ann to answer it. */
  function challenged(by: PlayerId, hands: Record<PlayerId, Card[]>, assist?: GameState['assist']) {
    return table({
      hands,
      discardPile: cards('red:9', 'wildDrawFour'),
      currentPlayerIndex: players('Ann', 'Ben', 'Cat').findIndex((player) => player.id === by),
      challenge: { playerId: by, targetId: ANN, bluffed: true },
      ...(assist ? { assist } : {}),
    });
  }

  const FAT_HAND = {
    [ANN]: cards('blue:4', 'blue:5'),
    [BEN]: cards('green:1', 'green:2', 'green:3', 'green:4', 'green:5'),
    [CAT]: cards('green:7'),
  };

  it('is what a robot does to a seat nobody is looking after, on the evidence it has', () => {
    const move = decide(challenged(BEN, FAT_HAND), ANN);
    expect(move?.action.type).toBe('challengeWildDrawFour');
  });

  it('is exactly what it does not do to a seat the table is leaning towards', () => {
    /*
     * The same table, the same five-card hand, the same bluff — and the robot takes
     * the four cards instead. Being called out on a bluff is the harshest routine
     * thing in this game, and a robot that enforced it would undo in one move
     * everything the deal had quietly done all round. A person at the table may
     * still challenge; only the machine stops.
     */
    const move = decide(challenged(BEN, FAT_HAND, { [BEN]: 2 }), ANN);
    expect(move?.action.type).toBe('acceptWildDrawFour');
  });
});

describe('its own last card', () => {
  /** The pause the driver arms, with everything else about it held still. */
  function declarePause(state: GameState, seed: number): number {
    const pauses: number[] = [];
    const random = seededRandom(seed);
    const runner = new BotRunner({
      view: (playerId) => viewOf(state, playerId),
      controlled: () => [{ playerId: ANN, standIn: false }],
      blocked: () => false,
      submit: () => true,
      random: () => random(),
      schedule: (_run, ms) => {
        pauses.push(ms);
        return () => undefined;
      },
    });
    runner.schedule();
    return pauses[0] ?? -1;
  }

  const onOneCard = {
    hands: { [ANN]: cards('blue:9'), [BEN]: cards('blue:4', 'blue:5'), [CAT]: cards('green:3') },
    discardPile: cards('red:9'),
    currentPlayerIndex: 1,
  };

  it('is shouted almost instantly at an ordinary table', () => {
    // Which is deliberate, and predates this: a robot that paused was farmed.
    expect(declarePause(table(onOneCard), 3)).toBeLessThanOrEqual(BOT_DECLARE_MAX_MS);
  });

  it('leaves a window a child can reach when the table is leaning towards somebody', () => {
    const pause = declarePause(table({ ...onOneCard, assist: { [CAT]: 1 } }), 3);
    expect(pause).toBeGreaterThanOrEqual(BOT_SOFT_DECLARE_MIN_MS);
    expect(pause).toBeLessThanOrEqual(BOT_SOFT_DECLARE_MAX_MS);
  });
});
