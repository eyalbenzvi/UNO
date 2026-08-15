import type { Card, CardColor, CardKind } from '../engine/cards.ts';
import { CARD_COLORS, cardColor, isNumberCard, requiresColorChoice } from '../engine/cards.ts';
import { getPlayableCardIds } from '../engine/rules.ts';
import type { GameMode } from '../engine/state.ts';
import { computeStandings, playContextFromPublic, type StandingRow } from '../engine/views.ts';
import type { PublicGameState } from '../engine/views.ts';
import type { LobbyPlayer, LobbySnapshot } from '../network/protocol.ts';

/**
 * Derived view-model helpers. Pure functions of store state.
 *
 * Each takes the narrowest slice it actually reads rather than the whole store,
 * so a screen can subscribe to four fields instead of every field and still call
 * these directly. `AppState` satisfies all of them structurally.
 */

/** What every table-side helper below needs, and nothing more. */
export interface TableSnapshot {
  readonly publicState: PublicGameState | null;
  readonly localPlayerId: string | null;
  readonly hand: readonly Card[];
  /**
   * The card this player has drawn this turn, from their own private hand
   * message. `null` when they have not drawn, or when it is not their turn.
   */
  readonly drawnCardId: string | null;
  readonly lobby: LobbySnapshot | null;
}

/**
 * Whether this device holds the lobby buttons.
 *
 * Read off the lobby the room sent rather than off a local flag, and that is the
 * substance of the change rather than a rename. `role === 'host'` was a fact about
 * *this tab* — it meant "the game is running in here" — so it could not move, could
 * not be checked against anything, and was still true after the tab had stopped
 * being able to serve. `creatorPlayerId` is the room's answer, it travels in every
 * snapshot, and it is the same answer every screen at the table gets.
 */
export function amCreator(state: {
  readonly lobby: LobbySnapshot | null;
  readonly localPlayerId: string | null;
}): boolean {
  return (
    state.lobby !== null &&
    state.localPlayerId !== null &&
    state.lobby.creatorPlayerId === state.localPlayerId
  );
}

export function localLobbyPlayer(state: Pick<TableSnapshot, 'lobby' | 'localPlayerId'>): LobbyPlayer | null {
  if (!state.lobby || !state.localPlayerId) {
    return null;
  }
  return state.lobby.players.find((player) => player.id === state.localPlayerId) ?? null;
}

export function seatedPlayers(state: Pick<TableSnapshot, 'lobby'>): readonly LobbyPlayer[] {
  return state.lobby?.players ?? [];
}

/**
 * How the *round on the table* is won.
 *
 * Read off the game state rather than the lobby, because those two can honestly
 * disagree: the lobby carries the mode the next deal will use, and a table that
 * changed its setting between rounds must not relabel the round being played. The
 * lobby's answer is `tableGameMode`, below, and it is only ever used before a deal.
 */
export function roundGameMode(state: Pick<TableSnapshot, 'publicState'>): GameMode {
  return state.publicState?.mode ?? 'classic';
}

/** How the next round will be won, as the room currently intends. */
export function tableGameMode(state: Pick<TableSnapshot, 'lobby'>): GameMode {
  return state.lobby?.gameMode ?? 'classic';
}

/** The local player's running match total, or `null` when nobody is scoring. */
export function myPoints(state: Pick<TableSnapshot, 'lobby' | 'localPlayerId'>): number | null {
  const seat = state.lobby?.players.find((player) => player.id === state.localPlayerId);
  return seat?.points ?? null;
}

export function isMyTurn(state: Pick<TableSnapshot, 'publicState' | 'localPlayerId'>): boolean {
  const { publicState, localPlayerId } = state;
  return (
    publicState !== null &&
    publicState.phase === 'playing' &&
    localPlayerId !== null &&
    publicState.currentPlayerId === localPlayerId
  );
}

/** Whether the local player is the seat that has to answer an open Wild Draw Four. */
export function mustAnswerChallenge(
  state: Pick<TableSnapshot, 'publicState' | 'localPlayerId'>,
): boolean {
  const challenge = state.publicState?.challenge;
  return challenge !== null && challenge !== undefined && challenge.targetId === state.localPlayerId;
}

/**
 * Ids of the cards the local player may legally play right now.
 *
 * Three gates, and the second is the one that has to be here rather than left to
 * the engine: a card already drawn this turn is the *only* card the table will
 * accept, so lighting the rest of the hand would offer taps that are all refused.
 */
export function playableCardIds(
  state: Pick<TableSnapshot, 'publicState' | 'localPlayerId' | 'hand' | 'drawnCardId'>,
): readonly string[] {
  if (!state.publicState) {
    return [];
  }
  // An open Wild Draw Four freezes the table. Nothing is playable by anybody: the
  // seat being waited for answers with a button, not with a card.
  if (state.publicState.challenge) {
    return [];
  }
  if (!isMyTurn(state)) {
    return [];
  }
  const context = playContextFromPublic(state.publicState);
  if (state.drawnCardId !== null) {
    const drawn = state.hand.filter((card) => card.id === state.drawnCardId);
    return getPlayableCardIds(drawn, context);
  }
  return getPlayableCardIds(state.hand, context);
}

/** Whether `playerId` has called UNO for the card they hold now. */
export function hasDeclaredLastCard(state: Pick<TableSnapshot, 'publicState'>, playerId: string): boolean {
  return state.publicState?.declaredUno.includes(playerId) ?? false;
}

/**
 * Whether the local player owes a "last card" declaration.
 *
 * True from the moment their hand comes down to one card until they declare.
 * Deliberately not conditioned on the turn: the declaration is legal at any
 * moment, and the whole point of showing it early is that a player is never
 * caught out on somebody else's turn.
 */
export function mustDeclareLastCard(
  state: Pick<TableSnapshot, 'publicState' | 'localPlayerId' | 'hand'>,
): boolean {
  const { publicState, localPlayerId } = state;
  if (!publicState || publicState.phase !== 'playing' || !localPlayerId) {
    return false;
  }
  return state.hand.length === 1 && !publicState.declaredUno.includes(localPlayerId);
}

export function needsColorChoice(card: Card): boolean {
  return requiresColorChoice(card);
}

export function activeColor(state: Pick<TableSnapshot, 'publicState'>): CardColor | null {
  return state.publicState?.activeColor ?? null;
}

/* Hand order ---------------------------------------------------------------- */

/*
 * The deck's own order, read from the deck rather than repeated here. These two
 * lists used to disagree — the deck built one order and the hand sorted by another
 * — which nothing depended on, which is exactly why it survived.
 */
const COLOR_RANK: Record<CardColor, number> = Object.fromEntries(
  CARD_COLORS.map((color, index) => [color, index]),
) as Record<CardColor, number>;

/** Within a colour: numbers first in value order, then the action cards. */
const KIND_RANK: Record<CardKind, number> = {
  number: 0,
  skip: 1,
  reverse: 2,
  drawTwo: 3,
  wild: 4,
  wildDrawFour: 5,
};

/**
 * The order the hand is shown in: grouped by colour, ordered inside each group,
 * colourless cards last.
 *
 * Purely a display concern — a card is always played by id — but it is the
 * difference between reading a hand of fourteen at a glance and hunting through
 * it. Deal order is meaningless to the player, and it made the hand reshuffle
 * itself visually every time a card was drawn.
 */
export function sortHandForDisplay(hand: readonly Card[]): readonly Card[] {
  return [...hand].sort((a, b) => {
    const colorA = cardColor(a);
    const colorB = cardColor(b);
    const rankA = colorA ? COLOR_RANK[colorA] : 4;
    const rankB = colorB ? COLOR_RANK[colorB] : 4;
    if (rankA !== rankB) {
      return rankA - rankB;
    }
    if (KIND_RANK[a.kind] !== KIND_RANK[b.kind]) {
      return KIND_RANK[a.kind] - KIND_RANK[b.kind];
    }
    const valueA = isNumberCard(a) ? a.value : 0;
    const valueB = isNumberCard(b) ? b.value : 0;
    return valueA - valueB;
  });
}

export interface OpponentView {
  readonly id: string;
  readonly name: string;
  readonly cardCount: number;
  readonly isCurrent: boolean;
  readonly health: LobbyPlayer['health'];
  readonly isCreator: boolean;
  /** Has called UNO for the single card they are holding. */
  readonly declaredLastCard: boolean;
  /**
   * Running match total, or `null` when the table is not keeping one.
   *
   * `null` rather than nought, so a screen can tell "nobody is scoring" from "this
   * player has not scored yet" without having to ask about the mode.
   */
  readonly points: number | null;
  /** Has left the round; their cards are frozen out of play. */
  readonly left: boolean;
  /** On one card and still silent, so this seat can be called out. */
  readonly catchable: boolean;
  /** A robot seat: there is nobody behind it. */
  readonly bot: boolean;
  /** A robot is playing this human's seat while nobody answers for it. */
  readonly standIn: boolean;
}

/**
 * Opponents in play order starting after the local player, so the seating on
 * screen matches the order of play regardless of who is looking.
 */
export function opponents(state: TableSnapshot): readonly OpponentView[] {
  const { publicState, localPlayerId, lobby } = state;
  if (!publicState) {
    return [];
  }
  const players = publicState.players;
  const localIndex = players.findIndex((player) => player.id === localPlayerId);
  // A viewer who holds no seat (nothing dealt yet, or a stale identity) sees the
  // whole table in seat order rather than a truncated list.
  const ordered =
    localIndex >= 0 ? [...players.slice(localIndex + 1), ...players.slice(0, localIndex)] : [...players];

  return ordered
    .filter((player) => player.id !== localPlayerId)
    .map((player) => {
      const lobbyPlayer = lobby?.players.find((candidate) => candidate.id === player.id);
      return {
        id: player.id,
        name: player.name,
        cardCount: player.cardCount,
        points: lobby?.players.find((candidate) => candidate.id === player.id)?.points ?? null,
        isCurrent: publicState.currentPlayerId === player.id,
        health: lobbyPlayer?.health ?? 'connected',
        isCreator: lobbyPlayer?.isCreator ?? false,
        declaredLastCard: publicState.declaredUno.includes(player.id),
        left: player.left === true,
        bot: lobbyPlayer?.bot === true,
        standIn: lobbyPlayer?.standIn === true,
        catchable:
          publicState.phase === 'playing' &&
          /*
           * The window is the room's to publish, and it is read rather than
           * re-derived. Working it out from "one card and no call" would light the
           * button for the rest of the round — the official window shuts the moment
           * the next player begins — and every tap after it would be refused.
           */
          publicState.catchableUno.includes(player.id) &&
          player.left !== true &&
          /*
           * Somebody who is not there cannot shout, so calling them out for
           * silence is not a catch, it is farming — four cards an orbit off a
           * player whose phone is rebooting. The host refuses it too; this only
           * keeps the button from appearing. A seat a robot is playing *can*
           * shout, so it stays as catchable as anybody else — a robot that could
           * not be called out would be the one player at the table above the rule.
           */
          ((lobbyPlayer?.health ?? 'connected') === 'connected' ||
            lobbyPlayer?.bot === true ||
            lobbyPlayer?.standIn === true),
      };
    });
}

/** The seat the table is waiting for, and why, straight from the host. */
export function waitingFor(
  state: Pick<TableSnapshot, 'lobby'>,
): { readonly playerId: string; readonly reason: NonNullable<LobbySnapshot['waitingReason']> } | null {
  const lobby = state.lobby;
  if (!lobby?.waitingFor || !lobby.waitingReason) {
    return null;
  }
  return { playerId: lobby.waitingFor, reason: lobby.waitingReason };
}

/** Seats currently away, with how long the host has been holding them. */
export function absentPlayers(
  state: Pick<TableSnapshot, 'lobby'>,
): readonly { readonly id: string; readonly name: string; readonly absentSince: number }[] {
  const lobby = state.lobby;
  if (!lobby) {
    return [];
  }
  return (
    lobby.players
      /*
       * A seat a robot is playing is not a held seat. The countdown, the "skip now"
       * button and the "we are holding Noa's seat" line would all contradict what
       * the table can see happening — her cards are being played. The robot notice
       * takes its place, and says who it is standing in for.
       */
      .filter((player) => player.absentSince !== undefined && player.left !== true && player.standIn !== true)
      .map((player) => ({
        id: player.id,
        name: player.name,
        absentSince: player.absentSince as number,
      }))
  );
}

/** Seats a robot is playing for their absent or silent owner. */
export function standInPlayers(
  state: Pick<TableSnapshot, 'lobby'>,
): readonly { readonly id: string; readonly name: string }[] {
  const lobby = state.lobby;
  if (!lobby) {
    return [];
  }
  return lobby.players
    .filter((player) => player.standIn === true && player.left !== true)
    .map((player) => ({ id: player.id, name: player.name }));
}

/** Whether this seat is a robot's, or is being played by one. */
export function robotSeat(state: Pick<TableSnapshot, 'lobby'>, playerId: string): boolean {
  const player = state.lobby?.players.find((candidate) => candidate.id === playerId);
  return player?.bot === true || player?.standIn === true || player?.robotPlayed === true;
}

/** Whether the table lets a robot play a seat nobody is answering for. */
export function standInEnabled(state: Pick<TableSnapshot, 'lobby'>): boolean {
  return state.lobby?.standInEnabled !== false;
}

export function isPaused(state: { readonly pausedBy: string | null }): boolean {
  return state.pausedBy !== null;
}

/** Whether the round ended without a winner. */
export function wasAbandoned(state: Pick<TableSnapshot, 'publicState'>): boolean {
  return state.publicState?.endReason === 'abandoned';
}

export function currentPlayerName(state: Pick<TableSnapshot, 'publicState'>): string | null {
  const { publicState } = state;
  if (!publicState?.currentPlayerId) {
    return null;
  }
  return publicState.players.find((player) => player.id === publicState.currentPlayerId)?.name ?? null;
}

export function playerName(state: Pick<TableSnapshot, 'publicState' | 'lobby'>, playerId: string): string {
  const fromState = state.publicState?.players.find((player) => player.id === playerId)?.name;
  if (fromState) {
    return fromState;
  }
  return state.lobby?.players.find((player) => player.id === playerId)?.name ?? playerId;
}

export function standings(state: Pick<TableSnapshot, 'publicState'>): readonly StandingRow[] {
  return state.publicState ? computeStandings(state.publicState) : [];
}

export interface ScoreRow {
  readonly playerId: string;
  readonly name: string;
  readonly wins: number;
  readonly rank: number;
}

/**
 * The room's running score: rounds won, most first.
 *
 * Built from the lobby rather than from the round, because it belongs to the room
 * and not to any one deal — a seat that sat out the round that just ended still has
 * the wins it collected before it. Seats that have left the room are not in the
 * lobby at all, which is exactly right: their score left with them.
 *
 * A table where nobody has won anything yet — the first round of an evening — gets
 * an empty list rather than a column of noughts, so the screen can leave the whole
 * thing out until there is something to say.
 */
export function scoreboard(state: Pick<TableSnapshot, 'lobby'>): readonly ScoreRow[] {
  const players = state.lobby?.players ?? [];
  if (!players.some((player) => (player.wins ?? 0) > 0)) {
    return [];
  }
  const sorted = players
    .map((player) => ({ playerId: player.id, name: player.name, wins: player.wins ?? 0 }))
    .sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));

  let rank = 0;
  let previous: number | null = null;
  return sorted.map((row, index) => {
    if (previous === null || row.wins !== previous) {
      rank = index + 1;
      previous = row.wins;
    }
    return { ...row, rank };
  });
}

export function winnerName(state: Pick<TableSnapshot, 'publicState' | 'lobby'>): string | null {
  const winnerId = state.publicState?.winnerId;
  return winnerId ? playerName(state, winnerId) : null;
}



export function connectedCount(state: Pick<TableSnapshot, 'lobby'>): number {
  return seatedPlayers(state).filter((player) => player.health !== 'disconnected').length;
}

export function everyoneConnected(state: Pick<TableSnapshot, 'lobby'>): boolean {
  // A robot is always here, so it never triggers the "start with somebody
  // unstable?" question. Nothing about it can improve by waiting.
  return seatedPlayers(state).every((player) => player.health === 'connected' || player.bot === true);
}
