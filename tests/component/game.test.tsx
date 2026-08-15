import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import {
  GUEST_ID,
  HOST_ID,
  enterGame,
  lobbyFixture,
  renderApp,
  resetStore,
  setState,
  statusRegions,
} from './helpers.tsx';
import { getPlayableCardIds } from '../../src/features/game/engine/rules.ts';
import { useAppStore } from '../../src/features/game/state/store.ts';
import { playContextFromPublic } from '../../src/features/game/engine/views.ts';
import type { Card } from '../../src/features/game/engine/cards.ts';

beforeEach(resetStore);

/** Overrides the hand and public state so a specific rule situation is on screen. */
function situation(options: {
  hand: readonly Card[];
  discardTop: Card;
  activeColor: 'red' | 'blue' | 'green' | 'yellow';
  myTurn?: boolean;
  hasDrawn?: boolean;
  drawnCardId?: string | null;
  challenge?: { playerId: string; targetId: string } | null;
}): void {
  const fixture = enterGame({ myTurn: options.myTurn ?? true });
  setState({
    hand: options.hand,
    drawnCardId: options.drawnCardId ?? null,
    publicState: {
      ...fixture.publicState,
      currentPlayerId: (options.myTurn ?? true) ? HOST_ID : GUEST_ID,
      discardTop: options.discardTop,
      activeColor: options.activeColor,
      hasDrawn: options.hasDrawn ?? typeof options.drawnCardId === 'string',
      challenge: options.challenge ?? null,
      players: [
        { id: HOST_ID, name: 'דנה', cardCount: options.hand.length },
        { id: GUEST_ID, name: 'אלי', cardCount: 5 },
      ],
    },
  });
}

/**
 * A hand card is a real button that is never `disabled` — see `PlayableCard` —
 * so legality is asserted through `aria-disabled` and the legal-card class.
 */
function expectPlayable(name: string): void {
  const card = screen.getByRole('button', { name });
  expect(card).toHaveAttribute('aria-disabled', 'false');
  expect(card).toHaveClass('card--playable');
}

function expectRefused(name: string): void {
  const card = screen.getByRole('button', { name });
  expect(card).toHaveAttribute('aria-disabled', 'true');
  expect(card).toHaveClass('card--dimmed');
}

const red5: Card = { id: 'c1', kind: 'number', color: 'red', value: 5 };
const blue5: Card = { id: 'c2', kind: 'number', color: 'blue', value: 5 };
const blue3: Card = { id: 'c3', kind: 'number', color: 'blue', value: 3 };
const redSkip: Card = { id: 'c4', kind: 'skip', color: 'red' };
const wild: Card = { id: 'c6', kind: 'wild' };
const red9: Card = { id: 'c8', kind: 'number', color: 'red', value: 9 };
const wildDrawFour: Card = { id: 'c11', kind: 'wildDrawFour' };

describe('table layout', () => {
  it('shows the opponent face down with a card count, never their cards', () => {
    enterGame();
    renderApp();
    const opponents = screen.getByRole('region', { name: 'שאר השחקנים' });
    expect(within(opponents).getByText('אלי')).toBeInTheDocument();
    expect(within(opponents).getByText('7 קלפים')).toBeInTheDocument();
    expect(within(opponents).getByRole('img', { name: 'קלף הפוך' })).toBeInTheDocument();
  });

  it('shows the current colour, direction and whose turn it is', () => {
    enterGame();
    renderApp();
    expect(screen.getByText(/הצבע הנוכחי:/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'כיוון המשחק: קדימה, לפי סדר המושבים' })).toBeInTheDocument();
    expect(screen.getByText('תור שלך')).toBeInTheDocument();
  });

  /*
   * The arrow, not the words, is what a player reads at a glance — and it points at
   * the row of seats, which is laid out in the document's direction. Hebrew is the
   * default and runs right-to-left, so "follows the seating order" is a *left* arrow
   * there and a right arrow in English. This is the assertion that would have caught
   * the circular glyph that pointed the same way in both.
   */
  it('points the play-order arrow the way the seats actually run', () => {
    enterGame();
    renderApp();
    const chip = screen.getByRole('img', { name: /כיוון המשחק/ });
    const arrow = chip.querySelector('.direction-chip__arrow');
    expect(arrow).toHaveClass('direction-chip__arrow--mirrored');
    expect(chip).not.toHaveClass('direction-chip--reversed');
  });

  it('turns the arrow round, and marks the chip, when the order reverses', () => {
    const fixture = enterGame();
    setState({ publicState: { ...fixture.publicState, currentPlayerId: HOST_ID, direction: -1 } });
    renderApp();
    const chip = screen.getByRole('img', { name: 'כיוון המשחק: הפוך, נגד סדר המושבים' });
    expect(chip.querySelector('.direction-chip__arrow')).not.toHaveClass('direction-chip__arrow--mirrored');
    expect(chip).toHaveClass('direction-chip--reversed');
  });

  it('mirrors the same order for a player reading English', () => {
    setState({ language: 'en' });
    document.documentElement.dir = 'ltr';
    enterGame();
    renderApp();
    const chip = screen.getByRole('img', { name: 'Play order: forwards, following the seats' });
    expect(chip.querySelector('.direction-chip__arrow')).not.toHaveClass('direction-chip__arrow--mirrored');
  });

  it('names the opponent when it is their turn', () => {
    enterGame({ myTurn: false });
    renderApp();
    expect(screen.getByText('התור של אלי')).toBeInTheDocument();
  });

  it('gives the discard top an accessible name', () => {
    const fixture = enterGame();
    renderApp();
    const top = fixture.publicState.discardTop;
    expect(top).not.toBeNull();
    expect(screen.getAllByRole('img').some((node) => node.getAttribute('aria-label')?.length)).toBe(true);
  });
});

describe('legal card highlighting', () => {
  it('enables only the legal cards on your turn', () => {
    situation({ hand: [red5, blue3, wild], discardTop: red9, activeColor: 'red' });
    renderApp();

    expectPlayable('הנחת אדום 5');
    expectPlayable('הנחת ג׳וקר');
    expectRefused('הנחת כחול 3');
  });

  it('accepts a symbol match across colours', () => {
    situation({ hand: [blue5, blue3], discardTop: red5, activeColor: 'red' });
    renderApp();
    expectPlayable('הנחת כחול 5');
    expectRefused('הנחת כחול 3');
  });

  it('blocks the whole hand when it is not your turn, and says why', async () => {
    const playCard = vi.fn();
    situation({ hand: [red5, wild], discardTop: red9, activeColor: 'red', myTurn: false });
    setState({ playCard });
    const { user } = renderApp();

    const card = screen.getByRole('button', { name: 'הנחת אדום 5' });
    expectRefused('הנחת אדום 5');
    expectRefused('הנחת ג׳וקר');

    /*
     * The cards stay reachable rather than being `disabled`: a disabled button
     * cannot be focused, so a keyboard or screen-reader player could not read
     * their own hand. Pressing one explains itself instead of doing nothing.
     */
    expect(card).toHaveAttribute('title', 'צריך לחכות לתור שלך.');
    await user.click(card);
    expect(playCard).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('צריך לחכות לתור שלך.');
  });

  it('agrees with the engine about which cards are legal', () => {
    const hand = [red5, blue3, wild, redSkip];
    situation({ hand, discardTop: red9, activeColor: 'red' });
    const { publicState } = {
      publicState: { activeColor: 'red' as const, discardTop: red9 },
    };
    const expected = getPlayableCardIds(
      hand,
      playContextFromPublic({
        ...publicState,
        version: 1,
        phase: 'playing',
        players: [],
        drawPileCount: 1,
        discardCount: 1,
        direction: 1,
        currentPlayerId: HOST_ID,
        pendingPlus: false,
        winnerId: null,
      } as never),
    );
    expect(expected).toEqual([red5.id, wild.id, redSkip.id]);
  });

  it('plays a coloured card straight away', async () => {
    const playCard = vi.fn();
    situation({ hand: [red5, blue3], discardTop: red9, activeColor: 'red' });
    setState({ playCard });
    const { user } = renderApp();

    await user.click(screen.getByRole('button', { name: 'הנחת אדום 5' }));
    expect(playCard).toHaveBeenCalledWith(red5.id);
  });
});

/*
 * The pile refuses with `aria-disabled`, not `disabled`.
 *
 * The same trade `PlayableCard` already made deliberately: a real `disabled`
 * attribute takes the control out of the tab order, gives it no press feedback,
 * and puts its `title` somewhere most browsers will not show — so a blocked tap
 * was a silent dead end, while a blocked *card* has always explained itself. The
 * cost, stated plainly, is a tab stop that now exists whenever the pile is
 * blocked, which is most of the game.
 *
 * `jest-dom`'s `toBeDisabled()` reads the attribute and never `aria-disabled`, so
 * these assertions had to change with the component rather than after it.
 */
describe('the draw pile', () => {
  it('is interactive on your turn and announces the count', () => {
    situation({ hand: [blue3], discardTop: red9, activeColor: 'red' });
    renderApp();
    const pile = screen.getByRole('button', { name: /חבילת משיכה, \d+ קלפים/ });
    expect(pile).toHaveAttribute('aria-disabled', 'false');
  });

  it('refuses when it is not your turn, and says why', async () => {
    situation({ hand: [blue3], discardTop: red9, activeColor: 'red', myTurn: false });
    const { user } = renderApp();
    const pile = screen.getByRole('button', { name: /חבילת משיכה/ });
    expect(pile).toHaveAttribute('aria-disabled', 'true');

    await user.click(pile);
    expect(screen.getByRole('alert')).toHaveTextContent('צריך לחכות לתור שלך.');
    /*
     * And the prompt survives. A refusal replaces the whole action prompt for
     * 2.6 seconds, so routing this through the card path unchanged would have
     * hidden the one line explaining what to do — in the most common blocked
     * case there is.
     */
    expect(screen.getByText(/ממתינים ל/)).toBeInTheDocument();
  });

  it('refuses a second card once one has been drawn this turn', () => {
    situation({
      hand: [blue3, red9],
      discardTop: red9,
      activeColor: 'red',
      drawnCardId: red9.id,
    });
    renderApp();
    expect(screen.getByRole('button', { name: /חבילת משיכה/ })).toHaveAttribute('aria-disabled', 'true');
  });

  it('tells the player to draw when nothing is legal', () => {
    situation({ hand: [blue3], discardTop: red9, activeColor: 'red' });
    renderApp();
    expect(screen.getByText('אין קלף חוקי. יש למשוך קלף מהחבילה.')).toBeInTheDocument();
  });

  it('draws when clicked', async () => {
    const drawCard = vi.fn();
    situation({ hand: [blue3], discardTop: red9, activeColor: 'red' });
    setState({ drawCard });
    const { user } = renderApp();
    await user.click(screen.getByRole('button', { name: /חבילת משיכה/ }));
    expect(drawCard).toHaveBeenCalled();
  });
});

describe('wild cards and the colour picker', () => {
  it('asks for a colour before playing a wild card', async () => {
    const playCard = vi.fn();
    situation({ hand: [wild, red5], discardTop: red9, activeColor: 'red' });
    setState({ playCard });
    const { user } = renderApp();

    await user.click(screen.getByRole('button', { name: 'הנחת ג׳וקר' }));
    expect(playCard).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('בחירת צבע עבור ג׳וקר');
    for (const color of ['אדום', 'כחול', 'ירוק', 'צהוב']) {
      expect(within(dialog).getByRole('button', { name: color })).toBeInTheDocument();
    }

    await user.click(within(dialog).getByRole('button', { name: 'ירוק' }));
    expect(playCard).toHaveBeenCalledWith(wild.id, 'green');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  /*
   * The dialog asks one question. The shout used to be armed inside it, ahead of the
   * colour, which opened the declaration before the card had been played at all —
   * earlier than the table can see anything. It belongs after the colour, alongside
   * the catch the same card exposes its owner to.
   */
  it('offers no shout, even when the card is the second to last', async () => {
    situation({ hand: [wild, red5], discardTop: red9, activeColor: 'red' });
    const { user } = renderApp();

    await user.click(screen.getByRole('button', { name: 'הנחת ג׳וקר' }));
    expect(
      within(screen.getByRole('dialog')).queryByRole('button', { name: /אונו/ }),
    ).not.toBeInTheDocument();
  });

  it('opens nothing behind the dialog either, because the card has not been played', async () => {
    situation({ hand: [wild, red5], discardTop: red9, activeColor: 'red' });
    const { user } = renderApp();

    await user.click(screen.getByRole('button', { name: 'הנחת ג׳וקר' }));
    // The hand is still two cards, so there is nothing on the whole screen to
    // declare — and by the same token nothing for anybody else to catch.
    expect(screen.queryByRole('button', { name: /אונו/ })).not.toBeInTheDocument();
  });

  it('asks for a colour on a Wild Draw Four too', async () => {
    /*
     * The line clones get wrong. A Wild Draw Four is a wild: its owner names the
     * colour play continues in, whether the card was honest or a bluff, and whether
     * or not the challenge that follows goes against them.
     */
    situation({ hand: [wildDrawFour, blue3], discardTop: red9, activeColor: 'red' });
    const { user } = renderApp();
    await user.click(screen.getByRole('button', { name: 'הנחת ג׳וקר קח 4' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('plays a coloured action card without asking', async () => {
    const playCard = vi.fn();
    situation({ hand: [redSkip, blue3], discardTop: red9, activeColor: 'red' });
    setState({ playCard });
    const { user } = renderApp();

    await user.click(screen.getByRole('button', { name: 'הנחת אדום עצור' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(playCard).toHaveBeenCalledWith(redSkip.id);
  });

  it('can be cancelled without playing anything', async () => {
    const playCard = vi.fn();
    situation({ hand: [wild], discardTop: red9, activeColor: 'red' });
    setState({ playCard });
    const { user } = renderApp();

    await user.click(screen.getByRole('button', { name: 'הנחת ג׳וקר' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'ביטול' }));
    expect(playCard).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on Escape and restores focus to the card', async () => {
    situation({ hand: [wild], discardTop: red9, activeColor: 'red' });
    const { user } = renderApp();

    const card = screen.getByRole('button', { name: 'הנחת ג׳וקר' });
    await user.click(card);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(card).toHaveFocus();
  });

  it('traps focus inside the dialog', async () => {
    situation({ hand: [wild], discardTop: red9, activeColor: 'red' });
    const { user } = renderApp();
    await user.click(screen.getByRole('button', { name: 'הנחת ג׳וקר' }));

    const dialog = screen.getByRole('dialog');
    for (let i = 0; i < 8; i += 1) {
      await user.keyboard('{Tab}');
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });
});

describe('a Wild Draw Four waiting to be answered', () => {
  it('offers the two answers to the seat that has to give one', () => {
    situation({
      hand: [blue3, red5],
      discardTop: red9,
      activeColor: 'red',
      challenge: { playerId: GUEST_ID, targetId: HOST_ID },
    });
    renderApp();
    expect(screen.getByText('הונח ג׳וקר קח 4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'לקיחת ארבעה' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'הטלת ספק' })).toBeInTheDocument();
  });

  it('tells everybody else that the table is waiting, with no buttons', () => {
    situation({
      hand: [blue3, red5],
      discardTop: red9,
      activeColor: 'red',
      myTurn: false,
      challenge: { playerId: HOST_ID, targetId: GUEST_ID },
    });
    renderApp();
    expect(screen.getByText(/ממתינים לראות אם/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'לקיחת ארבעה' })).not.toBeInTheDocument();
  });

  it('freezes the hand: nothing is playable by anybody while it is open', () => {
    situation({
      hand: [red5, blue3],
      discardTop: red9,
      activeColor: 'red',
      challenge: { playerId: GUEST_ID, targetId: HOST_ID },
    });
    renderApp();
    expectRefused('הנחת אדום 5');
  });

  it('sends the answer the buttons name', async () => {
    const acceptWildDrawFour = vi.fn();
    const challengeWildDrawFour = vi.fn();
    situation({
      hand: [blue3],
      discardTop: red9,
      activeColor: 'red',
      challenge: { playerId: GUEST_ID, targetId: HOST_ID },
    });
    setState({ acceptWildDrawFour, challengeWildDrawFour });
    const { user } = renderApp();
    await user.click(screen.getByRole('button', { name: 'לקיחת ארבעה' }));
    expect(acceptWildDrawFour).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'הטלת ספק' }));
    expect(challengeWildDrawFour).toHaveBeenCalled();
  });
});

describe('a turn that has already drawn', () => {
  it('lights only the drawn card, and offers to end the turn', () => {
    situation({ hand: [red5, red9], discardTop: red9, activeColor: 'red', drawnCardId: red9.id });
    renderApp();
    expectPlayable('הנחת אדום 9');
    // Legal by the ordinary rules, and out of reach because the turn has been spent.
    expectRefused('הנחת אדום 5');
    expect(screen.getByRole('button', { name: 'סיום התור' })).toBeInTheDocument();
  });

  it('says so plainly when the drawn card does not fit', () => {
    situation({ hand: [red5, blue3], discardTop: red9, activeColor: 'red', drawnCardId: blue3.id });
    renderApp();
    expect(screen.getByText(/לא מתאים/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'סיום התור' })).toBeInTheDocument();
  });

  it('ends the turn when asked', async () => {
    const passTurn = vi.fn();
    situation({ hand: [red5, blue3], discardTop: red9, activeColor: 'red', drawnCardId: blue3.id });
    setState({ passTurn });
    const { user } = renderApp();
    await user.click(screen.getByRole('button', { name: 'סיום התור' }));
    expect(passTurn).toHaveBeenCalled();
  });
});

describe('game log', () => {
  function withFeed(): void {
    enterGame();
    setState({
      feed: [
        { id: 1, event: { type: 'gameStarted', firstPlayerId: HOST_ID, activeColor: 'red' } },
        {
          id: 2,
          event: { type: 'cardPlayed', playerId: GUEST_ID, card: blue5, resultingColor: 'blue' },
        },
        { id: 3, event: { type: 'cardDrawn', playerId: HOST_ID, count: 1 } },
      ],
    });
  }

  it('keeps the newest line on screen without spending the table on history', () => {
    withFeed();
    renderApp();
    // The ticker carries the latest event; the rest is one press away.
    expect(screen.getByText('דנה משך/ה קלף.')).toBeInTheDocument();
    expect(screen.queryByText('הסבב מתחיל. הצבע: אדום.')).not.toBeInTheDocument();
  });

  it('lists public events without exposing hands', async () => {
    withFeed();
    const { user } = renderApp();
    await user.click(screen.getByRole('button', { name: 'יומן המשחק' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('הסבב מתחיל. הצבע: אדום.')).toBeInTheDocument();
    expect(within(dialog).getByText('אלי הניח/ה כחול 5.')).toBeInTheDocument();
    expect(within(dialog).getByText('דנה משך/ה קלף.')).toBeInTheDocument();
  });

  it('says so when nothing has happened yet', () => {
    enterGame();
    renderApp();
    expect(screen.getByText('עוד לא קרה דבר.')).toBeInTheDocument();
  });
});

describe('rejected moves', () => {
  it('explains the rejection and can be dismissed', async () => {
    enterGame();
    setState({ rejection: { code: 'illegalCard', nonce: 1 } });
    const { user } = renderApp();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('הקלף לא מתאים לצבע ולא לסמל.');
    await user.click(within(alert).getByRole('button', { name: 'סגירה' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('explains why the rest of the hand is out of reach after a draw', () => {
    situation({ hand: [red5, red9], discardTop: red9, activeColor: 'red', drawnCardId: red9.id });
    setState({ rejection: { code: 'onlyDrawnCardPlayable', nonce: 2 } });
    renderApp();
    expect(screen.getByRole('alert')).toHaveTextContent('משכת קלף בתור הזה');
  });
});

describe('leaving a game', () => {
  it('confirms before leaving a game', async () => {
    const leaveRoom = vi.fn();
    enterGame();
    setState({ leaveRoom });
    const { user } = renderApp();

    await user.click(screen.getByRole('button', { name: 'יציאה' }));
    const dialog = screen.getByRole('dialog');
    // A host with another player present is offered the handover; closing the room
    // for everybody is still available, and still the destructive option.
    await user.click(within(dialog).getByRole('button', { name: 'יציאה' }));
    expect(leaveRoom).toHaveBeenCalled();
  });

  it('waits politely before the first snapshot arrives', () => {
    setState({ screen: 'game', inRoom: true, phase: 'connected', publicState: null });
    renderApp();
    expect(statusRegions()[0]).toHaveTextContent('ממתינים לשולחן…');
  });
});

describe('the last card declaration', () => {
  /** One card in hand, nobody having declared anything yet. */
  function oneCardLeft(options: { myTurn?: boolean; declared?: readonly string[] } = {}): void {
    const fixture = enterGame({ myTurn: options.myTurn ?? true });
    setState({
      hand: [red5],
      publicState: {
        ...fixture.publicState,
        currentPlayerId: (options.myTurn ?? true) ? HOST_ID : GUEST_ID,
        discardTop: red9,
        activeColor: 'red',
        declaredUno: options.declared ?? [],
        players: [
          { id: HOST_ID, name: 'דנה', cardCount: 1 },
          { id: GUEST_ID, name: 'אלי', cardCount: 5 },
        ],
      },
    });
  }

  it('offers the declaration the moment the hand comes down to one card', async () => {
    const declareLastCard = vi.fn();
    oneCardLeft();
    setState({ declareLastCard });
    const { user } = renderApp();

    const button = screen.getByRole('button', { name: /אונו/ });
    expect(button).toHaveTextContent('2 קלפים');
    await user.click(button);
    expect(declareLastCard).toHaveBeenCalled();
  });

  it('offers it out of turn too, since that is when the card is usually laid down', () => {
    oneCardLeft({ myTurn: false });
    renderApp();
    expect(screen.getByRole('button', { name: /אונו/ })).toBeInTheDocument();
  });

  it('replaces the button with confirmation once the declaration lands', () => {
    oneCardLeft({ declared: [HOST_ID] });
    renderApp();
    expect(screen.queryByRole('button', { name: /אונו/ })).not.toBeInTheDocument();
    expect(screen.getByText(/אף אחד לא יכול לתפוס אותך/)).toBeInTheDocument();
  });

  it('says nothing at all while the hand is bigger than one card', () => {
    situation({ hand: [red5, blue3], discardTop: red9, activeColor: 'red' });
    renderApp();
    expect(screen.queryByRole('button', { name: /אונו/ })).not.toBeInTheDocument();
  });

  it("shows at the opponent's seat whether they declared", () => {
    oneCardLeft({ declared: [GUEST_ID] });
    setState({
      publicState: {
        ...useAppStore.getState().publicState!,
        players: [
          { id: HOST_ID, name: 'דנה', cardCount: 1 },
          { id: GUEST_ID, name: 'אלי', cardCount: 1 },
        ],
      },
    });
    renderApp();
    const opponents = screen.getByRole('region', { name: 'שאר השחקנים' });
    expect(within(opponents).getByText('הכריז/ה')).toBeInTheDocument();
  });

  it('counts down the seat it is holding, and keeps counting', async () => {
    /*
     * The headline of the whole effort, and it had no test: a countdown that does
     * not advance is not a countdown. The first implementation cancelled the clock
     * skew against the *current* time rather than the arrival time, which reduced
     * the arithmetic to a constant, so it re-rendered the same number every second.
     */
    vi.useFakeTimers();
    try {
      const sentAt = 1_000_000;
      enterGame();
      setState({
        lobby: lobbyFixture({
          phase: 'inGame',
          sentAt,
          seatGraceMs: 300_000,
          waitingFor: GUEST_ID,
          waitingReason: 'absent',
          players: [
            { id: HOST_ID, name: 'דנה', isCreator: true, health: 'connected', seat: 0 },
            {
              id: GUEST_ID,
              name: 'אלי',
              isCreator: false,
              health: 'disconnected',
              seat: 1,
              // Away for a minute already, by the host's own reckoning.
              absentSince: sentAt - 60_000,
            },
          ],
        }),
      });
      renderApp();

      // Five minutes' grace less the minute already gone.
      expect(screen.getByText(/4:00/)).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(3_000);
        await Promise.resolve();
      });
      expect(screen.getByText(/3:57/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('waiting on somebody at the table', () => {
  it('keeps the seat-hold callout and its focus across a fresh snapshot', async () => {
    /*
     * The countdown used to be keyed on the snapshot time so it could re-anchor on
     * the host's number, which meant the host re-broadcasting — something it does on
     * every accepted command — tore the callout down and rebuilt it. Anybody who had
     * tabbed to "pass their turn" lost the focus mid-interaction. The count now runs
     * locally from the reading it had when it appeared, so a new snapshot must leave
     * both the element and the focus alone.
     */
    vi.useFakeTimers();
    try {
      const sentAt = 1_000_000;
      enterGame();
      const held = (at: number) =>
        lobbyFixture({
          phase: 'inGame',
          sentAt: at,
          seatGraceMs: 300_000,
          waitingFor: GUEST_ID,
          waitingReason: 'absent',
          players: [
            { id: HOST_ID, name: 'דנה', isCreator: true, health: 'connected', seat: 0 },
            {
              id: GUEST_ID,
              name: 'אלי',
              isCreator: false,
              health: 'disconnected',
              seat: 1,
              absentSince: sentAt - 60_000,
            },
          ],
        });
      setState({ lobby: held(sentAt) });
      renderApp();

      const skip = screen.getByRole('button', { name: 'העברת התור' });
      skip.focus();
      expect(document.activeElement).toBe(skip);

      await act(async () => {
        vi.advanceTimersByTime(2_000);
        await Promise.resolve();
      });
      // A later snapshot, exactly as an accepted command would produce.
      await act(async () => {
        setState({ lobby: held(sentAt + 2_000) });
        await Promise.resolve();
      });

      // Same element, same focus, and the count did not jump back to 4:00.
      expect(screen.getByRole('button', { name: 'העברת התור' })).toBe(skip);
      expect(document.activeElement).toBe(skip);
      expect(screen.getByText(/3:58/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('offers the nudge only once the host says the wait is long, and sends it once', async () => {
    const sentAt = 2_000_000;
    enterGame({ myTurn: false });
    const waiting = (waitedMs: number) =>
      lobbyFixture({
        phase: 'inGame',
        sentAt,
        waitingFor: GUEST_ID,
        waitingReason: 'turn',
        waitingSince: sentAt - waitedMs,
      });

    setState({ lobby: waiting(5_000) });
    const { user } = renderApp();
    // Five seconds is a normal turn: offering the nudge here is hurrying people.
    expect(screen.queryByRole('button', { name: 'תזכורת' })).not.toBeInTheDocument();

    const sent: string[] = [];
    await act(async () => {
      setState({
        lobby: waiting(31_000),
        nudgePlayer: (playerId: string) => {
          sent.push(playerId);
        },
      });
      await Promise.resolve();
    });

    const button = screen.getByRole('button', { name: 'תזכורת' });
    await user.click(button);
    expect(sent).toEqual([GUEST_ID]);
    expect(screen.getByRole('button', { name: 'התזכורת נשלחה.' })).toBeDisabled();
  });

  it('shows a received nudge and clears it without being asked', async () => {
    /*
     * The receiving half shipped writing to the store and rendering nothing, so the
     * feature was a button that sent a message into silence.
     */
    vi.useFakeTimers();
    try {
      enterGame();
      setState({ nudge: { fromPlayerId: GUEST_ID, nonce: 1 } });
      renderApp();

      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('אלי');

      await act(async () => {
        vi.advanceTimersByTime(12_000);
        await Promise.resolve();
      });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(useAppStore.getState().nudge).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
