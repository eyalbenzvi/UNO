import { NO_ASSIST, assistFor, type AssistWeights } from '../engine/assist.ts';
import type { Card } from '../engine/cards.ts';
import type { GameState, PlayerId } from '../engine/state.ts';
import { toPrivateHandView, toPublicGameState, type PublicGameState } from '../engine/views.ts';

/**
 * Everything a robot is allowed to know.
 *
 * This is the whole fairness argument, and it is structural rather than a
 * promise. A robot runs on the host, and the host holds every hand in memory —
 * so a policy that read {@link GameState} would be reading its opponents' cards.
 * It is handed the same projections a remote client is sent instead: the public
 * table, its own hand, and which seats are answering for themselves. Nothing else
 * exists as far as it is concerned, which is why "a robot cannot see your hand" is
 * a test rather than a claim.
 *
 * This is the *only* function in the package that is allowed to see a
 * {@link GameState}; a test asserts that no other file in `bot/` imports one.
 *
 * Nothing is smuggled through it. An earlier version of this game carried one extra
 * bit — whether the room was waiting on this seat to answer a card — because who
 * held the answering card was private and could not be inferred. UNO's equivalent,
 * the Wild Draw Four challenge, names its target in the public table, so the bit is
 * derivable by anybody watching and there is nothing left to pass through.
 */
export interface BotSeatView {
  readonly id: PlayerId;
  /**
   * Whether this seat can answer for itself.
   *
   * Presence is public — every client is told each seat's health in the lobby
   * snapshot — and it is needed for one decision only: somebody who is not there
   * cannot shout, so they cannot be called out for silence. A seat a robot is
   * playing counts as present, because the robot can shout for it.
   */
  readonly present: boolean;
}

export interface BotView {
  readonly playerId: PlayerId;
  /** The table as every client sees it. */
  readonly table: PublicGameState;
  /** This robot's own cards, and no others. */
  readonly hand: readonly Card[];
  /**
   * The card this seat has already drawn this turn, or `null`.
   *
   * A fact about its own hand, arriving by the same private projection a human
   * client gets it by — and load-bearing rather than convenient: once a card has
   * been taken from the pile it is the only one the table will accept, so a robot
   * that did not know would go on offering cards the room refuses.
   */
  readonly drawnCardId: string | null;
  readonly seats: readonly BotSeatView[];
  /**
   * Seats this robot has been asked to go easy on, and how easy.
   *
   * Not a fact about anybody's cards, and that is why it is allowed through a
   * boundary whose whole purpose is to keep cards out: it is a number per *seat*,
   * decided by the person running the table before a card was dealt, and knowing it
   * tells a robot nothing whatever about what anybody is holding. The tests that
   * guard this file — no card id from another hand, the same decision however the
   * other hands are rearranged — are untouched by it.
   *
   * Its own seat is never in here. A robot covering a child's seat plays that hand
   * to win it; leniency is something a robot extends to the people across the table,
   * and a robot that extended it to itself would be throwing away the very hand the
   * feature exists to protect.
   */
  readonly lenientToward: AssistWeights;
}

export function botViewFor(
  state: GameState,
  playerId: PlayerId,
  isPresent: (playerId: PlayerId) => boolean,
): BotView {
  const lenientToward: Record<PlayerId, number> = {};
  for (const player of state.players) {
    const weight = player.id === playerId ? 0 : assistFor(state.assist, player.id);
    if (weight > 0) {
      lenientToward[player.id] = weight;
    }
  }
  const hand = toPrivateHandView(state, playerId);
  return {
    playerId,
    table: toPublicGameState(state),
    hand: hand.cards,
    drawnCardId: hand.drawnCardId ?? null,
    seats: state.players.map((player) => ({ id: player.id, present: isPresent(player.id) })),
    lenientToward: Object.keys(lenientToward).length > 0 ? lenientToward : NO_ASSIST,
  };
}
