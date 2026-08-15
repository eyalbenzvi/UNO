import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '../../../../components/Button.tsx';
import { Callout } from '../../../../components/Callout.tsx';
import { Icon } from '../../../../components/Icon.tsx';
import { useDirection, useT } from '../../../../app/useT.ts';
import type { Translator } from '../../../../i18n/index.ts';
import { UNO_PENALTY, requiresColorChoice, type Card, type CardColor } from '../../engine/cards.ts';
import {
  currentPlayerName,
  hasDeclaredLastCard,
  isMyTurn,
  mustAnswerChallenge,
  mustDeclareLastCard,
  myPoints,
  opponents,
  playableCardIds,
  playerName,
  sortHandForDisplay,
  type TableSnapshot,
} from '../../state/selectors.ts';
import { useAppStore, type FeedEntry } from '../../state/store.ts';
import { colorName, describeCard } from '../cardText.ts';
import { describeEvent } from '../eventText.ts';
import { useCatchGrace } from '../useCatchGrace.ts';
import { playCue } from '../../../../lib/audio.ts';
import { penaltyBuzz, returnBuzz } from '../../../../lib/haptics.ts';
import { AnchorRegistry } from '../anchors.ts';
import { cueFor } from '../choreograph.ts';
import { ColorPickerModal } from '../components/ColorPickerModal.tsx';
import { FlightLayer } from '../components/FlightLayer.tsx';
import { ConnectionPhaseNotice } from '../components/ConnectionPhaseNotice.tsx';
import { CaughtNotice, NudgeButton, NudgeNotice } from '../components/TableControls.tsx';
import { WaitingNotice } from '../components/WaitingNotice.tsx';
import { GameLog } from '../components/GameLog.tsx';
import { DirectionIndicator, Hand, OpponentList, Piles } from '../components/TableParts.tsx';

/** How long a "you cannot play that" explanation stays on screen. */
const REFUSAL_MS = 2600;

type TableView = TableSnapshot & {
  readonly feed: readonly FeedEntry[];
  readonly actionPending: boolean;
};

/**
 * The table.
 *
 * Laid out as a fixed-height grid rather than a scrolling document, in the order
 * a player needs things: who else is here, the table itself, what to do now, and
 * the hand pinned under the thumb. Before this the hand sat mid-page with the log
 * and a Leave button below it, so on a phone the primary interaction of the whole
 * product was below the fold.
 */
export function GameScreen(): ReactNode {
  const t = useT();
  /*
   * The play-order arrow points at seats, and the seats are laid out in the
   * document's direction, so the chip needs it. Passed in rather than read from
   * `document` inside the component, which keeps it a pure render of props.
   */
  const textDirection = useDirection();

  /*
   * Subscribed field by field. The table used to re-render on every store change
   * — a heartbeat re-grading a connection, a toast opening, a preference
   * changing — and each render rebuilt the extruded geometry of every symbol on
   * every card in the hand.
   */
  const table = useAppStore(
    useShallow((state): TableView => ({
      publicState: state.publicState,
      localPlayerId: state.localPlayerId,
      hand: state.hand,
      drawnCardId: state.drawnCardId,
      lobby: state.lobby,
      feed: state.feed,
      actionPending: state.actionPending,
    })),
  );
  /*
   * Its own selector, deliberately.
   *
   * Folding `beat` into the shallow object above would change `table`'s identity
   * on every move, which would defeat the `useMemo` on `opponents(table)` below
   * and re-render every seat — the exact cost that memo exists to avoid.
   */
  const beat = useAppStore((state) => state.beat);
  /*
   * Its own selector for the same reason as `beat`: a number that changes once a
   * round has no business re-identifying `table` on every move.
   */
  const catchDelayMs = useAppStore((state) => state.assist.catchDelayMs);
  const playCard = useAppStore((state) => state.playCard);
  const drawCard = useAppStore((state) => state.drawCard);
  const passTurn = useAppStore((state) => state.passTurn);
  const acceptWildDrawFour = useAppStore((state) => state.acceptWildDrawFour);
  const challengeWildDrawFour = useAppStore((state) => state.challengeWildDrawFour);
  const declareLastCard = useAppStore((state) => state.declareLastCard);
  const catchLastCard = useAppStore((state) => state.catchLastCard);
  const announce = useAppStore((state) => state.announce);

  /*
   * One registry for the table's lifetime. Anchors register themselves as they
   * mount and deregister as they go, so nothing here has to know which of them
   * currently exist — a player's own seat never does, and a card's slot stops
   * existing the moment it is played.
   */
  const [registry] = useState(() => new AnchorRegistry());

  /*
   * The wild card waiting for a colour. Nothing has been played while it sits
   * here: the card is still in hand, the table has not moved, and neither the
   * declaration nor the catch that may follow it exists yet.
   */
  const [pendingWild, setPendingWild] = useState<Card | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const refusalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { publicState, feed, actionPending } = table;
  const myTurn = isMyTurn(table);
  const playable = playableCardIds(table);
  const mustDeclare = mustDeclareLastCard(table);
  const declared =
    table.hand.length === 1 &&
    table.localPlayerId !== null &&
    hasDeclaredLastCard(table, table.localPlayerId);
  const cards = useMemo(() => sortHandForDisplay(table.hand), [table.hand]);
  /*
   * The cues this screen draws itself, read off the newest beat.
   *
   * Everything here is derived during render from state the store already holds,
   * so there is no effect, no timer and no ref — which is both simpler and the
   * only shape the compiler's lint rules allow.
   */
  const landed = beat?.events.some((event) => event.type === 'cardPlayed') ?? false;
  const reversal = beat?.events.find((event) => event.type === 'directionChanged');
  const sweep = beat && reversal ? { key: `${beat.seq}`, direction: reversal.direction } : undefined;
  const struck =
    beat?.events.some(
      (event) =>
        (event.type === 'cardDrawn' && event.playerId === table.localPlayerId) ||
        (event.type === 'unoCaught' && event.playerId === table.localPlayerId),
    ) ?? false;
  const seats = useCatchGrace(
    useMemo(() => opponents(table), [table]),
    catchDelayMs,
  );
  const turnName = currentPlayerName(table);

  useEffect(
    () => () => {
      if (refusalTimer.current !== null) {
        clearTimeout(refusalTimer.current);
      }
    },
    [],
  );

  /*
   * The table's voice, and a buzz on the two moments worth one.
   *
   * Cues are dropped while the page is hidden — a returning player would otherwise
   * get every sound of the last two minutes at once, which is the commonest bug in
   * browser audio.
   *
   * They are deliberately *not* gated on the live region below. Every beat updates
   * that region, so a "skip the cue when something is being announced" rule would
   * silence the sound feature for everyone — there is no browser signal for whether
   * a screen reader is actually listening. Sound and speech carry different things
   * (that something happened to me, versus what happened) and are meant to coexist;
   * a player who finds them competing turns Sound off in Settings, where it is a
   * first-class, persisted control defaulting on. An earlier version of this comment
   * claimed a ducking behaviour that was never wired, which QA rightly caught.
   */
  const beatSeq = beat?.seq ?? 0;
  useEffect(() => {
    if (!beat || typeof document === 'undefined' || document.visibilityState === 'hidden') {
      return;
    }
    const cue = cueFor(beat, table.localPlayerId);
    if (cue !== null) {
      playCue(cue);
    }
    if (cue === 'penalty') {
      penaltyBuzz();
    } else if (cue === 'yourTurn' && document.visibilityState !== 'visible') {
      returnBuzz();
    }
    // One beat is one accepted command; everything else here is read from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beatSeq]);

  /*
   * One announcement per change of state, carrying both halves of the answer to
   * "what just happened, and whose turn is it now". The log list is deliberately
   * not a live region: reading a scrolling history aloud buries this.
   */
  const latestId = feed.length > 0 ? feed[feed.length - 1]?.id : undefined;
  const currentId = publicState?.currentPlayerId ?? null;
  useEffect(() => {
    if (!publicState) {
      return;
    }
    const latest = feed.length > 0 ? feed[feed.length - 1] : undefined;
    const parts = [
      latest ? describeEvent(t, latest.event, (id) => playerName(table, id)) : '',
      myTurn ? t('game.yourTurn') : turnName ? t('game.turnOf', { name: turnName }) : '',
    ].filter(Boolean);
    announce(parts.join(' '));
    // A new event, or a new player on turn, is what makes this worth saying
    // again; re-running it on every render would not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestId, currentId, announce]);

  if (!publicState) {
    return (
      <div className="page">
        <ConnectionPhaseNotice />
        <p role="status">{t('game.waitingForState')}</p>
      </div>
    );
  }

  const onPlay = (card: Card): void => {
    if (requiresColorChoice(card)) {
      setPendingWild(card);
      return;
    }
    playCard(card.id);
  };

  /**
   * A tap on a card that cannot be played says why, rather than doing nothing.
   * Silence reads as a broken control; "wait for your turn" reads as a rule.
   */
  const onRefuse = (): void => {
    const reason = actionPending ? t('game.sending') : myTurn ? t('game.notPlayable') : t('game.notYourTurn');
    setRefusal(reason);
    announce(reason);
    if (refusalTimer.current !== null) {
      clearTimeout(refusalTimer.current);
    }
    refusalTimer.current = setTimeout(() => {
      setRefusal(null);
    }, REFUSAL_MS);
  };

  /*
   * The colour is what sends the card. Until this runs the move has not been made
   * at all, which is what keeps a card that leaves its owner on one from exposing
   * them — or letting them shout — before the table can see anything.
   */
  const onChooseColor = (color: CardColor): void => {
    if (pendingWild) {
      playCard(pendingWild.id, color);
      setPendingWild(null);
    }
  };

  const challenge = publicState.challenge;
  const challengerName = challenge ? playerName(table, challenge.playerId) : null;
  // A Wild Draw Four freezes the table for everyone until its victim answers.
  const mineToAnswer = mustAnswerChallenge(table);
  /*
   * One card a turn, and only before anything has been played. `hasDrawn` is what
   * closes the pile for the rest of the turn — without it the pile stays lit after
   * a draw and every tap is refused.
   */
  /*
   * Nothing anywhere left to draw, discard included. The pile then produces no card
   * however often it is tapped, so it stops being an offer — and the turn has to be
   * endable without one, or a table that reaches this state can never move again.
   */
  const pileSpent = publicState.drawPileCount === 0 && publicState.discardCount <= 1;
  const canDraw = myTurn && challenge === null && !publicState.hasDrawn && !pileSpent && !actionPending;
  const drawnCard = table.drawnCardId
    ? (table.hand.find((card) => card.id === table.drawnCardId) ?? null)
    : null;

  return (
    <div className="game">
      <div className="game__notice">
        <ConnectionPhaseNotice />
        <NudgeNotice />
        <CaughtNotice />
        <WaitingNotice />
      </div>

      {/*
       * Everything that is not the table or the hand, in one group. Upright the
       * group is transparent — `display: contents` — and its children are rows of
       * the page exactly as before. In landscape it becomes the column beside the
       * table, which is what lets the hand keep the full width and stops a tall
       * stack of notices from pushing it off the bottom of the screen.
       */}
      <div className="game__info">
        <OpponentList opponents={seats} t={t} onCatch={catchLastCard} sweep={sweep} registry={registry} />

        {/*
         * The nudge renders only while the table is genuinely waiting on a
         * connected player, so this row costs nothing the rest of the time. The
         * pause and end-round controls live in the room sheet instead: they are
         * once-an-evening actions, and a permanent row of them above the table
         * pushes a card off the bottom of a 390px screen — which the layout test
         * caught, correctly.
         */}
        <div className="row row--between">
          <NudgeButton />
        </div>

        {/* Outside the scrollable region below: on a short screen, whose turn it is
            is the last thing that should ever scroll out of sight. */}
        <div className="turn-row">
          {/* Keyed on whose turn it is, so the banner re-enters when it changes.
              On my own turn this is the whole cue: there is no seat of mine on
              the table to ring. */}
          <p key={currentId ?? 'none'} className={`turn-banner ${myTurn ? 'turn-banner--mine' : ''}`.trim()}>
            {myTurn ? t('game.yourTurn') : t('game.turnOf', { name: turnName ?? '—' })}
          </p>
          <DirectionIndicator direction={publicState.direction} textDirection={textDirection} t={t} />
        </div>

        <GameLog
          feed={feed}
          t={t}
          describe={(entry) => describeEvent(t, entry.event, (id) => playerName(table, id))}
        />

        <div className="game__action">
          {/*
           * Alongside the prompt, not instead of it.
           *
           * A refusal used to replace the whole prompt for 2.6 seconds. That was
           * survivable while only a card could be refused, but the draw pile now
           * explains itself too — and the commonest reason it is blocked is "not
           * your turn", where the prompt it would have hidden is the only useful
           * thing on the screen.
           */}
          {refusal ? (
            <Callout tone="warning" role="alert">
              {refusal}
            </Callout>
          ) : null}
          {
            <ActionPrompt
              t={t}
              myTurn={myTurn}
              turnName={turnName}
              actionPending={actionPending}
              challengeOpen={challenge !== null}
              challengerName={challengerName}
              mineToAnswer={mineToAnswer}
              challengeColor={publicState.activeColor}
              drawnCard={drawnCard}
              hasDrawn={publicState.hasDrawn}
              pileSpent={pileSpent}
              playableCount={playable.length}
              onPassTurn={passTurn}
              onAccept={acceptWildDrawFour}
              onChallenge={challengeWildDrawFour}
            />
          }
        </div>
      </div>

      <div className="game__table">
        <Piles
          t={t}
          landed={landed}
          registry={registry}
          discardTop={publicState.discardTop}
          drawPileCount={publicState.drawPileCount}
          activeColor={publicState.activeColor}
          canDraw={canDraw}
          onDraw={drawCard}
          onDrawBlocked={onRefuse}
          drawBlockedReason={publicState.hasDrawn ? t('reject.alreadyDrew') : t('game.drawPileBlocked')}
        />
      </div>

      {/*
       * Its own row, immediately above the hand, rather than one more case in the
       * prompt below. The declaration is legal at any moment and from any seat, so
       * it must not have to wait its turn behind a prompt about somebody else's
       * move — and it is the one control on this screen with a penalty attached to
       * missing it.
       */}
      {mustDeclare || declared ? (
        <div className="game__declare">
          {mustDeclare ? (
            <Button
              variant="primary"
              extraClass="declare-btn"
              block
              onClick={declareLastCard}
              disabled={actionPending}
            >
              <span className="declare-btn__shout">{t('game.declareLastCard')}</span>
              <span className="declare-btn__why">
                {t('game.declareLastCardBody', { count: UNO_PENALTY })}
              </span>
            </Button>
          ) : (
            <p className="declared-note" role="status">
              <Icon name="check" size={1} />
              {t('game.declaredLastCardMine')}
            </p>
          )}
        </div>
      ) : null}

      <div
        // Keyed so a penalty that lands on me is said once, behind the hand.
        key={struck ? `struck-${beat?.seq ?? 0}` : 'hand'}
        className={`game__hand ${struck ? 'game__hand--struck' : ''}`.trim()}
      >
        <Hand
          cards={cards}
          registry={registry}
          playableIds={playable}
          t={t}
          onPlay={onPlay}
          onRefuse={onRefuse}
          locked={actionPending}
          disabledReason={myTurn ? t('game.notPlayable') : t('game.notYourTurn')}
          points={myPoints(table)}
        />
      </div>

      {/* Last, so it paints over the table it is describing. */}
      <FlightLayer beat={beat} localPlayerId={table.localPlayerId} registry={registry} />

      <ColorPickerModal
        open={pendingWild !== null}
        card={pendingWild}
        t={t}
        onChoose={onChooseColor}
        onCancel={() => {
          setPendingWild(null);
        }}
      />
    </div>
  );
}

interface ActionPromptProps {
  readonly t: Translator;
  readonly myTurn: boolean;
  readonly turnName: string | null;
  readonly actionPending: boolean;
  readonly challengeOpen: boolean;
  readonly challengerName: string | null;
  readonly mineToAnswer: boolean;
  readonly challengeColor: CardColor;
  readonly drawnCard: Card | null;
  readonly hasDrawn: boolean;
  /** Nothing anywhere left to draw, so the turn must be endable without drawing. */
  readonly pileSpent: boolean;
  readonly playableCount: number;
  readonly onPassTurn: () => void;
  readonly onAccept: () => void;
  readonly onChallenge: () => void;
}

/**
 * The one line that answers "what do I do now", with the buttons for doing it.
 *
 * Exactly one of these is on screen at a time, in strict priority order. The
 * screen it replaces stacked up to four notices at once, each in the same flat
 * blue box, leaving the player to work out which one was addressed to them.
 */
function ActionPrompt({
  t,
  myTurn,
  turnName,
  actionPending,
  challengeOpen,
  challengerName,
  mineToAnswer,
  challengeColor,
  drawnCard,
  hasDrawn,
  pileSpent,
  playableCount,
  onPassTurn,
  onAccept,
  onChallenge,
}: ActionPromptProps): ReactNode {
  // A Wild Draw Four suspends the turn order for everybody, so it outranks whose
  // turn it is.
  if (challengeOpen) {
    return mineToAnswer ? (
      <Callout
        tone="action"
        urgent
        role="status"
        title={t('game.challengeTitle')}
        actions={
          <>
            <Button variant="primary" onClick={onAccept}>
              {t('game.challengeAccept')}
            </Button>
            <Button variant="ghost" onClick={onChallenge}>
              {t('game.challengeCall')}
            </Button>
          </>
        }
      >
        {t('game.challengeBody', {
          name: challengerName ?? '—',
          color: colorName(t, challengeColor),
        })}
      </Callout>
    ) : (
      <Callout tone="neutral" icon="hourglass" role="status" title={t('game.challengeTitle')}>
        {t('game.challengeWaiting', { name: challengerName ?? '—' })}
      </Callout>
    );
  }

  if (!myTurn) {
    return (
      <Callout tone="neutral" icon="hourglass" role="status">
        {t('game.waitingFor', { name: turnName ?? '—' })}
      </Callout>
    );
  }

  if (actionPending) {
    return (
      <Callout tone="neutral" icon="hourglass" role="status">
        {t('game.sending')}
      </Callout>
    );
  }

  /*
   * A card has been drawn, so the turn is half over and the choice has narrowed to
   * two: play that card, or end the turn. Both branches offer the same button,
   * because ending the turn is legal either way — what changes is whether the card
   * is also an option, and saying which it is out loud saves the player hunting
   * through a hand that is no longer playable.
   */
  if (hasDrawn || pileSpent) {
    const card = drawnCard === null ? '—' : describeCard(t, drawnCard);
    return (
      <Callout
        tone={playableCount > 0 ? 'action' : 'neutral'}
        urgent={playableCount > 0}
        role="status"
        actions={
          <Button variant={playableCount > 0 ? 'ghost' : 'primary'} onClick={onPassTurn}>
            {t('game.passTurn')}
          </Button>
        }
      >
        {pileSpent && !hasDrawn
          ? t('game.pileSpent')
          : playableCount > 0
            ? t('game.drewCard', { card })
            : t('game.drewUnplayable', { card })}
      </Callout>
    );
  }

  if (playableCount === 0) {
    return (
      <Callout tone="action" urgent role="status">
        {t('game.mustDraw')}
      </Callout>
    );
  }

  return (
    <Callout tone="success" icon="check" role="status">
      {t('game.playOrDraw')}
    </Callout>
  );
}
