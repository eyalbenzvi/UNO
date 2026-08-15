import type { Card, CardColor, CardId } from './cards.ts';
import { topCard } from './engine.ts';
import type { PlayContext } from './rules.ts';
import type {
  GameEndReason,
  GameMode,
  GamePhase,
  GameState,
  PlayerId,
  TurnDirection,
} from './state.ts';

export interface PublicPlayerView {
  readonly id: PlayerId;
  readonly name: string;
  readonly cardCount: number;
  /** True for a seat that has left the round. Their cards are frozen out of play. */
  readonly left?: boolean;
  /**
   * What this seat scored in the round that has just ended, in a points round.
   *
   * Sent only once a round is over, and absent in a classic one, so no screen can
   * draw a scoreboard for a table that is not keeping one.
   */
  readonly roundPoints?: number;
}

/**
 * Everything a non-owning client is allowed to know about the table.
 * Contains no card identities other than the visible discard top, so hands can
 * never leak through a broadcast.
 */
export interface PublicGameState {
  readonly version: number;
  /** Turn counter, so a client can tell whether its intent is still current. */
  readonly turnSeq?: number;
  readonly phase: GamePhase;
  readonly endReason?: GameEndReason;
  /** How this match is won. Absent reads as `classic`. */
  readonly mode?: GameMode;
  readonly players: readonly PublicPlayerView[];
  readonly drawPileCount: number;
  readonly discardTop: Card | null;
  readonly discardCount: number;
  readonly activeColor: CardColor;
  readonly direction: TurnDirection;
  readonly currentPlayerId: PlayerId | null;
  /**
   * Whether the player to move has already taken their card this turn.
   *
   * A boolean, and emphatically not the card's id: the ids in this deck spell the
   * card out — `n-red-5-0` is a red five — so publishing the id would publish a
   * card out of somebody's hand. What everybody at a real table can see is that a
   * hand went to the pile and came back, which is exactly this. The card itself
   * travels only to its owner, in {@link PrivateHandView}.
   */
  readonly hasDrawn: boolean;
  /**
   * Set while a Wild Draw Four waits to be answered. Both seats are named: who
   * played it, and who has to answer. Whether it was a bluff is not — that is the
   * whole question the challenge is for.
   */
  readonly challenge: { readonly playerId: PlayerId; readonly targetId: PlayerId } | null;
  /**
   * Who has called UNO. Public on purpose: at a real table the call is a shout
   * everybody hears, and it is what tells the others whether the player on one
   * card is safe or exposed.
   */
  readonly declaredUno: readonly PlayerId[];
  /**
   * Who can be caught *right now*.
   *
   * The window resolved for the client rather than the raw stamps behind it, so a
   * screen cannot light a catch button a moment after the chance has gone and a bot
   * cannot ask for a catch the room will refuse. It is public for the same reason
   * the calls are: at a table, whether somebody is still catchable is something
   * everybody can see, and it is the only thing the shout is racing.
   */
  readonly catchableUno: readonly PlayerId[];
  readonly winnerId: PlayerId | null;
}

/** A single player's private hand, sent only to that player. */
export interface PrivateHandView {
  readonly version: number;
  readonly playerId: PlayerId;
  readonly cards: readonly Card[];
  /**
   * The card this player has just drawn, when it is their turn and they have.
   *
   * Private, because the id names the card. It is what tells the owner's screen
   * which single card of theirs is still playable.
   */
  readonly drawnCardId?: CardId;
}

/** Seats that can still be caught, given where the turn has got to. */
export function catchableSeats(state: GameState): PlayerId[] {
  return Object.entries(state.unoExposed)
    .filter(([, stamp]) => stamp === state.turnSeq)
    .map(([playerId]) => playerId);
}

export function toPublicGameState(state: GameState): PublicGameState {
  const scored = state.phase === 'finished' && state.mode === 'points';
  return {
    version: state.version,
    turnSeq: state.turnSeq,
    phase: state.phase,
    ...(state.endReason ? { endReason: state.endReason } : {}),
    mode: state.mode,
    players: state.players.map((player) => ({
      id: player.id,
      name: player.name,
      cardCount: (state.hands[player.id] ?? []).length,
      ...(player.left === true ? { left: true } : {}),
      ...(scored ? { roundPoints: state.points[player.id] ?? 0 } : {}),
    })),
    drawPileCount: state.drawPile.length,
    discardTop: topCard(state),
    discardCount: state.discardPile.length,
    activeColor: state.activeColor,
    direction: state.direction,
    currentPlayerId: state.players[state.currentPlayerIndex]?.id ?? null,
    hasDrawn: state.drawnCardId !== null,
    challenge: state.challenge
      ? { playerId: state.challenge.playerId, targetId: state.challenge.targetId }
      : null,
    declaredUno: state.declaredUno.slice(),
    catchableUno: catchableSeats(state),
    winnerId: state.winnerId,
  };
}

export function toPrivateHandView(state: GameState, playerId: PlayerId): PrivateHandView {
  const isTheirTurn = state.players[state.currentPlayerIndex]?.id === playerId;
  return {
    version: state.version,
    playerId,
    cards: (state.hands[playerId] ?? []).slice(),
    ...(isTheirTurn && state.drawnCardId !== null ? { drawnCardId: state.drawnCardId } : {}),
  };
}

/** Rule context derived from public state — identical semantics on room and client. */
export function playContextFromPublic(state: PublicGameState): PlayContext {
  return { activeColor: state.activeColor, topCard: state.discardTop };
}

export interface StandingRow {
  readonly playerId: PlayerId;
  readonly name: string;
  readonly cardCount: number;
  readonly rank: number;
  /** What this seat scored in the round, in a points round only. */
  readonly roundPoints?: number;
}

/**
 * Final standings: fewest remaining cards first, ties share a rank.
 *
 * A player who left is still listed, with the hand they were holding when they
 * went. Dropping them would erase somebody from the standings of a round they may
 * have been winning, which is not an honest result.
 *
 * Cards rather than points, in both modes, because the standings describe the
 * *round*: the winner is the player who went out, and after them the question a
 * table asks is who was closest. The points a round produced are shown beside each
 * row rather than sorted by — sorting by them would put the winner, who scores the
 * lot, at the top of a list they are already at the top of, and reverse everybody
 * else.
 */
export function computeStandings(state: PublicGameState): StandingRow[] {
  const sorted = state.players
    .map((player) => ({ ...player }))
    .sort((a, b) => a.cardCount - b.cardCount || a.name.localeCompare(b.name));

  const rows: StandingRow[] = [];
  let previous: number | null = null;
  let rank = 0;
  sorted.forEach((player, index) => {
    if (previous === null || player.cardCount !== previous) {
      rank = index + 1;
      previous = player.cardCount;
    }
    rows.push({
      playerId: player.id,
      name: player.name,
      cardCount: player.cardCount,
      rank,
      ...(player.roundPoints === undefined ? {} : { roundPoints: player.roundPoints }),
    });
  });
  return rows;
}
