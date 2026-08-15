import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  expectDealt,
  awaitSettled,
  canDrawFrom,
  createRoom,
  joinRoom,
  onTurn,
  openApp,
  tapIfPresent,
} from './helpers.ts';

/**
 * Plays a complete round through the UI.
 *
 * Both players act like simple bots: play the first legal card, close an open
 * turn when nothing else is legal, otherwise draw. This exercises long
 * chains of real room-validated commands — including the action cards, the wilds
 * sequences and draw-pile recycling — and ends on the game-over screen.
 *
 * Bounded by the clock rather than by a step count. How many steps a round
 * takes varies enormously — a hand grows on every Draw Two and every Wild Draw Four
 * makes them bigger — and a step count that fits the average round fails the
 * long ones for no reason. Time is what the test actually has to stay inside.
 */
const ROUND_BUDGET_MS = 8 * 60 * 1000;

/*
 * Both players are tabs in one browser, so one of them is always in the
 * background — and Chromium stops firing `requestAnimationFrame` there.
 * Playwright's actionability check waits on two animation frames, so a click on
 * a background tab would wait for ever even though the element is perfectly
 * clickable. Reading the DOM is unaffected, so only the clicks need this.
 */
async function clickInForeground(page: Page, locator: Locator): Promise<void> {
  await page.bringToFront();
  await locator.click();
}

async function takeOneAction(page: Page): Promise<boolean> {
  await page.bringToFront();
  await awaitSettled(page);

  /*
   * A hand of one is declared first, and out of turn if need be: without the
   * declaration the last card cannot win, so a bot that skipped it would draw a
   * two-card penalty every time it got close and the round would never end.
   */
  if (await tapIfPresent(page, /Last card!/)) {
    return true;
  }

  // An open Wild Draw Four suspends the turn order, so this comes before the turn
  // check. Taking the cards rather than calling the bluff keeps the driver honest:
  // a challenge is a gamble, and a gamble makes a round different every run.
  if (await tapIfPresent(page, 'Take four')) {
    return true;
  }

  if (!(await onTurn(page))) {
    return false;
  }

  const playable = page.locator('.hand .card--playable').first();
  if (await playable.count()) {
    await clickInForeground(page, playable);
    const picker = page.getByRole('dialog');
    if (await picker.isVisible().catch(() => false)) {
      await picker.getByRole('button', { name: 'Green', exact: true }).click();
    }
    return true;
  }

  const endTurn = page.getByRole('button', { name: 'End my turn' });
  if (await endTurn.isVisible().catch(() => false)) {
    await clickInForeground(page, endTurn);
    return true;
  }

  // Kept as a no-op seam: the prompt no longer offers a bulk take, and a driver that
  // silently stopped looking for one would hide a regression rather than report it.
  const takeCards = page.getByRole('button', { name: /^Take \d+ cards?$/ });
  if (await takeCards.isVisible().catch(() => false)) {
    await clickInForeground(page, takeCards);
    return true;
  }

  const drawPile = page.getByRole('button', { name: /Draw pile, \d+ cards/ });
  if (await canDrawFrom(page)) {
    await clickInForeground(page, drawPile);
    return true;
  }
  return false;
}

test.describe('a complete round', () => {
  test.setTimeout(ROUND_BUDGET_MS + 120_000);

  test('plays to a winner and offers another round', async ({ context }, testInfo) => {
    /*
     * Once is enough. Nothing in a round of play depends on the viewport — the
     * layout tests cover that — and this is by far the longest test in the
     * suite, so running it twice buys no signal and doubles the wait.
     */
    test.skip(testInfo.project.name !== 'desktop', 'a round of play is viewport-independent');

    const host = await context.newPage();
    const guest = await context.newPage();

    await openApp(host, '/');
    const roomCode = await createRoom(host, 'Dana', 2);
    await openApp(guest, '/');
    await joinRoom(guest, 'Eli', roomCode);
    await expect(host.getByText('2 of 2 players')).toBeVisible();

    await host.getByRole('button', { name: 'Start game' }).click();
    await expectDealt(host);

    const deadline = Date.now() + ROUND_BUDGET_MS;
    let finished = false;
    while (!finished && Date.now() < deadline) {
      const acted = (await takeOneAction(host)) || (await takeOneAction(guest));
      if (!acted) {
        // Give the transport a moment; a snapshot may still be in flight.
        await host.waitForTimeout(60);
      }
      finished = await host
        .getByRole('heading', { name: 'Round finished' })
        .isVisible()
        .catch(() => false);
    }

    expect(finished, 'the round did not reach a winner inside its time budget').toBe(true);
    await expect(host.getByRole('heading', { name: 'Final standings' })).toBeVisible();
    await expect(guest.getByRole('heading', { name: 'Round finished' })).toBeVisible();

    // Exactly one player finished with zero cards. Scoped to the round's own table:
    // the room's running score is a second table of the same shape below it, whose
    // last column counts wins rather than cards.
    const counts = await host
      .locator('.standings:not(.standings--score) tbody tr td:last-child')
      .allTextContents();
    expect(counts.filter((value) => value.trim() === '0')).toHaveLength(1);
    await expect(host.getByText('Nothing is saved')).toBeVisible();

    // A new round needs everyone to agree.
    await host.getByRole('button', { name: 'Play again' }).click();
    await expect(host.getByText('1 of 2 agreed')).toBeVisible();
    await guest.getByRole('button', { name: 'Play again' }).click();

    await expectDealt(host);
    await expectDealt(guest);
  });
});
