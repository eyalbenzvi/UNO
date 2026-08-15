import {
  NO_ASSIST,
  assignHands,
  assistFor,
  biasedStartIndex,
  chooseDrawIndex,
  frontLoadForDraw,
  type AssistWeights,
} from './assist.ts';
import {
  CARDS_DEALT_PER_PLAYER,
  CHALLENGE_LOSS_PENALTY,
  DRAW_TWO_PENALTY,
  UNO_PENALTY,
  WILD_DRAW_FOUR_PENALTY,
  buildDeck,
  cardColor,
  handPoints,
  isCardColor,
  isWildCard,
  requiresColorChoice,
  type Card,
  type CardColor,
  type CardId,
} from './cards.ts';
import { createRng, shuffle, type RngState } from './prng.ts';
import { isCardPlayable, isWildDrawFourHonest, stepIndex, type PlayContext } from './rules.ts';
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  type ChallengeState,
  type CommandResult,
  type EnginePlayer,
  type GameCommand,
  type GameEndReason,
  type GameEvent,
  type GameMode,
  type GameState,
  type PlayerId,
  type RejectionCode,
  type TurnDirection,
} from './state.ts';

function reject(code: RejectionCode): CommandResult {
  return { ok: false, rejection: { code } };
}

/** Mutable working copy used while a single command is resolved. */
interface Draft {
  version: number;
  phase: GameState['phase'];
  mode: GameMode;
  players: readonly EnginePlayer[];
  assist: AssistWeights;
  hands: Record<PlayerId, Card[]>;
  drawPile: Card[];
  discardPile: Card[];
  activeColor: CardColor;
  direction: TurnDirection;
  currentPlayerIndex: number;
  drawnCardId: CardId | null;
  challenge: ChallengeState | null;
  declaredUno: PlayerId[];
  unoExposed: Record<PlayerId, number>;
  points: Record<PlayerId, number>;
  rng: RngState;
  winnerId: PlayerId | null;
  endReason: GameEndReason | null;
  turnSeq: number;
  seed: number;
}

function toDraft(state: GameState): Draft {
  const hands: Record<PlayerId, Card[]> = {};
  for (const player of state.players) {
    hands[player.id] = (state.hands[player.id] ?? []).slice();
  }
  return {
    version: state.version,
    phase: state.phase,
    mode: state.mode,
    players: state.players,
    assist: state.assist,
    hands,
    drawPile: state.drawPile.slice(),
    discardPile: state.discardPile.slice(),
    activeColor: state.activeColor,
    direction: state.direction,
    currentPlayerIndex: state.currentPlayerIndex,
    drawnCardId: state.drawnCardId,
    challenge: state.challenge,
    declaredUno: state.declaredUno.slice(),
    unoExposed: { ...state.unoExposed },
    points: { ...state.points },
    rng: state.rng,
    winnerId: state.winnerId,
    endReason: state.endReason,
    turnSeq: state.turnSeq,
    seed: state.seed,
  };
}

/**
 * Drops calls that no longer describe a hand of one card.
 *
 * A call belongs to the single card a player is holding, not to the player:
 * whoever draws back up owes a fresh "UNO!" next time they come down to one.
 * Applied at the end of every command, so no code path can leave a stale call
 * behind for the win check to honour.
 */
function syncDeclarations(draft: Draft): void {
  draft.declaredUno = draft.declaredUno.filter((playerId) => (draft.hands[playerId] ?? []).length === 1);
}

/**
 * Opens and closes the windows in which a silent player can be caught.
 *
 * Two rules, and both halves are needed to match the official window exactly:
 *
 * - A seat is stamped the moment its hand *becomes* a single uncalled card —
 *   on the transition, never afterwards. Stamping whenever a hand merely *is*
 *   one card would re-open the window on every later turn and make it eternal.
 * - A stamp is dropped when the hand stops being one card, or when the player
 *   calls UNO.
 *
 * Closing the window when the next player begins their turn is the other half,
 * and it lives at the two turn entry points rather than here — see
 * {@link beginTurnAction}.
 */
function settleUnoWindows(draft: Draft, before: Readonly<Record<PlayerId, readonly Card[]>>): void {
  const next: Record<PlayerId, number> = { ...draft.unoExposed };
  for (const player of draft.players) {
    const now = (draft.hands[player.id] ?? []).length;
    if (now !== 1 || draft.declaredUno.includes(player.id) || player.left === true) {
      delete next[player.id];
      continue;
    }
    if ((before[player.id] ?? []).length !== 1) {
      next[player.id] = draft.turnSeq;
    }
  }
  draft.unoExposed = next;
}

/**
 * The first thing anybody's turn does: shut everybody else's window.
 *
 * The official rule closes the catch the moment the next player *begins* — draws
 * or plays — not when their turn ends. A stamp alone cannot express that, because
 * `turnSeq` does not move until the turn is over, so a player who draws and then
 * thinks would leave the previous player exposed all the while. This is the half
 * of the window that answers "begins", and the stamp is the backstop for a turn
 * that ends without anybody acting at all.
 *
 * Everybody's, the actor's included, and the actor's costs nothing. A seat with an
 * open window is on one card by definition, and every turn action either empties
 * that hand, adds to it, or moves `turnSeq` past the stamp — so by the time the
 * action has resolved there is nothing left to catch.
 *
 * There is exactly one action that does none of the three, and it is worth naming
 * because the obvious statement of this rule is wrong: a draw against a pile with
 * nothing left in it, discard included, takes no card at all. That can only be
 * reached at two seats, where a Skip or a Reverse laid as the penultimate card
 * hands the turn straight back to its owner. Sparing the stamp there would keep
 * the seat catchable — and a catch would then draw two cards from the same empty
 * pile, which is to say nothing. The old code kept the stamp and paid for a branch
 * that could only ever change which event was logged.
 */
function beginTurnAction(draft: Draft, actorId: PlayerId): void {
  void actorId;
  draft.unoExposed = {};
}

function freeze(draft: Draft): GameState {
  syncDeclarations(draft);
  return {
    version: draft.version,
    phase: draft.phase,
    mode: draft.mode,
    players: draft.players,
    assist: draft.assist,
    hands: draft.hands,
    drawPile: draft.drawPile,
    discardPile: draft.discardPile,
    activeColor: draft.activeColor,
    direction: draft.direction,
    currentPlayerIndex: draft.currentPlayerIndex,
    drawnCardId: draft.drawnCardId,
    challenge: draft.challenge,
    declaredUno: draft.declaredUno,
    unoExposed: draft.unoExposed,
    points: draft.points,
    rng: draft.rng,
    winnerId: draft.winnerId,
    endReason: draft.endReason,
    turnSeq: draft.turnSeq,
    seed: draft.seed,
  };
}

/** Players still in the round. A `left` seat keeps its cards but takes no turns. */
export function activePlayers(state: Pick<GameState, 'players'>): readonly EnginePlayer[] {
  return state.players.filter((player) => player.left !== true);
}

export function topCard(state: Pick<GameState, 'discardPile'>): Card | null {
  return state.discardPile.length > 0 ? (state.discardPile[state.discardPile.length - 1] as Card) : null;
}

export function currentPlayer(state: GameState): EnginePlayer | null {
  return state.players[state.currentPlayerIndex] ?? null;
}

/**
 * Seats still in the round.
 *
 * Counted for the two-player rules — a Reverse acts as a Skip at two seats — and
 * counted by *seat*, not by who is currently connected. A three-player table with
 * somebody temporarily absent is still a three-player table, and must not start
 * playing the two-player rules for as long as a phone is in a tunnel.
 */
function activeSeatCount(draft: Draft): number {
  return draft.players.filter((player) => player.left !== true).length;
}

function indexOfPlayer(draft: Draft, playerId: PlayerId): number {
  return draft.players.findIndex((player) => player.id === playerId);
}

function playContextFromDraft(draft: Draft): PlayContext {
  return { activeColor: draft.activeColor, topCard: topCard(draft) };
}

/** Builds the {@link PlayContext} for the supplied authoritative state. */
export function playContextFromState(state: GameState): PlayContext {
  return { activeColor: state.activeColor, topCard: topCard(state) };
}

/**
 * Moves the turn on, stepping over seats that have left.
 *
 * The loop is bounded by the seat count, so a table where everybody has left
 * cannot spin: it lands back where it started and the caller's own end-of-round
 * check deals with it.
 */
function nextActiveIndex(draft: Draft, from: number): number {
  let index = from;
  for (let step = 0; step < draft.players.length; step += 1) {
    index = stepIndex(index, draft.direction, draft.players.length);
    if ((draft.players[index] as EnginePlayer).left !== true) {
      return index;
    }
  }
  return from;
}

function advanceTurn(draft: Draft, events: GameEvent[]): void {
  draft.currentPlayerIndex = nextActiveIndex(draft, draft.currentPlayerIndex);
  const next = draft.players[draft.currentPlayerIndex] as EnginePlayer;
  draft.drawnCardId = null;
  draft.turnSeq += 1;
  events.push({ type: 'turnChanged', playerId: next.id });
}

/**
 * Sends the turn past `victimIndex`, who has just lost it.
 *
 * One `advanceTurn`, not two. The seat that is skipped is *moved to* rather than
 * stepped over, so the turn counter moves exactly once — which matters because
 * clients gate a move on `turnSeq`, and the catch window is measured in it.
 */
function skipPast(draft: Draft, victimIndex: number, events: GameEvent[]): void {
  draft.currentPlayerIndex = victimIndex;
  advanceTurn(draft, events);
}

/**
 * Refills the draw pile from the discard pile, keeping the visible top card.
 *
 * `beneficiary` is whoever's draw ran the pile out, and it matters only when that
 * seat is one the table is leaning towards: the shuffle happens either way, and the
 * cards it produced are then arranged so the best few of them are the ones that
 * seat is about to meet. A recycle lands mid-penalty as often as not, which is
 * exactly when it is worth having. For an unmarked seat this is the shuffle and
 * nothing else.
 */
function recycleDrawPile(draft: Draft, beneficiary: PlayerId, events: GameEvent[]): void {
  if (draft.drawPile.length > 0 || draft.discardPile.length <= 1) {
    return;
  }
  const keep = draft.discardPile[draft.discardPile.length - 1] as Card;
  const recyclable = draft.discardPile.slice(0, -1);
  const shuffled = shuffle(recyclable, draft.rng);
  draft.rng = shuffled.state;
  const weight = assistFor(draft.assist, beneficiary);
  draft.drawPile =
    weight > 0
      ? frontLoadForDraw(
          shuffled.items,
          weight,
          draft.hands[beneficiary] ?? [],
          playContextFromDraft(draft),
        ).slice()
      : shuffled.items;
  draft.discardPile = [keep];
  events.push({ type: 'drawPileRecycled', count: shuffled.items.length });
}

/**
 * Lifts one card out of the draw pile for `playerId`.
 *
 * The top card for everybody, and for a seat the table is leaning towards the best
 * of the few beneath it — see {@link chooseDrawIndex}. A `splice` rather than a
 * `shift`, so the pile loses exactly one card either way and the rest keep their
 * order. Nobody can see a face-down pile, which is what makes this the quietest
 * method here and the one that reaches the draws that matter: the penalties.
 */
function takeCard(draft: Draft, playerId: PlayerId): Card | undefined {
  const weight = assistFor(draft.assist, playerId);
  if (weight <= 0 || draft.drawPile.length <= 1) {
    return draft.drawPile.shift();
  }
  const index = chooseDrawIndex(
    draft.drawPile,
    weight,
    draft.hands[playerId] ?? [],
    playContextFromDraft(draft),
  );
  return draft.drawPile.splice(index, 1)[0];
}

/** Draws `count` cards, recycling when needed. Returns the cards actually drawn. */
function drawCards(draft: Draft, playerId: PlayerId, count: number, events: GameEvent[]): Card[] {
  const drawn: Card[] = [];
  for (let i = 0; i < count; i += 1) {
    if (draft.drawPile.length === 0) {
      recycleDrawPile(draft, playerId, events);
    }
    const card = takeCard(draft, playerId);
    if (!card) {
      events.push({ type: 'drawPileExhausted' });
      break;
    }
    (draft.hands[playerId] as Card[]).push(card);
    drawn.push(card);
  }
  if (drawn.length > 0) {
    events.push({ type: 'cardDrawn', playerId, count: drawn.length });
  }
  return drawn;
}

/** Whether there is nothing left anywhere to draw, discard pile included. */
function pileExhausted(draft: Draft): boolean {
  return draft.drawPile.length === 0 && draft.discardPile.length <= 1;
}

/**
 * Ends the round if `playerId` has just put their last card down.
 *
 * Called *after* the played card's effect has resolved, never before, because a
 * round can be won on a Draw Two or a Wild Draw Four and the victim still draws.
 * Ending the round first would hand the winner four cards' worth of somebody
 * else's score and let the table off a penalty it had honestly earned.
 */
function finishIfEmpty(draft: Draft, playerId: PlayerId, events: GameEvent[]): boolean {
  if ((draft.hands[playerId] ?? []).length > 0) {
    return false;
  }
  draft.phase = 'finished';
  draft.winnerId = playerId;
  draft.endReason = 'won';
  draft.challenge = null;
  draft.drawnCardId = null;
  draft.unoExposed = {};
  events.push({ type: 'playerWon', playerId });

  if (draft.mode === 'points') {
    const points: Record<PlayerId, number> = {};
    let total = 0;
    for (const player of draft.players) {
      if (player.id === playerId) {
        continue;
      }
      // A seat that left is still holding cards, and they still count: the round
      // was won against the table as it stood.
      const value = handPoints(draft.hands[player.id] ?? []);
      points[player.id] = value;
      total += value;
    }
    points[playerId] = total;
    draft.points = points;
    events.push({ type: 'roundScored', playerId, points: total });
  }
  return true;
}

/**
 * Opens the window in which the next seat may take the four cards or call the
 * bluff. The table is frozen until it answers.
 */
function openChallenge(
  draft: Draft,
  playerId: PlayerId,
  bluffed: boolean,
  color: CardColor,
  events: GameEvent[],
): void {
  const targetIndex = nextActiveIndex(draft, draft.currentPlayerIndex);
  const target = draft.players[targetIndex] as EnginePlayer;
  draft.challenge = { playerId, targetId: target.id, color, bluffed };
  events.push({ type: 'challengeOpened', playerId, targetId: target.id, color });
}

/**
 * Settles an open Wild Draw Four, one way or the other, and moves the turn on.
 *
 * The three outcomes and where the turn lands:
 *
 * - **Taken.** The target draws four and loses the turn, so play resumes with the
 *   seat after them.
 * - **Bluff called, and it was a bluff.** The player who bluffed draws the four
 *   themselves, and the challenger keeps their turn — they are next anyway, so the
 *   turn simply moves on to them.
 * - **Bluff called wrongly.** The challenger draws the four they owed plus two for
 *   the accusation, and still loses the turn.
 *
 * The colour the player named stands in every case. A challenge decides who draws,
 * never what is led.
 */
function resolveChallenge(draft: Draft, challenged: boolean, events: GameEvent[]): void {
  const pending = draft.challenge as ChallengeState;
  draft.challenge = null;
  const targetIndex = indexOfPlayer(draft, pending.targetId);

  if (!challenged) {
    const drawn = drawCards(draft, pending.targetId, WILD_DRAW_FOUR_PENALTY, events);
    events.push({ type: 'challengeDeclined', playerId: pending.targetId, drawn: drawn.length });
    skipPast(draft, targetIndex, events);
  } else if (pending.bluffed) {
    const drawn = drawCards(draft, pending.playerId, WILD_DRAW_FOUR_PENALTY, events);
    events.push({
      type: 'challengeResolved',
      challengerId: pending.targetId,
      targetId: pending.playerId,
      bluffed: true,
      drawn: drawn.length,
    });
    // The challenger is the next seat, so an ordinary advance lands the turn on
    // them — which is exactly what winning a challenge buys.
    advanceTurn(draft, events);
  } else {
    const drawn = drawCards(draft, pending.targetId, CHALLENGE_LOSS_PENALTY, events);
    events.push({
      type: 'challengeResolved',
      challengerId: pending.targetId,
      targetId: pending.targetId,
      bluffed: false,
      drawn: drawn.length,
    });
    skipPast(draft, targetIndex, events);
  }

  // The Wild Draw Four may have been somebody's last card. The round ends here
  // rather than when it was played, so the four cards it cost are drawn first and
  // counted in the score.
  finishIfEmpty(draft, pending.playerId, events);
}

/**
 * Applies the effect of the card that has just been played.
 *
 * A Wild Draw Four is the one card that does not finish here: it opens a window
 * and leaves the turn where it is until somebody answers.
 */
function resolveCardEffect(draft: Draft, card: Card, playerId: PlayerId, events: GameEvent[]): void {
  switch (card.kind) {
    case 'skip': {
      // Whoever the Skip lands on has to be somebody still playing, or the card
      // would be spent on an empty seat and the next live player would be robbed
      // of their turn instead. At two seats this comes straight back round, which
      // is the official two-player rule falling out rather than being written.
      const victim = nextActiveIndex(draft, draft.currentPlayerIndex);
      events.push({ type: 'playerSkipped', playerId: (draft.players[victim] as EnginePlayer).id });
      skipPast(draft, victim, events);
      return;
    }
    case 'reverse': {
      draft.direction = draft.direction === 1 ? -1 : 1;
      events.push({ type: 'directionChanged', direction: draft.direction });
      if (activeSeatCount(draft) === 2) {
        /*
         * With two players a Reverse is a Skip, and the official rules say so
         * outright. It has to be written rather than left to fall out: turning the
         * direction round at two seats moves the turn to the same place turning it
         * round does at any other number — the other player — so the card would
         * quietly do nothing at all.
         */
        const victim = nextActiveIndex(draft, draft.currentPlayerIndex);
        events.push({ type: 'playerSkipped', playerId: (draft.players[victim] as EnginePlayer).id });
        skipPast(draft, victim, events);
        return;
      }
      advanceTurn(draft, events);
      return;
    }
    case 'drawTwo': {
      const victim = nextActiveIndex(draft, draft.currentPlayerIndex);
      const victimId = (draft.players[victim] as EnginePlayer).id;
      drawCards(draft, victimId, DRAW_TWO_PENALTY, events);
      events.push({ type: 'playerSkipped', playerId: victimId });
      skipPast(draft, victim, events);
      return;
    }
    case 'wildDrawFour': {
      // Left open on purpose: the turn does not move until the next seat answers.
      return;
    }
    case 'number':
    case 'wild': {
      advanceTurn(draft, events);
      return;
    }
  }
  void playerId;
}

function applyPlayCard(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
  chosenColor: CardColor | undefined,
  declareUno: boolean,
): CommandResult {
  const hand = state.hands[playerId] ?? [];
  const card = hand.find((candidate) => candidate.id === cardId);
  if (!card) {
    return reject('cardNotInHand');
  }

  /*
   * A card was drawn this turn, so it is the only one that may be played. The
   * rest of the hand is not illegal because of what it is — it is out of reach
   * because the turn has already been spent on the pile.
   */
  if (state.drawnCardId !== null && state.drawnCardId !== cardId) {
    return reject('onlyDrawnCardPlayable');
  }

  if (requiresColorChoice(card)) {
    if (chosenColor === undefined) {
      return reject('colorRequired');
    }
    if (!isCardColor(chosenColor)) {
      return reject('colorNotAllowed');
    }
  } else if (chosenColor !== undefined) {
    return reject('colorNotAllowed');
  }

  if (!isCardPlayable(card, playContextFromState(state))) {
    return reject('illegalCard');
  }

  const draft = toDraft(state);
  const events: GameEvent[] = [];
  const handsBefore = state.hands;

  /*
   * The verdict on a Wild Draw Four, decided here and nowhere else.
   *
   * Against the colour that was leading *before* this card, which is the whole
   * point: the rule asks whether the player could have followed suit instead. Read
   * a line later — after `activeColor` becomes the colour they just named — the
   * question becomes "do you hold the colour you chose", which a player naming
   * their own strongest colour answers yes to almost every time. The challenge
   * would then exonerate every bluff, and the card that makes UNO interesting
   * would be a coin the challenger always loses.
   */
  const bluffed =
    card.kind === 'wildDrawFour' ? !isWildDrawFourHonest(hand, state.activeColor, cardId) : false;
  // Read here for the same reason and at the same moment as the verdict: a line
  // later the table has been repainted in the colour this card just named.
  const challengedColor = state.activeColor;

  beginTurnAction(draft, playerId);

  draft.hands[playerId] = (draft.hands[playerId] as Card[]).filter((candidate) => candidate.id !== cardId);
  draft.discardPile.push(card);
  draft.drawnCardId = null;

  const resultingColor = chosenColor ?? cardColor(card) ?? draft.activeColor;
  draft.activeColor = resultingColor;
  events.push({ type: 'cardPlayed', playerId, card, resultingColor });
  if (chosenColor !== undefined) {
    events.push({ type: 'colorChosen', playerId, color: resultingColor });
  }

  /*
   * The call, when it was made with the card rather than after it. Here, because
   * "the card left me on one" is only true once the hand has settled, and nothing
   * below this point adds to or removes from *this* player's hand.
   */
  if (declareUno && (draft.hands[playerId] ?? []).length === 1 && !draft.declaredUno.includes(playerId)) {
    draft.declaredUno.push(playerId);
    events.push({ type: 'unoDeclared', playerId });
  }

  if (card.kind === 'wildDrawFour') {
    openChallenge(draft, playerId, bluffed, challengedColor, events);
  } else {
    resolveCardEffect(draft, card, playerId, events);
    finishIfEmpty(draft, playerId, events);
  }

  settleUnoWindows(draft, handsBefore);
  draft.version += 1;
  return { ok: true, state: freeze(draft), events };
}

/**
 * Takes the one card a turn costs, and leaves the turn open.
 *
 * This is UNO's draw rule and it is not Taki's: a turn with nothing to play is not
 * over when you have drawn. You take exactly one card, and if it can be played you
 * may play it — that card and nothing else — or end the turn. Drawing is also
 * voluntary: a player holding a perfectly good card may draw anyway, and the rules
 * have nothing to say about it.
 */
function applyDrawCard(state: GameState, playerId: PlayerId): CommandResult {
  if (state.drawnCardId !== null) {
    return reject('alreadyDrew');
  }

  const draft = toDraft(state);
  /*
   * Refused rather than accepted as a no-op.
   *
   * A draw against a pile with nothing left in it, discard included, takes no card
   * — so `drawnCardId` stays empty and the same command is legal again immediately.
   * Accepted, it would bump the version and reset every deadline that exists to
   * rescue a stalled seat, for ever, on a move that changes nothing. The screen
   * never offers it (`pileSpent` closes the pile and offers the turn's end
   * instead), and the robots do not ask for it either — but neither of those is
   * the wire.
   */
  if (pileExhausted(draft)) {
    return reject('pileSpent');
  }

  const events: GameEvent[] = [];
  const handsBefore = state.hands;

  beginTurnAction(draft, playerId);
  const drawn = drawCards(draft, playerId, 1, events);
  // `null` when the pile had nothing left, which is what makes the pass below
  // legal — a turn with no card to draw and none to play still has to end.
  draft.drawnCardId = drawn[0]?.id ?? null;

  settleUnoWindows(draft, handsBefore);
  draft.version += 1;
  return { ok: true, state: freeze(draft), events };
}

/**
 * Ends a turn that has already been paid for.
 *
 * There is no free pass in UNO: you play or you draw. The one exception is a pile
 * with nothing left in it, discard included — `drawCard` then takes nothing, and
 * refusing the pass as well would leave the turn with no legal move at all and
 * deadlock the table.
 */
function applyPassTurn(state: GameState, playerId: PlayerId): CommandResult {
  const draft = toDraft(state);
  if (state.drawnCardId === null && !pileExhausted(draft)) {
    return reject('nothingToPass');
  }
  const events: GameEvent[] = [{ type: 'turnPassed', playerId }];
  const handsBefore = state.hands;

  beginTurnAction(draft, playerId);
  advanceTurn(draft, events);
  settleUnoWindows(draft, handsBefore);
  draft.version += 1;
  return { ok: true, state: freeze(draft), events };
}

function applyChallengeAnswer(state: GameState, playerId: PlayerId, challenged: boolean): CommandResult {
  const pending = state.challenge;
  if (!pending) {
    return reject('noChallengeOpen');
  }
  if (pending.targetId !== playerId) {
    return reject('notTheChallenger');
  }

  const draft = toDraft(state);
  const events: GameEvent[] = [];
  const handsBefore = state.hands;
  resolveChallenge(draft, challenged, events);
  settleUnoWindows(draft, handsBefore);
  draft.version += 1;
  return { ok: true, state: freeze(draft), events };
}

/**
 * Calls "UNO!".
 *
 * Legal from any seat and at any moment, exactly as it is at a real table: the
 * call goes with the card in your hand, not with your turn. It is only ever legal
 * while the calling player holds exactly one card, and only once per card.
 */
function applyDeclareUno(state: GameState, playerId: PlayerId): CommandResult {
  if ((state.hands[playerId] ?? []).length !== 1) {
    return reject('nothingToDeclare');
  }
  if (state.declaredUno.includes(playerId)) {
    return reject('alreadyDeclared');
  }

  const draft = toDraft(state);
  draft.declaredUno.push(playerId);
  // Safe now, and the window has nothing left to describe.
  const cleared = { ...draft.unoExposed };
  delete cleared[playerId];
  draft.unoExposed = cleared;
  draft.version += 1;
  return { ok: true, state: freeze(draft), events: [{ type: 'unoDeclared', playerId }] };
}

/**
 * Catches a player sitting silently on a single card.
 *
 * The call is not what wins the round — putting the last card down is. What
 * silence costs is being caught, and only inside the window the official rule
 * gives you: before the next player begins their turn. After that the offender is
 * safe, and that is the point of the rule rather than a limitation of it.
 */
function applyCatchUno(state: GameState, playerId: PlayerId, targetId: PlayerId): CommandResult {
  const target = state.players.find((player) => player.id === targetId);
  // A player who has left cannot be caught: their hand is frozen out of play, and
  // they are in no position to shout.
  if (!target || target.left === true || targetId === playerId) {
    return reject('nothingToCatch');
  }
  if ((state.hands[targetId] ?? []).length !== 1 || state.declaredUno.includes(targetId)) {
    return reject('nothingToCatch');
  }
  if (state.unoExposed[targetId] !== state.turnSeq) {
    return reject('nothingToCatch');
  }

  const draft = toDraft(state);
  const events: GameEvent[] = [];
  const drawn = drawCards(draft, targetId, UNO_PENALTY, events);
  events.push({ type: 'unoCaught', playerId: targetId, caughtById: playerId, penalty: drawn.length });

  const cleared = { ...draft.unoExposed };
  delete cleared[targetId];
  draft.unoExposed = cleared;

  draft.version += 1;
  return { ok: true, state: freeze(draft), events };
}

/**
 * Passes the turn of a player who is not there, at the price of the turn.
 *
 * Its own transition rather than a `drawCard` issued on somebody's behalf, because
 * a draw no longer ends a turn: built out of `drawCard` this would leave the table
 * waiting on the same absent seat to pass as well. It also answers with its own
 * rejection code, because the caller is the room acting on a timer rather than a
 * player taking a turn.
 *
 * A seat that had already drawn pays nothing further — it has taken its card, and
 * charging a second would punish somebody for the moment their phone chose to die.
 * Otherwise the skip costs the one card the turn would have cost had they been
 * there to take it. A free pass was the cheapest turn at the table: a hand that
 * cannot grow cannot lose, so a seat that dropped out at the right moment came out
 * ahead of one that played.
 */
function applySkipTurn(state: GameState, playerId: PlayerId): CommandResult {
  if (currentPlayer(state)?.id !== playerId) {
    return reject('nothingToSkip');
  }

  const draft = toDraft(state);
  const events: GameEvent[] = [];
  const handsBefore = state.hands;

  beginTurnAction(draft, playerId);
  const drew = state.drawnCardId !== null ? [] : drawCards(draft, playerId, 1, events);
  events.push({ type: 'turnSkipped', playerId, drew: drew.length });
  advanceTurn(draft, events);
  settleUnoWindows(draft, handsBefore);
  draft.version += 1;
  return { ok: true, state: freeze(draft), events };
}

/**
 * Marks a player as gone without disturbing the round.
 *
 * Everything they were holding up is released first — a challenge window in either
 * role, a call — because leaving those dangling is what deadlocks a table
 * permanently. Their cards stay frozen in their hand, out of play: no reshuffle, no
 * random numbers consumed, and the total number of cards in the system is
 * unchanged, which is the invariant the tests assert.
 */
function applyLeaveGame(state: GameState, playerId: PlayerId): CommandResult {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    return reject('unknownPlayer');
  }
  if (player.left === true) {
    return reject('alreadyLeft');
  }

  const draft = toDraft(state);
  const events: GameEvent[] = [];
  const handsBefore = state.hands;
  const wasCurrent = currentPlayer(state)?.id === playerId;

  draft.players = draft.players.map((candidate) =>
    candidate.id === playerId ? { ...candidate, left: true } : candidate,
  );
  draft.declaredUno = draft.declaredUno.filter((candidate) => candidate !== playerId);
  events.push({ type: 'playerLeft', playerId });

  /*
   * A challenge window naming a seat that has gone can never be answered, so it
   * goes with them — in either role, and differently in each. Either branch moves
   * the turn itself, which the pointer fix-up below must then not repeat.
   */
  let turnMoved = false;
  if (draft.challenge !== null) {
    if (draft.challenge.playerId === playerId) {
      /*
       * The card's author has left. The penalty is cancelled rather than collected:
       * their hand is frozen out of play, so a challenge could no longer punish
       * them however dishonest the card was, and charging the target four with no
       * possibility of redress is worse than charging nobody.
       *
       * The round-end check still runs, and that is the point of it being here. A
       * Wild Draw Four can be somebody's last card, and the win is deliberately
       * deferred until the window resolves so the four cards are drawn first — so a
       * branch that closed the window without checking would take a round from a
       * player who had already put their last card on the pile. The room can reach
       * this: a creator may remove a seat that has gone quiet, and the seat that
       * went quiet may have gone quiet immediately after winning.
       */
      draft.challenge = null;
      advanceTurn(draft, events);
      finishIfEmpty(draft, playerId, events);
      turnMoved = true;
    } else if (draft.challenge.targetId === playerId) {
      // The victim has left. The window settles as if taken, minus the draw: their
      // hand is frozen out of play, so there is nothing to add to.
      const targetIndex = indexOfPlayer(draft, playerId);
      const author = draft.challenge.playerId;
      draft.challenge = null;
      skipPast(draft, targetIndex, events);
      finishIfEmpty(draft, author, events);
      turnMoved = true;
    }
  }

  const remaining = draft.players.filter((candidate) => candidate.left !== true);
  if (remaining.length < MIN_PLAYERS && draft.phase === 'playing') {
    /*
     * No winner. "Last player standing" would hand a two-player table the round for
     * a twenty-second blip somebody else measured.
     *
     * Guarded on the round still being in play, because the departure above can
     * legitimately have *ended* it: a player whose Wild Draw Four emptied their hand
     * has won, and the victim walking away afterwards must not turn that win into an
     * abandonment.
     */
    draft.phase = 'finished';
    draft.winnerId = null;
    draft.endReason = 'abandoned';
    draft.challenge = null;
    draft.drawnCardId = null;
    draft.unoExposed = {};
    events.push({ type: 'roundAbandoned' });
    draft.version += 1;
    return { ok: true, state: freeze(draft), events };
  }

  // The turn pointer must never rest on an empty seat.
  if (draft.phase === 'playing' && !turnMoved) {
    if (wasCurrent) {
      draft.drawnCardId = null;
      advanceTurn(draft, events);
    } else if ((draft.players[draft.currentPlayerIndex] as EnginePlayer).left === true) {
      draft.currentPlayerIndex = nextActiveIndex(draft, draft.currentPlayerIndex);
      draft.drawnCardId = null;
      draft.turnSeq += 1;
      events.push({
        type: 'turnChanged',
        playerId: (draft.players[draft.currentPlayerIndex] as EnginePlayer).id,
      });
    }
  }

  settleUnoWindows(draft, handsBefore);
  draft.version += 1;
  return { ok: true, state: freeze(draft), events };
}

/**
 * Stops the round with no winner and everybody's hand intact.
 *
 * Nobody is marked as having left: the point is that the *round* ended, not that
 * these players did anything. The standings show exactly where everyone was.
 */
function applyAbandonRound(state: GameState): CommandResult {
  const draft = toDraft(state);
  draft.phase = 'finished';
  draft.winnerId = null;
  draft.endReason = 'abandoned';
  draft.challenge = null;
  draft.drawnCardId = null;
  draft.unoExposed = {};
  draft.version += 1;
  return { ok: true, state: freeze(draft), events: [{ type: 'roundAbandoned' }] };
}

/**
 * Creates a fresh game.
 *
 * The opening card is the first non-wild card off the shuffled deck; wilds met on
 * the way are buried at the bottom of the draw pile, so no card leaves the game and
 * the count still comes to 108. The official rules do this for a Wild Draw Four
 * — there is nobody yet to challenge it — and this build does it for a plain Wild
 * too. That second half is a deviation, and it is a deliberate one: the official
 * answer is that the first player names the colour, which would make the colour in
 * play nullable everywhere it is currently a colour — the engine, the wire, the
 * stored round, the styling — plus a command of its own and an answer for a first
 * player who never arrives, all for four cards in a hundred and eight. It is a
 * widely played variant and it is the procedure the rules already use for the other
 * wild. See `docs/rules.md`.
 *
 * The opening card's effect then falls on the first player, exactly as it does at a
 * table: a Skip costs them the turn, a Draw Two costs them two cards and the turn,
 * and a Reverse turns the play round so that the dealer goes first instead.
 *
 * `initialVersion` lets a second round continue the version sequence of the first.
 * Clients drop snapshots older than the newest one they applied, so a new round must
 * never restart numbering.
 *
 * `mode` is fixed here and never again: a round is scored the way it was dealt.
 *
 * `assist` is fixed here for the same reason and does two things to this function,
 * both after the shuffle and neither to the deck: which seat receives which of the
 * hands just dealt, and which seat moves first. With no weight on any seat both are
 * no-ops and the round is dealt exactly as it would have been. See `assist.ts`.
 */
export function createGame(
  players: readonly EnginePlayer[],
  seed: number,
  initialVersion = 1,
  startingSeat = 0,
  mode: GameMode = 'classic',
  assist: AssistWeights = NO_ASSIST,
): CommandResult {
  if (players.length < MIN_PLAYERS) {
    return reject('notEnoughPlayers');
  }
  if (players.length > MAX_PLAYERS) {
    return reject('tooManyPlayers');
  }
  const uniqueIds = new Set(players.map((player) => player.id));
  if (uniqueIds.size !== players.length) {
    return reject('duplicatePlayerId');
  }

  const shuffled = shuffle(buildDeck(), createRng(seed));
  const rng = shuffled.state;
  const pile = shuffled.items;

  const dealt: Card[][] = players.map(() => []);
  for (let round = 0; round < CARDS_DEALT_PER_PLAYER; round += 1) {
    for (let seat = 0; seat < players.length; seat += 1) {
      const card = pile.shift();
      if (card) {
        (dealt[seat] as Card[]).push(card);
      }
    }
  }
  /*
   * Who gets which of the hands just dealt. A permutation of them and nothing more:
   * the deck, the order it was shuffled in and what is left in `pile` are all
   * untouched, which is what makes this method invisible rather than merely quiet.
   */
  const assigned = assignHands(dealt, players, assist);
  const hands: Record<PlayerId, Card[]> = {};
  players.forEach((player, seat) => {
    hands[player.id] = (assigned[seat] ?? []).slice();
  });

  const buried: Card[] = [];
  let opening: Card | null = null;
  while (pile.length > 0) {
    const card = pile.shift() as Card;
    if (!isWildCard(card)) {
      opening = card;
      break;
    }
    buried.push(card);
  }
  if (!opening || isWildCard(opening)) {
    // Impossible with the documented deck — eight wilds cannot exhaust it — but
    // keep the engine total.
    return reject('notEnoughPlayers');
  }

  const drawPile = pile.concat(buried);
  /*
   * The seat that holds the lobby buttons keeps seat 0 for the life of the room, so
   * a fixed starting index meant the same person opened every round, for ever. A
   * table notices that by about the fifth round.
   */
  const rotated = ((startingSeat % players.length) + players.length) % players.length;
  const firstIndex = biasedStartIndex(players, assist, startingSeat, rotated);

  const draft: Draft = {
    version: initialVersion,
    phase: 'playing',
    mode,
    players,
    assist,
    hands,
    drawPile,
    discardPile: [opening],
    activeColor: opening.color,
    direction: 1,
    currentPlayerIndex: firstIndex,
    drawnCardId: null,
    challenge: null,
    declaredUno: [],
    unoExposed: {},
    points: {},
    rng,
    winnerId: null,
    endReason: null,
    turnSeq: 0,
    seed,
  };

  /*
   * The opening card's effect, applied without `advanceTurn`.
   *
   * The turn counter has to start at nought: clients gate a move on it and the
   * catch window is measured in it, so an opening Skip that arrived through the
   * ordinary turn machinery would start every such round one turn ahead of every
   * other one. The seat is moved directly instead, and the single `turnChanged`
   * below names wherever it ended up.
   *
   * The dealer is the seat before the one that would nominally open — play starts
   * to the dealer's left — and it exists here only because a Reverse turned up at
   * the start hands the first turn back to them.
   */
  const events: GameEvent[] = [];
  switch (opening.kind) {
    case 'skip': {
      events.push({ type: 'playerSkipped', playerId: (players[firstIndex] as EnginePlayer).id });
      draft.currentPlayerIndex = nextActiveIndex(draft, firstIndex);
      break;
    }
    case 'reverse': {
      draft.direction = -1;
      events.push({ type: 'directionChanged', direction: -1 });
      // The dealer, reached by stepping backwards from the nominal opener — which
      // in the direction now in play is simply the next seat.
      draft.currentPlayerIndex = nextActiveIndex(draft, firstIndex);
      break;
    }
    case 'drawTwo': {
      const victimId = (players[firstIndex] as EnginePlayer).id;
      drawCards(draft, victimId, DRAW_TWO_PENALTY, events);
      events.push({ type: 'playerSkipped', playerId: victimId });
      draft.currentPlayerIndex = nextActiveIndex(draft, firstIndex);
      break;
    }
    case 'number':
      // Nothing to do, and no wild cases to list: the walk above buries both, and
      // the type of `opening` says so — a wild here would not compile.
      break;
  }

  const opener = players[draft.currentPlayerIndex] as EnginePlayer;
  return {
    ok: true,
    state: freeze(draft),
    events: [
      { type: 'gameStarted', firstPlayerId: opener.id, activeColor: draft.activeColor },
      ...events,
      { type: 'turnChanged', playerId: opener.id },
    ],
  };
}

/**
 * Single entry point for every state transition.
 * Pure: returns either a new state plus emitted events, or a rejection code.
 */
export function applyCommand(state: GameState, command: GameCommand): CommandResult {
  if (state.phase !== 'playing') {
    return reject('gameFinished');
  }
  const actor = state.players.find((player) => player.id === command.playerId);
  if (!actor) {
    return reject('unknownPlayer');
  }

  // Marking a player as gone is the one command a departed seat is the subject of.
  if (command.type === 'leaveGame') {
    return applyLeaveGame(state, command.playerId);
  }
  if (command.type === 'abandonRound') {
    return applyAbandonRound(state);
  }
  if (actor.left === true) {
    return reject('alreadyLeft');
  }

  // Calling UNO, and calling out somebody who did not, are shouts rather than
  // moves: they belong to the cards in hand and are legal from any seat, whatever
  // else the table happens to be waiting for.
  if (command.type === 'declareUno') {
    return applyDeclareUno(state, command.playerId);
  }
  if (command.type === 'catchUno') {
    return applyCatchUno(state, command.playerId, command.targetId);
  }

  // While a Wild Draw Four is waiting for an answer the table is frozen for
  // everyone, and the only two moves are the target's.
  if (state.challenge) {
    switch (command.type) {
      case 'acceptWildDrawFour':
        return applyChallengeAnswer(state, command.playerId, false);
      case 'challengeWildDrawFour':
        return applyChallengeAnswer(state, command.playerId, true);
      case 'skipTurn':
        // The room's absence timer, answering for a seat that is not there. Taking
        // the cards is the only honest default: a skip is free, but a penalty
        // somebody else created is paid in full, or pulling the plug becomes the
        // cheapest answer to a Wild Draw Four.
        return state.challenge.targetId === command.playerId
          ? applyChallengeAnswer(state, command.playerId, false)
          : reject('nothingToSkip');
      default:
        return reject('awaitingChallenge');
    }
  }
  if (command.type === 'acceptWildDrawFour' || command.type === 'challengeWildDrawFour') {
    return reject('noChallengeOpen');
  }
  /*
   * Skipping answers with its own code rather than the generic "not your turn",
   * because the caller is the room acting on a timer and the distinction is what
   * the diagnostics log needs: being asked to skip the wrong seat is a bug in the
   * absence machinery, not a player mistake.
   */
  if (command.type === 'skipTurn') {
    return applySkipTurn(state, command.playerId);
  }
  if (currentPlayer(state)?.id !== command.playerId) {
    return reject('notYourTurn');
  }

  switch (command.type) {
    case 'playCard':
      return applyPlayCard(
        state,
        command.playerId,
        command.cardId,
        command.chosenColor,
        command.declareUno === true,
      );
    case 'drawCard':
      return applyDrawCard(state, command.playerId);
    case 'passTurn':
      return applyPassTurn(state, command.playerId);
  }
}
