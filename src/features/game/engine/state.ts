import type { AssistWeights } from './assist.ts';
import type { Card, CardColor, CardId } from './cards.ts';
import type { RngState } from './prng.ts';

export type PlayerId = string;

/** Turn direction: `1` follows the seating order, `-1` reverses it. */
export type TurnDirection = 1 | -1;

export interface EnginePlayer {
  readonly id: PlayerId;
  readonly name: string;
  /**
   * Set when a player has left the round for good.
   *
   * They are *marked*, never removed from `players`, and that is a deliberate
   * design decision rather than laziness. Splicing a seat out mid-round breaks
   * four things at once: a challenge window naming them can never be answered, so
   * every command from every seat is refused for the rest of the game;
   * `currentPlayerIndex` silently points at the wrong player whenever the removed
   * seat sat before it; the public state drops below the two players the wire
   * schema requires, so the final broadcast is unparseable and nobody sees the
   * round end; and the player vanishes from the standings of a round they may have
   * been winning.
   *
   * Marking costs one flag and one condition inside `advanceTurn`. Card
   * conservation then holds by construction — their hand is simply frozen out of
   * play, with no reshuffle and no random numbers consumed.
   */
  readonly left?: boolean;
}

/**
 * A Wild Draw Four waiting for its victim to answer.
 *
 * The card is playable as a bluff — see `isWildDrawFourHonest` — and the next
 * player may either take the four cards or call the bluff. While this is set the
 * whole table is frozen: the only moves are the target's two answers, and the two
 * shouts that are legal at any moment.
 */
export interface ChallengeState {
  /** Who played the Wild Draw Four. */
  readonly playerId: PlayerId;
  /** The next active seat — the only seat that may answer, and the one drawing four. */
  readonly targetId: PlayerId;
  /**
   * Whether the play was a bluff. The whole verdict, decided once, at play time.
   *
   * Precomputed rather than re-derived when the challenge is made, for two
   * reasons. The obvious one is that the hand can change in between: the two
   * shouts stay legal while the table is frozen, so a caught UNO can add two cards
   * to the very hand a challenge would be judged against — and a player who
   * bluffed should not be exonerated by being caught out, nor an honest one
   * condemned by it.
   *
   * The other is what the alternative would cost. Snapshotting the hand instead
   * would put a second copy of real cards inside the state: the conservation
   * census would have to learn to ignore them, `views.ts` would gain a field that
   * must be *remembered* to be excluded from every projection, and the stored
   * round would carry the duplicate through every hibernation. A boolean has none
   * of those properties and answers exactly the same question.
   */
  readonly bluffed: boolean;
}

export type GamePhase = 'playing' | 'finished';

/**
 * How a match is won.
 *
 * `classic` is the short game: empty your hand and the round is yours, and the
 * room counts rounds won. `points` is the official match — the winner of a round
 * scores what everybody else is still holding, and the first player to 500 takes
 * the game. See `docs/rules.md` for the scoring table.
 *
 * A property of the round rather than of the table, and it lives in `GameState`
 * for that reason: the mode a round was dealt under has to survive a hibernation
 * and reach every client, and a round already in play must not change how it is
 * scored because somebody opened the room settings.
 */
export type GameMode = 'classic' | 'points';

/**
 * Why a round ended.
 *
 * `abandoned` exists because "the last player standing wins" is not a result. A
 * two-player table whose opponent's phone blinks for twenty seconds would hand the
 * round to whoever was left. A round that runs out of players has no winner, and
 * says so.
 */
export type GameEndReason = 'won' | 'abandoned';

/**
 * Complete authoritative game state. Serialisable, never mutated in place.
 * Only the room holds a full copy (it contains every hand).
 */
export interface GameState {
  /** Monotonic version, incremented on every accepted command. */
  readonly version: number;
  readonly phase: GamePhase;
  /** How this match is won. Fixed when the round is dealt; see {@link GameMode}. */
  readonly mode: GameMode;
  readonly players: readonly EnginePlayer[];
  /**
   * How far the deal and the draw pile lean towards each seat. See `assist.ts`.
   *
   * A property of the *round*, exactly as `mode` is, and fixed by the same
   * argument: a round is dealt the way it is dealt. The alternative — reading it
   * out of the room on every command — would mean a hand dealt generously could be
   * drawn into meanly halfway through, at the moment somebody happened to change a
   * setting, and a replayed round would depend on something outside the state it
   * replays from.
   *
   * Private information, and more sharply so than the hands beside it: a hand is
   * secret until it is played, this is secret for good. It has no projection in
   * `views.ts` and it is never any part of what a client is sent — see
   * `docs/assist.md`.
   */
  readonly assist: AssistWeights;
  /** Hands keyed by player id. Private information. */
  readonly hands: Readonly<Record<PlayerId, readonly Card[]>>;
  /** Face-down pile; index 0 is the next card to be drawn. */
  readonly drawPile: readonly Card[];
  /** Face-up pile; the last element is the visible top card. */
  readonly discardPile: readonly Card[];
  /** Colour that must currently be matched. */
  readonly activeColor: CardColor;
  readonly direction: TurnDirection;
  readonly currentPlayerIndex: number;
  /**
   * The card the player to move has just taken from the pile, or `null`.
   *
   * This is the whole of UNO's draw rule. A turn with nothing playable is not
   * over: you take one card, and if it can be played you may play it — that one
   * and nothing else from your hand. While this is set the only moves its owner
   * has are playing exactly this card or passing the turn.
   *
   * **Private.** The ids in this deck spell the card out (`n-red-5-0`), so
   * publishing this would publish the card. What the table is told is that a card
   * was drawn — `hasDrawn` in the public view — which is all anybody at a real
   * table can see. See `views.ts`.
   */
  readonly drawnCardId: CardId | null;
  /** Open Wild Draw Four waiting to be answered, or `null`. */
  readonly challenge: ChallengeState | null;
  /**
   * Players who have called UNO for the single card they are holding now. A player
   * leaves this list the moment their hand stops being exactly one card, so coming
   * back down to one card needs a fresh call.
   */
  readonly declaredUno: readonly PlayerId[];
  /**
   * Seats that can still be caught, and the turn on which they became catchable.
   *
   * The window the official rule gives you — "before the next player begins their
   * turn" — made explicit. A seat is stamped when its hand reaches a single
   * undeclared card, and the stamp is spent the moment the next player does
   * anything at all. Without it the game is not UNO: a silent player would stay
   * catchable for the rest of the round, which turns a two-second reflex into a
   * standing bounty and makes calling UNO pointless, since there would be no
   * moment at which staying quiet became safe.
   */
  readonly unoExposed: Readonly<Record<PlayerId, number>>;
  /**
   * What each player scored in the round that has just finished, in `points`.
   *
   * Written once, when a round ends, and empty until then. The running match total
   * is the room's — it outlives a round, exactly as the rounds-won count does — and
   * this is only the round's own arithmetic, so the standings screen can show the
   * sum it was built from rather than a number that appeared from nowhere.
   */
  readonly points: Readonly<Record<PlayerId, number>>;
  readonly rng: RngState;
  readonly winnerId: PlayerId | null;
  /** Why the round ended, or `null` while it is still running. */
  readonly endReason: GameEndReason | null;
  /**
   * Counts turn handovers, not commands.
   *
   * `version` moves for everything, including the out-of-turn calls and catches
   * that are legal at any moment — which makes it useless as a way for a client to
   * ask "is my move still meant for the table I was looking at?". This does answer
   * that, because it changes only when the turn does.
   */
  readonly turnSeq: number;
  /** Seed the game was created with, kept for reproducibility/debugging. */
  readonly seed: number;
}

export type GameCommand =
  | {
      readonly type: 'playCard';
      readonly playerId: PlayerId;
      readonly cardId: CardId;
      /** Required for wild cards, forbidden otherwise. */
      readonly chosenColor?: CardColor;
      /**
       * Calls "UNO!" as the card goes down, in the same move.
       *
       * At a table the two are one gesture, and the separate button only exists
       * because a screen cannot hear you. That is fine when the play is a single
       * tap — the button is there the moment the hand is — but a card that asks
       * for a colour first puts a dialog between the two, and the head start is
       * spent choosing rather than reaching. So the choice carries the call.
       *
       * Ignored unless the play actually leaves exactly one card in hand, which
       * makes it safe to set optimistically: a play that wins the round, or one
       * that draws a penalty on the way, simply does not declare.
       */
      readonly declareUno?: boolean;
    }
  /** Takes the one card a turn with nothing to play costs. Does not end the turn. */
  | { readonly type: 'drawCard'; readonly playerId: PlayerId }
  /**
   * Ends a turn after drawing.
   *
   * Only legal once a card has been drawn — there is no free pass in UNO, you play
   * or you draw. The one exception is a pile with nothing left in it, discard
   * included: `drawCard` then takes nothing, and refusing the pass as well would
   * leave the turn with no legal move at all.
   */
  | { readonly type: 'passTurn'; readonly playerId: PlayerId }
  /** Takes the four cards rather than calling the bluff. */
  | { readonly type: 'acceptWildDrawFour'; readonly playerId: PlayerId }
  /** Calls the bluff: the player shows whether they held the colour. */
  | { readonly type: 'challengeWildDrawFour'; readonly playerId: PlayerId }
  /**
   * Calls "UNO!". Legal from any seat, in or out of turn, and only while the
   * calling player holds exactly one card.
   */
  | { readonly type: 'declareUno'; readonly playerId: PlayerId }
  /**
   * Catches `targetId` sitting on a single card they never called. Legal from any
   * seat but their own, in or out of turn, and only inside the window — see
   * {@link GameState.unoExposed}.
   */
  | { readonly type: 'catchUno'; readonly playerId: PlayerId; readonly targetId: PlayerId }
  /**
   * Passes the turn of a player who is not there.
   *
   * Room-only: it is deliberately absent from the wire protocol, because a client
   * that could ask for it could skip anybody. See `docs/rules.md` for the full
   * rule table — the short version is that a skip costs the one card the turn
   * itself would have cost, and no more. A disconnect is not a decision, and
   * charging more than the turn's own price would leave a returning player several
   * cards down after a seat had been faithfully held for them, which would make the
   * whole promise of holding it theatre. A seat that had already drawn pays
   * nothing further: it has taken its card.
   */
  | { readonly type: 'skipTurn'; readonly playerId: PlayerId }
  /** Marks a player as having left for good, without disturbing the round. */
  | { readonly type: 'leaveGame'; readonly playerId: PlayerId }
  /**
   * Ends the round with no winner, by agreement of the table.
   *
   * This is what a real table does when somebody has to leave: you stop, and
   * nobody pretends the interrupted hand produced a champion.
   */
  | { readonly type: 'abandonRound'; readonly playerId: PlayerId };

export type GameCommandType = GameCommand['type'];

export type GameEvent =
  | { readonly type: 'gameStarted'; readonly firstPlayerId: PlayerId; readonly activeColor: CardColor }
  | {
      readonly type: 'cardPlayed';
      readonly playerId: PlayerId;
      readonly card: Card;
      readonly resultingColor: CardColor;
    }
  | { readonly type: 'cardDrawn'; readonly playerId: PlayerId; readonly count: number }
  /** A turn ended on the card that was drawn, without playing it. */
  | { readonly type: 'turnPassed'; readonly playerId: PlayerId }
  | { readonly type: 'colorChosen'; readonly playerId: PlayerId; readonly color: CardColor }
  | { readonly type: 'playerSkipped'; readonly playerId: PlayerId }
  /** A Wild Draw Four was played and is waiting for its victim to answer. */
  | { readonly type: 'challengeOpened'; readonly playerId: PlayerId; readonly targetId: PlayerId }
  /** The victim took the four cards without calling the bluff. */
  | { readonly type: 'challengeDeclined'; readonly playerId: PlayerId; readonly drawn: number }
  /**
   * The bluff was called. `bluffed` is the verdict and `drawn` is what the loser
   * actually took — the player who bluffed draws four, and a challenger who was
   * wrong draws six.
   */
  | {
      readonly type: 'challengeResolved';
      readonly challengerId: PlayerId;
      readonly targetId: PlayerId;
      readonly bluffed: boolean;
      readonly drawn: number;
    }
  | { readonly type: 'unoDeclared'; readonly playerId: PlayerId }
  /**
   * `caughtById` caught `playerId` sitting silently on a single card. `penalty`
   * is how many cards they actually drew.
   */
  | {
      readonly type: 'unoCaught';
      readonly playerId: PlayerId;
      readonly caughtById: PlayerId;
      readonly penalty: number;
    }
  | { readonly type: 'directionChanged'; readonly direction: TurnDirection }
  | { readonly type: 'turnChanged'; readonly playerId: PlayerId }
  | { readonly type: 'drawPileRecycled'; readonly count: number }
  | { readonly type: 'drawPileExhausted' }
  | { readonly type: 'playerWon'; readonly playerId: PlayerId }
  /** What the winner scored from everybody else's hands, in a points round. */
  | { readonly type: 'roundScored'; readonly playerId: PlayerId; readonly points: number }
  /** A turn was passed for somebody who was not there. `drew` is what they owed. */
  | { readonly type: 'turnSkipped'; readonly playerId: PlayerId; readonly drew: number }
  | { readonly type: 'playerLeft'; readonly playerId: PlayerId }
  /** The round ran out of players. There is no winner. */
  | { readonly type: 'roundAbandoned' };

export type GameEventType = GameEvent['type'];

/**
 * Machine-readable rejection codes; the UI maps them to localised strings.
 *
 * Every code here is one this engine can actually emit. The game this one is
 * built from kept retired codes in the vocabulary so that an older host on a
 * mixed table could still be understood — an argument that belonged to a
 * peer-to-peer topology with two browsers on either side of a version gate. Here
 * there is one deployed room, every client talks only to it, and the protocol is
 * at version 1: there is no older anything. A code nobody emits would be dead
 * weight that both dictionaries would still have to carry a translation for.
 */
export const REJECTION_CODES = [
  'gameFinished',
  'unknownPlayer',
  'notYourTurn',
  'cardNotInHand',
  'illegalCard',
  'colorRequired',
  'colorNotAllowed',
  /** Played something other than the card just drawn. See {@link GameState.drawnCardId}. */
  'onlyDrawnCardPlayable',
  /** Asked for a second card in one turn. */
  'alreadyDrew',
  /** Asked to end a turn without having drawn, and with cards left to draw. */
  'nothingToPass',
  /** The table is frozen while a Wild Draw Four waits to be answered. */
  'awaitingChallenge',
  /** Answered a challenge when none is open. */
  'noChallengeOpen',
  /** Answered a challenge addressed to somebody else. */
  'notTheChallenger',
  'nothingToDeclare',
  'alreadyDeclared',
  'nothingToCatch',
  'notEnoughPlayers',
  'tooManyPlayers',
  'duplicatePlayerId',
  /** Asked to skip a seat that is not the one the table is waiting for. */
  'nothingToSkip',
  /** Asked to act for, or remove, a player who has already left. */
  'alreadyLeft',
  /** The table is holding at somebody's request. */
  'tablePaused',
] as const;

export type RejectionCode = (typeof REJECTION_CODES)[number];

export interface CommandRejection {
  readonly code: RejectionCode;
}

export type CommandResult =
  | { readonly ok: true; readonly state: GameState; readonly events: readonly GameEvent[] }
  | { readonly ok: false; readonly rejection: CommandRejection };

export const MIN_PLAYERS = 2;

/**
 * Six, where the official game says ten.
 *
 * A product limitation rather than a rule: the seat geometry, the table layout and
 * its 320-pixel regression tests are built for six chairs, and ten would be an
 * interface project rather than a change to the rules. Stated plainly in
 * `docs/rules.md` rather than left for somebody to discover.
 */
export const MAX_PLAYERS = 6;
