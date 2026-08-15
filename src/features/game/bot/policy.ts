import { assistFor } from '../engine/assist.ts';
import { CARD_COLORS, cardColor, type Card, type CardColor } from '../engine/cards.ts';
import { isCardPlayable } from '../engine/rules.ts';
import { playContextFromPublic, type PublicGameState } from '../engine/views.ts';
/*
 * The *wire* action type on purpose.
 *
 * A robot may therefore express exactly what a remote player can express, and
 * nothing more: `skipTurn`, `leaveGame` and `abandonRound` are room-only commands
 * and are unreachable from here by construction — the same guarantee the protocol
 * gives a human client. Types only, so this module has no runtime dependency on
 * the network layer.
 */
import type { GameAction } from '../network/protocol.ts';
import type { BotView } from './view.ts';

/**
 * The robot's brain: one pure function of {@link BotView} plus injected randomness.
 *
 * No clocks, no `Math.random()`, no access to the authoritative state. That is
 * what makes it exactly as testable as the engine, and what makes "a robot cannot
 * see your hand" checkable rather than promised.
 *
 * It plays like a competent club player, not like an oracle. Every legality
 * decision goes through the same {@link isCardPlayable} the table's own UI uses, it
 * never reasons about cards it has not seen, it does not count the discard pile to
 * infer anybody's hand, and it calls its own UNO as fast as a person reaches the
 * button rather than sitting on it — the pause lives in the driver, and it is a
 * tap, not a handicap.
 */

/** Which obligation a move answers. The driver's pause depends on it. */
export type BotMoveKind = 'challenge' | 'declare' | 'turn' | 'catch' | 'pass';

export interface BotMove {
  readonly action: GameAction;
  readonly kind: BotMoveKind;
}

function colorCounts(hand: readonly Card[]): Record<CardColor, number> {
  const counts: Record<CardColor, number> = { red: 0, yellow: 0, green: 0, blue: 0 };
  for (const card of hand) {
    const color = cardColor(card);
    if (color !== null) {
      counts[color] += 1;
    }
  }
  return counts;
}

/**
 * The colour this hand is strongest in, or `fallback` when it holds none.
 *
 * Total on purpose: it names the colour for a wild, and the engine *requires* one
 * — a hand of nothing but wilds would otherwise produce a `colorRequired`
 * rejection on what may be a winning card.
 */
function dominantColor(hand: readonly Card[], fallback: CardColor): CardColor {
  const counts = colorCounts(hand);
  let best = fallback;
  let bestCount = 0;
  for (const color of CARD_COLORS) {
    if (counts[color] > bestCount) {
      best = color;
      bestCount = counts[color];
    }
  }
  return best;
}

function activeSeatCount(table: PublicGameState): number {
  return table.players.filter((player) => player.left !== true).length;
}

/** The seat that would move next, or `null` when there is nobody to name. */
function nextPlayer(table: PublicGameState): PublicGameState['players'][number] | null {
  const players = table.players;
  const index = players.findIndex((player) => player.id === table.currentPlayerId);
  if (index < 0) {
    return null;
  }
  for (let step = 1; step <= players.length; step += 1) {
    const at = (((index + step * table.direction) % players.length) + players.length) % players.length;
    const candidate = players[at];
    if (candidate && candidate.left !== true && candidate.id !== table.currentPlayerId) {
      return candidate;
    }
  }
  return null;
}

/** How many cards the seat that would move next is holding. */
function nextPlayerCardCount(table: PublicGameState): number {
  return nextPlayer(table)?.cardCount ?? Number.POSITIVE_INFINITY;
}

/**
 * How gently this robot has been asked to treat the seat about to be hit, and the
 * gentlest it has been asked to be with anybody still in the round.
 *
 * Two numbers because two kinds of card need them. A Draw Two or a Skip lands on
 * one person, so what matters is who is next. Both are nought at an ordinary table,
 * and every use of them below is written so that nought changes nothing.
 */
function leniencyAhead(view: BotView): number {
  const next = nextPlayer(view.table);
  return next === null ? 0 : assistFor(view.lenientToward, next.id);
}

function leniencyAtTable(view: BotView): number {
  let most = 0;
  for (const player of view.table.players) {
    if (player.left !== true) {
      most = Math.max(most, assistFor(view.lenientToward, player.id));
    }
  }
  return most;
}

/**
 * How often the robot takes the second-best card instead of the best one.
 *
 * The most human-looking of every method in this feature and the only one that
 * cannot be caught, because there is nothing to catch: a robot that plays a good
 * card instead of the perfect one is indistinguishable from a robot, a cousin or
 * anybody else at the table. It is deliberately *not* a robot that plays badly —
 * the second-best card is still a real move, so the table stays worth beating.
 *
 * Nought at a light lean: the first step of the dial is meant to be all luck and no
 * charity.
 */
function slackChance(lenience: number): number {
  switch (lenience) {
    case 2:
      return 0.25;
    case 3:
      return 0.5;
    default:
      return 0;
  }
}

/**
 * How much the robot wants to play this card on an open turn. Higher is better.
 *
 * The shape of the table matters as much as the card: a Draw Two is worth more
 * against somebody sitting on two cards, and at two seats a Skip and a Reverse are
 * both worth an extra turn rather than a card off somebody else.
 */
function scoreCard(card: Card, view: BotView): number {
  const { table, hand } = view;
  const counts = colorCounts(hand);
  /*
   * The punishing cards, and the one thing leniency changes about them: they stop
   * being worth *more* against somebody who is nearly out and start being worth
   * less than anything else in the hand. Not forbidden — a hand holding nothing
   * else still plays one, because a robot that could not take its turn would stop
   * the table — just ranked below every ordinary card, which is the difference
   * between a robot that spares a child and a robot that cannot hurt one.
   *
   * Below the plain wild's 1, so the demotion is never a tie with a card the robot
   * would otherwise have hoarded, and one step lower for each turn of the dial.
   */
  const ahead = leniencyAhead(view);
  const pressure = ahead === 0 && nextPlayerCardCount(table) <= 3;
  const twoHanded = activeSeatCount(table) === 2;

  switch (card.kind) {
    case 'wildDrawFour':
      /*
       * The heaviest card in the deck and the one most worth keeping for a moment
       * when it is honest. Spent freely under pressure; demoted below everything
       * when the seat it would land on is one the table is looking after.
       */
      return ahead > 0 ? 1 - ahead : pressure ? 9 : 6;
    case 'drawTwo':
      return ahead > 0 ? 1 - ahead : pressure ? 8 : 7;
    case 'skip':
      // At two seats a Skip comes straight back round: it is an extra turn, not a
      // way of picking on the next seat. Which is exactly why it is demoted when
      // that seat is one the table is looking after — at two players the extra
      // turn *is* the harm.
      return ahead > 0 ? 1 - ahead : twoHanded ? 8 : pressure ? 7 : 5;
    case 'reverse':
      // The same card as a Skip when only two are playing, and worth what a Skip
      // is worth. With more seats it is worth little: it changes whose problem the
      // next card is, and not much else.
      return ahead > 0 ? 1 - ahead : twoHanded ? 8 : 3;
    case 'number':
      // Leaving the table in the colour this hand is strongest in makes the next
      // turn easier, whenever it comes back round.
      return counts[card.color] >= counts[dominantColor(hand, card.color)] ? 5 : 4;
    case 'wild':
      // Hoarded: it is the one card that is always playable and never a bluff, so
      // it is worth most as the answer to a colour the hand cannot follow.
      return 1;
  }
}

function play(card: Card, chosenColor?: CardColor): GameAction {
  return chosenColor === undefined
    ? { type: 'playCard', cardId: card.id }
    : { type: 'playCard', cardId: card.id, chosenColor };
}

/**
 * Turns a chosen card into an action, naming a colour exactly when the card
 * demands one: the engine rejects a missing choice and an unasked-for one alike.
 * Both wilds demand one.
 */
function playChoice(card: Card, view: BotView): GameAction {
  if (card.kind !== 'wild' && card.kind !== 'wildDrawFour') {
    return play(card);
  }
  const rest = view.hand.filter((candidate) => candidate.id !== card.id);
  return play(card, dominantColor(rest, view.table.activeColor));
}

/** Cards that may be played right now. */
function candidates(view: BotView): Card[] {
  const context = playContextFromPublic(view.table);
  return view.hand.filter((card) => isCardPlayable(card, context));
}

/**
 * Picks one of the joint-best cards, so two robots do not play in lockstep.
 *
 * At a table that is leaning towards somebody, it sometimes picks one of the
 * joint-*second*-best instead — see {@link slackChance}. The extra draw from the
 * seat's stream is taken only when there is a real chance of using it, so an
 * ordinary table consumes exactly the randomness it always did and replays exactly
 * as it always did.
 */
function pickBest(cards: readonly Card[], view: BotView, random: () => number): Card {
  const tiers = new Map<number, Card[]>();
  for (const card of cards) {
    const score = scoreCard(card, view);
    const tier = tiers.get(score);
    if (tier) {
      tier.push(card);
    } else {
      tiers.set(score, [card]);
    }
  }
  const scores = [...tiers.keys()].sort((a, b) => b - a);
  const slack = slackChance(leniencyAtTable(view));
  const tier =
    slack > 0 && scores.length > 1 && random() < slack ? (scores[1] as number) : (scores[0] as number);
  const best = tiers.get(tier) as Card[];
  const index = Math.min(Math.floor(random() * best.length), best.length - 1);
  return best[index] as Card;
}

/**
 * What to do with a turn. Always an action.
 *
 * A turn a robot declined to take would freeze the table, so every branch ends in a
 * card, the pile, or a pass.
 *
 * The drawn-card branch comes first and has to: once a card has been taken from the
 * pile it is the only card in the hand the table will accept, and a robot that went
 * on scoring its whole hand would keep offering cards the room refuses — re-deciding
 * after each refusal, and picking a different illegal card each time — until the
 * stall timer took its seat away.
 */
function turnAction(view: BotView, random: () => number): GameAction {
  const context = playContextFromPublic(view.table);

  if (view.drawnCardId !== null) {
    const drawn = view.hand.find((card) => card.id === view.drawnCardId);
    if (drawn && isCardPlayable(drawn, context)) {
      return playChoice(drawn, view);
    }
    return { type: 'passTurn' };
  }

  const playable = candidates(view);
  if (playable.length === 0) {
    /*
     * The pile, which no longer ends the turn: the card it produces may be
     * playable, and the next decision — made a beat later, on the state the draw
     * produced — takes the branch above.
     *
     * Unless there is nothing left in it, discard included. A draw then takes no
     * card, so `drawnCardId` stays null and the branch above is never reached —
     * which would leave a robot asking the pile for a card for ever, on an accepted
     * command that changes nothing and therefore resets every deadline that would
     * otherwise rescue the seat.
     */
    return view.table.drawPileCount === 0 && view.table.discardCount <= 1
      ? { type: 'passTurn' }
      : { type: 'drawCard' };
  }
  return playChoice(pickBest(playable, view, random), view);
}

/**
 * The single playable card that would empty the hand, if the robot holds one.
 *
 * Played on sight: an empty hand is never worse than a full one, and nothing can be
 * caught out of a hand that does not exist. A Draw Two or a Wild Draw Four is a
 * perfectly good last card — the victim still draws — so neither is filtered out.
 */
function winningCard(view: BotView): Card | null {
  if (view.hand.length !== 1) {
    return null;
  }
  const only = view.hand[0] as Card;
  if (view.drawnCardId !== null && only.id !== view.drawnCardId) {
    return null;
  }
  return isCardPlayable(only, playContextFromPublic(view.table)) ? only : null;
}

/**
 * A seat sitting on a single card it never called, if there is one to call out.
 *
 * The window is the table's to publish — `catchableUno` is already resolved
 * against the turn — so this asks who is catchable rather than working it out, and
 * a robot can never ask for a catch the room has already closed.
 *
 * Absence is one exception, and it is not the robot's kindness: somebody who is not
 * there cannot shout, so calling them out would be farming rather than catching. A
 * seat a robot is playing counts as present — it can shout.
 *
 * A seat the table is leaning towards is the second exception, and that one *is*
 * kindness. Being caught is the harshest routine thing in the game and the one a
 * small child forgets most reliably, so a robot that enforced it would undo, in a
 * single call, everything the deal and the draw pile had quietly done all round. The
 * humans at the table may still call them out, which is the point: the rule
 * survives, and only the machine stops policing it.
 */
function silentSeat(view: BotView): string | null {
  for (const playerId of view.table.catchableUno) {
    const present = view.seats.find((seat) => seat.id === playerId)?.present ?? false;
    if (playerId !== view.playerId && present && assistFor(view.lenientToward, playerId) === 0) {
      return playerId;
    }
  }
  return null;
}

/**
 * Whether to call a bluff, knowing nothing about the hand that played it.
 *
 * A real decision made on real evidence, and deliberately not a peek: the robot
 * knows the colour that was in play, how many cards the player is holding and what
 * it holds itself, which is exactly what a person at the table knows.
 *
 * The reasoning is the honest one. A player with many cards is likelier to have been
 * holding the colour, so a bluff is likelier and a challenge pays; a player down to
 * their last card or two had few chances to hold it and is probably honest, and
 * being wrong costs six rather than four. And a table leaning towards somebody never
 * has its robots call *them* out — the same mercy the catch gets, for the same
 * reason.
 */
function shouldChallenge(view: BotView, playerId: string): boolean {
  if (assistFor(view.lenientToward, playerId) > 0) {
    return false;
  }
  const player = view.table.players.find((candidate) => candidate.id === playerId);
  return (player?.cardCount ?? 0) >= 4;
}

/**
 * The one entry point: what this robot owes the table right now, or `null`.
 *
 * The order is deliberate:
 *
 * 1. A Wild Draw Four freezes the whole table, so answering it comes before
 *    everything — and unlike every other branch here it may never decline to
 *    answer, because nobody else can. While it is open the only other legal moves
 *    are the two shouts, and they stay available.
 * 2. A card that empties the hand is played immediately. The call is not what wins,
 *    so pausing to shout first would only give the table time to catch it.
 * 3. Calling UNO is free and does not touch the turn, so it comes before playing: a
 *    robot that played first would spend the round being caught.
 * 4. Then the turn.
 * 5. Calling somebody else out comes last, and (in the driver) slowest, because it
 *    is the one move a human at the table would rather make themselves.
 */
export function chooseBotMove(view: BotView, random: () => number): BotMove | null {
  const { table, hand, playerId } = view;
  if (table.phase !== 'playing') {
    return null;
  }
  const me = table.players.find((player) => player.id === playerId);
  if (!me || me.left === true) {
    return null;
  }

  const challenge = table.challenge;
  if (challenge !== null) {
    if (challenge.targetId === playerId) {
      /*
       * The one branch that must always answer. Everything else here may return
       * `null` and let a human or a timer decide; this cannot, because the table is
       * frozen behind it and the only seat that can unfreeze it is this one.
       */
      return {
        action: shouldChallenge(view, challenge.playerId)
          ? { type: 'challengeWildDrawFour' }
          : { type: 'acceptWildDrawFour' },
        kind: 'challenge',
      };
    }
    // Frozen for everybody else; only the shouts remain, and they are below.
  }

  const myTurn = challenge === null && table.currentPlayerId === playerId;
  const declared = table.declaredUno.includes(playerId);

  if (myTurn) {
    const winning = winningCard(view);
    if (winning) {
      return { action: playChoice(winning, view), kind: 'turn' };
    }
  }

  if (hand.length === 1 && !declared) {
    return { action: { type: 'declareUno' }, kind: 'declare' };
  }

  if (myTurn) {
    const action = turnAction(view, random);
    return { action, kind: action.type === 'passTurn' ? 'pass' : 'turn' };
  }

  const target = silentSeat(view);
  if (target !== null) {
    return { action: { type: 'catchUno', targetId: target }, kind: 'catch' };
  }

  return null;
}
