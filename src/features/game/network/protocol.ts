import { z } from 'zod';
import { DISPLAY_NAME_MAX_LENGTH } from '../../../lib/sanitize.ts';

/*
 * Zod compiles validators with `new Function` when it can, and probes for that
 * with `Function('')`. Our Content Security Policy has no `'unsafe-eval'`, so
 * the probe throws, Zod falls back to its interpreted path, and the browser
 * logs a CSP violation on every load. Declaring `jitless` skips the probe: same
 * behaviour we already get, without weakening the policy or the console noise.
 */
z.config({ jitless: true });
import { ASSIST_LEVELS } from '../engine/assist.ts';
import type { Card } from '../engine/cards.ts';
import { REJECTION_CODES } from '../engine/state.ts';

/**
 * Wire protocol for UNO.
 *
 * Every message is validated at runtime before it can influence any state.
 * See `docs/protocol.md` for the human-readable specification.
 */

/**
 * Bumped on any breaking change to message shapes or semantics.
 *
 * 1 — the first version of this game. It carries none of the history of the game
 * it was built from: that numbering described a different deck, a different set of
 * rules and a different set of messages, and continuing it would have implied a
 * compatibility that does not exist. No client has ever spoken an earlier version
 * of *this* protocol, because there is no earlier version.
 */
export const PROTOCOL_VERSION = 1;

/**
 * Versions this build will *accept*, as opposed to the one it sends.
 *
 * A single entry, and permanently so. The room is one deployed worker, every
 * client talks only to it, and a stale tab meets a server that is always the newer
 * of the two — so the honest answer is "reload", which is exactly what the gate
 * says. Mixed-version tables are not a thing to be compatible with.
 */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly number[] = [PROTOCOL_VERSION];

/** Hard cap on a single decoded message, to bound memory from a hostile peer. */
export const MAX_MESSAGE_BYTES = 64 * 1024;

const colorSchema = z.enum(['red', 'yellow', 'green', 'blue']);
const cardIdSchema = z.string().min(1).max(40);
// Nought through nine. The nought is printed once per colour and the rest twice,
// which is a fact about the deck rather than about this union.
const numberValueSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
  z.literal(8),
  z.literal(9),
]);

export const cardSchema = z.discriminatedUnion('kind', [
  z.object({ id: cardIdSchema, kind: z.literal('number'), color: colorSchema, value: numberValueSchema }),
  z.object({ id: cardIdSchema, kind: z.literal('skip'), color: colorSchema }),
  z.object({ id: cardIdSchema, kind: z.literal('reverse'), color: colorSchema }),
  z.object({ id: cardIdSchema, kind: z.literal('drawTwo'), color: colorSchema }),
  z.object({ id: cardIdSchema, kind: z.literal('wild') }),
  z.object({ id: cardIdSchema, kind: z.literal('wildDrawFour') }),
]);

// Compile-time proof that the schema and the engine model cannot drift apart.
const _cardSchemaMatchesEngine: z.ZodType<Card> = cardSchema;
void _cardSchemaMatchesEngine;

const playerIdSchema = z.string().min(1).max(64);
const displayNameSchema = z.string().min(1).max(DISPLAY_NAME_MAX_LENGTH);
const resumeTokenSchema = z.string().min(8).max(64);
const directionSchema = z.union([z.literal(1), z.literal(-1)]);
const rejectionCodeSchema = z.enum(REJECTION_CODES);
/**
 * How a match is won: the short game, or the official 500-point one.
 *
 * Optional wherever it appears on the wire, and absent means `classic` — the
 * shorter game, and the safe reading either way: a client that assumed a scored
 * match where there is none would wait for a total that never arrives.
 */
const gameModeSchema = z.enum(['classic', 'points']);
/** What one seat scored in one round. A whole table's hands cannot exceed this. */
const roundPointsSchema = z.number().int().min(0).max(2000);

const assistLevelSchema = z.enum(ASSIST_LEVELS);

/**
 * Who the table is quietly leaning towards, and how far.
 *
 * The one thing in this protocol that is deliberately *not* in the lobby snapshot.
 * Everything else a table decides — its size, its mode, whether robots may cover a
 * seat — is broadcast to every player, on the argument that a fact about the table
 * belongs to everybody at it. This is the exception, and the exception is the
 * feature: an easement that is announced is not an easement, it is a label, and the
 * child wearing it would rather have lost.
 *
 * So it travels in a message of its own, sent to one seat — see `assistState` — and
 * every screen that is not the creator's is told nothing whatever. See
 * `docs/assist.md`.
 */
export const assistSettingsSchema = z.object({
  level: assistLevelSchema,
  /** Seats the table is leaning towards. Never all of them; the room refuses that. */
  playerIds: z.array(playerIdSchema).max(6).readonly(),
});
export type AssistSettings = z.infer<typeof assistSettingsSchema>;

export const publicGameStateSchema = z.object({
  version: z.number().int().nonnegative(),
  /**
   * Turn counter, used by a client to ask "is my move still meant for the table I
   * was looking at?". Optional so a version-3 peer stays readable.
   */
  turnSeq: z.number().int().nonnegative().optional(),
  phase: z.enum(['playing', 'finished']),
  endReason: z.enum(['won', 'abandoned']).optional(),
  /** How this round is won; see {@link gameModeSchema}. */
  mode: gameModeSchema.optional(),
  players: z
    .array(
      z.object({
        id: playerIdSchema,
        name: displayNameSchema,
        cardCount: z.number().int().min(0).max(200),
        /**
         * What this seat scored in the round that has just ended.
         *
         * Absent until a points round is over, so no screen can draw a scoreboard
         * for a table that is not keeping one.
         */
        roundPoints: roundPointsSchema.optional(),
        /**
         * True for a seat that has left the round for good.
         *
         * Because they are marked rather than deleted, the array never shrinks
         * below the two players this schema requires — which is what stops the
         * final broadcast of a round that ran out of players from being
         * unparseable to everybody receiving it.
         */
        left: z.boolean().optional(),
      }),
    )
    .min(2)
    .max(6)
    .readonly(),
  drawPileCount: z.number().int().min(0).max(200),
  discardTop: cardSchema.nullable(),
  discardCount: z.number().int().min(0).max(200),
  activeColor: colorSchema,
  direction: directionSchema,
  currentPlayerId: playerIdSchema.nullable(),
  /**
   * Whether the player to move has already taken their card this turn. A boolean
   * and never the card's id — the ids in this deck name the card.
   */
  hasDrawn: z.boolean(),
  challenge: z.object({ playerId: playerIdSchema, targetId: playerIdSchema }).nullable(),
  declaredUno: z.array(playerIdSchema).max(6).readonly(),
  /** Seats that can be caught right now, with the window already resolved. */
  catchableUno: z.array(playerIdSchema).max(6).readonly(),
  winnerId: playerIdSchema.nullable(),
});

export const privateHandSchema = z.object({
  version: z.number().int().nonnegative(),
  playerId: playerIdSchema,
  cards: z.array(cardSchema).max(200).readonly(),
  /**
   * The card this seat has just drawn, when it is their turn and they have.
   *
   * Here rather than in the public table because the id names the card, and this
   * message is the only one that goes to a single seat.
   */
  drawnCardId: cardIdSchema.optional(),
});

export const gameEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('gameStarted'), firstPlayerId: playerIdSchema, activeColor: colorSchema }),
  z.object({
    type: z.literal('cardPlayed'),
    playerId: playerIdSchema,
    card: cardSchema,
    resultingColor: colorSchema,
  }),
  z.object({
    type: z.literal('cardDrawn'),
    playerId: playerIdSchema,
    count: z.number().int().min(1).max(200),
  }),
  z.object({ type: z.literal('turnPassed'), playerId: playerIdSchema }),
  z.object({ type: z.literal('colorChosen'), playerId: playerIdSchema, color: colorSchema }),
  z.object({ type: z.literal('playerSkipped'), playerId: playerIdSchema }),
  z.object({
    type: z.literal('challengeOpened'),
    playerId: playerIdSchema,
    targetId: playerIdSchema,
  }),
  z.object({
    type: z.literal('challengeDeclined'),
    playerId: playerIdSchema,
    drawn: z.number().int().min(0).max(200),
  }),
  z.object({
    type: z.literal('challengeResolved'),
    challengerId: playerIdSchema,
    targetId: playerIdSchema,
    /*
     * The verdict travels; the hand it was reached from does not. A table is told
     * that somebody bluffed, which is what a table would see — and nothing about
     * what else they were holding, which it would not.
     */
    bluffed: z.boolean(),
    drawn: z.number().int().min(0).max(200),
  }),
  z.object({ type: z.literal('unoDeclared'), playerId: playerIdSchema }),
  z.object({
    type: z.literal('unoCaught'),
    playerId: playerIdSchema,
    caughtById: playerIdSchema,
    penalty: z.number().int().min(0).max(200),
  }),
  z.object({ type: z.literal('directionChanged'), direction: directionSchema }),
  z.object({ type: z.literal('turnChanged'), playerId: playerIdSchema }),
  z.object({ type: z.literal('drawPileRecycled'), count: z.number().int().min(0).max(200) }),
  z.object({ type: z.literal('drawPileExhausted') }),
  z.object({ type: z.literal('playerWon'), playerId: playerIdSchema }),
  z.object({
    type: z.literal('roundScored'),
    playerId: playerIdSchema,
    points: roundPointsSchema,
  }),
  z.object({
    type: z.literal('turnSkipped'),
    playerId: playerIdSchema,
    drew: z.number().int().min(0).max(200),
  }),
  z.object({ type: z.literal('playerLeft'), playerId: playerIdSchema }),
  z.object({ type: z.literal('roundAbandoned') }),
]);

/**
 * A seat's link quality, as the room can actually observe it.
 *
 * Two states, not three. `'unstable'` existed because the authority was another
 * browser and had to *infer* presence from unanswered probes — so it needed a word
 * for "we are counting missed pings and are not sure yet". The room is told when a
 * socket closes, by the runtime, as it happens. There is nothing left to be unsure
 * about, and a state that only ever meant uncertainty has nothing to describe.
 */
export const connectionHealthSchema = z.enum(['connected', 'disconnected']);
export type ConnectionHealth = z.infer<typeof connectionHealthSchema>;

export const lobbyPlayerSchema = z.object({
  id: playerIdSchema,
  name: displayNameSchema,
  /** Whether this seat holds the lobby buttons. Not an authority; see `creatorPlayerId`. */
  isCreator: z.boolean(),
  health: connectionHealthSchema,
  /** Seat order; stable for the lifetime of the room. */
  seat: z.number().int().min(0).max(5),
  /**
   * When this seat went quiet, on the *room's* clock, paired with the snapshot's
   * `sentAt` so a client can work out its own offset once.
   *
   * A pre-computed duration was the obvious shape and the wrong one: it is stale
   * the moment it is sent, and a live countdown would force a full lobby
   * broadcast — and a re-render of the whole table — on every snapshot.
   */
  absentSince: z.number().int().min(0).optional(),
  /** True once this seat has left the round for good. */
  left: z.boolean().optional(),
  /** A robot seat: there is no device behind it, and never will be. */
  bot: z.boolean().optional(),
  /** A robot is playing this human's seat while nobody is answering for it. */
  standIn: z.boolean().optional(),
  /**
   * A robot played this seat at some point in the round that just ended.
   *
   * Kept separate from `standIn`, which is about right now: a round decided partly by
   * a robot reads differently from one that was not, and by the time the standings are
   * up the player is usually back — so the live flag would have cleared.
   */
  robotPlayed: z.boolean().optional(),
  /**
   * Rounds this seat has won since the room opened.
   *
   * The whole of the scoring: wins, not cards. Counting the cards left in everybody
   * else's hands would make the score a measure of how badly the losers lost, which
   * is a different game from the one being played — and it would need a rule for an
   * abandoned round, where nobody lost anything.
   *
   * It belongs to the *seat*, so it lives exactly as long as the seat does: a room
   * that closes takes every score with it, and a player who leaves for good and
   * comes back arrives on nought. Optional on the wire, and absent reads as nought,
   * so a snapshot from a room that predates the score still parses.
   */
  wins: z.number().int().min(0).max(10_000).optional(),
  /**
   * This seat's running total in a points match.
   *
   * Beside `wins` and belonging to the seat in exactly the same way. Absent reads
   * as nought, and it is absent entirely in a classic match — a score nobody is
   * keeping should not be rendered as a nought everybody can see.
   */
  points: z.number().int().min(0).max(100_000).optional(),
});

export const lobbySnapshotSchema = z.object({
  roomCode: z.string().min(3).max(32),
  /**
   * The seat that holds the lobby buttons: start the game, set the size, remove
   * somebody, seat a robot.
   *
   * Emphatically not an authority. It used to be `hostPlayerId` and it named the
   * device the whole game was running on; it now names a seat like any other, whose
   * only privilege is over the lobby. If that seat leaves the room the powers pass
   * to the lowest-numbered remaining one, so a table can always be started.
   */
  creatorPlayerId: playerIdSchema,
  maxPlayers: z.number().int().min(2).max(6),
  phase: z.enum(['lobby', 'inGame', 'finished']),
  players: z.array(lobbyPlayerSchema).max(6).readonly(),
  /** Table language the room suggests; clients may override locally. */
  tableLanguage: z.enum(['he', 'en']),
  /**
   * How the *next* round will be won, chosen when the table is set up.
   *
   * On the wire because it is a fact about the table every player is entitled to
   * know before the deal, not only the seat that chose it — and because a round in
   * play carries its own mode in the game state, which this must never contradict.
   */
  gameMode: gameModeSchema.optional(),
  /** The room's clock when this snapshot was built. */
  sentAt: z.number().int().min(0),
  /**
   * How long the room will hold an absent seat.
   *
   * On the wire because there must be exactly one authority for it. The client
   * derives its own give-up deadline from this rather than declaring a second
   * number, so the countdown a player is shown can never be contradicted by the
   * timer running underneath it.
   */
  seatGraceMs: z.number().int().min(0),
  /** Whether the table is paused, and who asked. */
  pausedBy: playerIdSchema.nullable(),
  /** Who the table is waiting for, and why — so no screen has to guess. */
  waitingFor: playerIdSchema.nullable(),
  waitingReason: z.enum(['turn', 'absent', 'challenge', 'paused']).nullable(),
  /** Room clock at which the table started waiting, paired with `sentAt`. */
  waitingSince: z.number().int().min(0).nullable(),
  /** Players who have voted to abandon the round. */
  abandonVotes: z.array(playerIdSchema).max(6).readonly(),
  /**
   * Whether this table lets a robot play a seat nobody is answering for.
   *
   * On the wire because it is a fact about the room every player is entitled to
   * know, not only the seat that set it.
   */
  standInEnabled: z.boolean(),
});

export type LobbySnapshot = z.infer<typeof lobbySnapshotSchema>;
export type LobbyPlayer = z.infer<typeof lobbyPlayerSchema>;

/** Action a client asks for. The room attaches the authenticated player id. */
export const gameActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('playCard'),
    cardId: cardIdSchema,
    /** Required for both wilds, refused for everything else. */
    chosenColor: colorSchema.optional(),
    /*
     * "UNO!" called with the card rather than after it. Honoured by the engine only
     * when the play really does leave one card in hand, which is what makes it safe
     * to send optimistically.
     */
    declareUno: z.boolean().optional(),
  }),
  z.object({ type: z.literal('drawCard') }),
  z.object({ type: z.literal('passTurn') }),
  z.object({ type: z.literal('acceptWildDrawFour') }),
  z.object({ type: z.literal('challengeWildDrawFour') }),
  z.object({ type: z.literal('declareUno') }),
  z.object({ type: z.literal('catchUno'), targetId: playerIdSchema }),
]);
export type GameAction = z.infer<typeof gameActionSchema>;

/**
 * The actions that belong to a turn, and may therefore carry a turn token.
 *
 * Declared once and imported by both the client that stamps the token and the room
 * that checks it. It used to be written out twice, in two packages, as two literals
 * that happened to agree — and a list like that only has to disagree once, in the
 * direction where a stale replayed action ends an innocent player's turn.
 *
 * Calling UNO, catching somebody who did not, and answering a Wild Draw Four are
 * deliberately absent: they are legal at any moment, they race each other on
 * purpose, and gating them on a turn would hand every tie to whoever broke the rule.
 */
export const TURN_SCOPED_ACTIONS = ['playCard', 'drawCard', 'passTurn'] as const;

export function isTurnScoped(action: GameAction): boolean {
  return (TURN_SCOPED_ACTIONS as readonly string[]).includes(action.type);
}

export const joinRejectionReasonSchema = z.enum([
  'roomFull',
  'gameInProgress',
  'invalidName',
  'protocolMismatch',
  'unknownSeat',
  'invalidResumeToken',
  'roomClosed',
  /**
   * Asked to *create* a room that already has players in it.
   *
   * A room code collision, which used to surface as the relay refusing a peer id
   * claim. The client draws another six digits and tries again, exactly as before —
   * there is simply no id to claim any more, so the room itself answers.
   */
  'roomTaken',
]);
export type JoinRejectionReason = z.infer<typeof joinRejectionReasonSchema>;

/**
 * Why the room stopped.
 *
 * Both of these are terminal, and that is the whole difference from the four
 * reasons this replaced. A host could stop serving without the room ending —
 * reloading, or handing over — so a client had to tell a goodbye from a
 * see-you-in-a-moment and hold its seat through the second. The room does not
 * reload and does not move: if it says it is closed, it is.
 */
export const roomClosedReasonSchema = z.enum(['roomClosed']);
export const kickReasonSchema = z.enum(['removedByCreator', 'duplicateConnection']);

const envelopeShape = {
  protocolVersion: z.number().int().min(0).max(1000),
  id: z.string().min(1).max(64),
  roomId: z.string().min(3).max(32),
  senderPeerId: z.string().min(1).max(64),
  timestamp: z.number().int().min(0),
} as const;

/** Loose first pass used to read the version before full validation. */
export const envelopePreflightSchema = z.object({
  ...envelopeShape,
  type: z.string().min(1).max(40),
});

function message<TType extends string, TPayload extends z.ZodTypeAny>(type: TType, payload: TPayload) {
  return z.object({ ...envelopeShape, type: z.literal(type), payload });
}

/** Identifies one *intent*, stable across re-sends. */
const requestIdSchema = z.string().min(1).max(64);

/**
 * The turn a client believed was in play when it decided to move.
 *
 * Checked only for the moves that belong to a turn. It deliberately is *not*
 * checked for declaring last card, catching somebody who did not, or answering a
 * +3 — those are legal at any moment by design, they race each other on purpose,
 * and gating them on a turn would hand every tie to whoever broke the rule.
 */
const turnTokenSchema = z.object({
  currentPlayerId: playerIdSchema.nullable(),
  turnSeq: z.number().int().nonnegative(),
});

/**
 * The lobby powers, as messages.
 *
 * Every one of these used to be a method call on the local `HostSession`, which is
 * why they were never on the wire: the person with the buttons was, by
 * construction, the person running the game. Now they travel, and the room
 * authorises each one against `creatorPlayerId` — so the buttons follow a
 * credential rather than following whichever device happens to be serving.
 *
 * One message type rather than ten keeps the top-level union readable and, more to
 * the point, keeps the authorisation check in exactly one place.
 */
export const roomCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('startGame') }),
  z.object({ type: z.literal('setMaxPlayers'), maxPlayers: z.number().int().min(2).max(6) }),
  z.object({ type: z.literal('setTableLanguage'), language: z.enum(['he', 'en']) }),
  /** Picks the mode for the next round. Refused once cards are dealt. */
  z.object({ type: z.literal('setGameMode'), mode: gameModeSchema }),
  z.object({ type: z.literal('kickPlayer'), playerId: playerIdSchema }),
  z.object({ type: z.literal('addBot') }),
  z.object({ type: z.literal('setStandInEnabled'), enabled: z.boolean() }),
  /**
   * Sets who the table leans towards, and how far.
   *
   * The lobby only, exactly like `setGameMode` and for the same reason twice over: a
   * round is dealt the way it is dealt, so a change mid-round would do nothing to the
   * round in play — and the whole point is that nothing about it is visible, which a
   * change that took effect halfway through a hand would not stay.
   */
  z.object({
    type: z.literal('setAssist'),
    level: assistLevelSchema,
    playerIds: z.array(playerIdSchema).max(6),
  }),
  z.object({ type: z.literal('standInNow'), playerId: playerIdSchema }),
  z.object({ type: z.literal('stopStandIn'), playerId: playerIdSchema }),
  /** Passes the turn of a seat that is not there. Never reaches the engine from a client. */
  z.object({ type: z.literal('skipAbsentTurn'), playerId: playerIdSchema }),
  z.object({ type: z.literal('removeFromRound'), playerId: playerIdSchema }),
]);
export type RoomCommand = z.infer<typeof roomCommandSchema>;

/** Messages a client may send to the room. */
export const clientMessageSchema = z.discriminatedUnion('type', [
  message(
    'joinRequest',
    z.object({
      displayName: displayNameSchema,
      /**
       * Present on the first connection to a room that does not exist yet.
       *
       * The room accepts it only while it has no seats; otherwise the answer is
       * `roomTaken` and the client draws another code. This is what replaces
       * claiming a peer id derived from the room code: the collision check moved
       * from the relay's id table to the room's own emptiness.
       */
      create: z
        .object({
          maxPlayers: z.number().int().min(2).max(6),
          tableLanguage: z.enum(['he', 'en']),
          /** Chosen in the create-a-table settings; `classic` when a client omits it. */
          gameMode: gameModeSchema.optional(),
        })
        .optional(),
    }),
  ),
  message('resumeRequest', z.object({ playerId: playerIdSchema, resumeToken: resumeTokenSchema })),
  message(
    'action',
    z.object({
      action: gameActionSchema,
      /**
       * Minted once by the store and kept across re-sends.
       *
       * Not the envelope id, which is regenerated on every send and therefore
       * cannot match a replay — the one case it would need to.
       */
      requestId: requestIdSchema.optional(),
      turnToken: turnTokenSchema.optional(),
    }),
  ),
  message('leave', z.object({})),
  message('playAgainVote', z.object({ agree: z.boolean() })),
  /** Asks the table to hold, out loud, so nobody has to race a countdown. */
  message('pauseRequest', z.object({ paused: z.boolean() })),
  /** Votes to end a round that cannot sensibly continue. */
  message('abandonVote', z.object({ agree: z.boolean() })),
  /** Nudges a player who is connected but not looking. */
  message('nudge', z.object({ targetPlayerId: playerIdSchema })),
  /** A lobby power. Refused unless it comes from the seat that holds them. */
  message('roomCommand', z.object({ command: roomCommandSchema })),
]);

/** Messages the room may send to a client. */
export const roomMessageSchema = z.discriminatedUnion('type', [
  message(
    'joinAccepted',
    z.object({
      playerId: playerIdSchema,
      resumeToken: resumeTokenSchema,
      displayName: displayNameSchema,
      lobby: lobbySnapshotSchema,
    }),
  ),
  message('joinRejected', z.object({ reason: joinRejectionReasonSchema })),
  message('lobbyState', z.object({ lobby: lobbySnapshotSchema })),
  message('publicState', z.object({ state: publicGameStateSchema })),
  message('privateHand', z.object({ hand: privateHandSchema })),
  message(
    'gameEvents',
    z.object({
      version: z.number().int().nonnegative(),
      events: z.array(gameEventSchema).max(64).readonly(),
    }),
  ),
  message(
    'actionRejected',
    z.object({ code: rejectionCodeSchema, requestId: z.string().max(64).optional() }),
  ),
  /**
   * Confirms one specific intent was applied.
   *
   * An acknowledgement cannot be inferred from the state moving forward, because
   * in this game other players legally act out of turn — so a new snapshot may
   * have nothing to do with my move, and treating it as proof would let a lost
   * action look delivered. Hence an explicit answer carrying the request id.
   */
  message(
    'actionAccepted',
    z.object({ requestId: requestIdSchema, version: z.number().int().nonnegative() }),
  ),
  message('kicked', z.object({ reason: kickReasonSchema })),
  message('roomClosed', z.object({ reason: roomClosedReasonSchema })),
  message(
    'playAgainState',
    z.object({ agreed: z.array(playerIdSchema).max(6).readonly(), required: z.number().int().min(0).max(6) }),
  ),
  /** Somebody asked the table to wait. */
  message('paused', z.object({ pausedBy: playerIdSchema.nullable() })),
  /** Somebody nudged this player: it is their turn and they may not have noticed. */
  message('nudged', z.object({ fromPlayerId: playerIdSchema })),
  /**
   * What this one client is told about the table's easements, which is almost
   * nothing.
   *
   * Two fields with two very different audiences. `catchDelayMs` goes to everybody
   * and is about the recipient alone — how long their own "never declared!" button
   * waits before it works — so it names nobody and reveals nobody. `settings` is the
   * list itself and goes to the seat holding the lobby buttons and to no other, so
   * that the person running the table can change it and nobody else can read it.
   *
   * Sent per connection rather than broadcast, which is the structural half of the
   * promise: there is no code path that puts this in a message more than one player
   * receives.
   */
  message(
    'assistState',
    z.object({
      catchDelayMs: z.number().int().min(0).max(60_000),
      settings: assistSettingsSchema.optional(),
    }),
  ),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type RoomMessage = z.infer<typeof roomMessageSchema>;
export type AnyMessage = ClientMessage | RoomMessage;
export type ClientMessageType = ClientMessage['type'];
export type RoomMessageType = RoomMessage['type'];

export type ParseFailure =
  | { readonly ok: false; readonly error: 'notAnObject' }
  | { readonly ok: false; readonly error: 'tooLarge' }
  | { readonly ok: false; readonly error: 'malformedEnvelope' }
  | { readonly ok: false; readonly error: 'protocolMismatch'; readonly received: number }
  | { readonly ok: false; readonly error: 'unknownType'; readonly received: string }
  | { readonly ok: false; readonly error: 'invalidPayload'; readonly issues: string[] };

export type ParseResult<T> = { readonly ok: true; readonly message: T } | ParseFailure;

function tooLarge(raw: unknown): boolean {
  try {
    return JSON.stringify(raw).length > MAX_MESSAGE_BYTES;
  } catch {
    return true;
  }
}

function parseWith<T>(schema: z.ZodType<T>, raw: unknown): ParseResult<T> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'notAnObject' };
  }
  if (tooLarge(raw)) {
    return { ok: false, error: 'tooLarge' };
  }

  const preflight = envelopePreflightSchema.safeParse(raw);
  if (!preflight.success) {
    return { ok: false, error: 'malformedEnvelope' };
  }
  if (!SUPPORTED_PROTOCOL_VERSIONS.includes(preflight.data.protocolVersion)) {
    return { ok: false, error: 'protocolMismatch', received: preflight.data.protocolVersion };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const known = parsed.error.issues.some((issue) => issue.path.length === 1 && issue.path[0] === 'type');
    if (known) {
      return { ok: false, error: 'unknownType', received: preflight.data.type };
    }
    return {
      ok: false,
      error: 'invalidPayload',
      issues: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    };
  }
  return { ok: true, message: parsed.data };
}

/** Validates a message received by the room (i.e. sent by a client). */
export function parseClientMessage(raw: unknown): ParseResult<ClientMessage> {
  return parseWith(clientMessageSchema, raw);
}

/** Validates a message received by a client (i.e. sent by the room). */
export function parseRoomMessage(raw: unknown): ParseResult<RoomMessage> {
  return parseWith(roomMessageSchema, raw);
}
