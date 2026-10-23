/** Mobile viewport checks: key screens fit a phone and core actions are reachable by touch. */
import { expect, test } from '@playwright/test';
import { confirm, createRoom, joinRoom, noHorizontalScroll } from './helpers';

test('home, join, lobby and live auction fit a phone screen', async ({ browser, page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Run the auction/ })).toBeVisible();
  await noHorizontalScroll(page);

  // A host on another "device" sets up the room.
  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });
  const host = await hostCtx.newPage();
  const code = await createRoom(host, 'Desk Host');
  await host.getByTestId('slot-CSK').getByRole('button', { name: /Claim/ }).click();

  await joinRoom(page, code, 'Phone Pat', 'Rajasthan Royals', 'RR');
  await expect(page.getByTestId('slot-RR')).toContainText('Phone Pat');
  await noHorizontalScroll(page);

  await host.getByTestId('start-auction').click();
  await confirm(host, 'Start auction');
  await page.waitForURL(/\/auction$/);
  await noHorizontalScroll(page);
  // The bid button is pinned above the bottom tab bar and tappable.
  const bid = page.getByTestId('bid-button');
  await expect(bid).toBeInViewport();
  await expect(bid).toBeEnabled({ timeout: 10_000 });
  await bid.tap();
  await expect(page.getByTestId('leader')).toContainText('Rajasthan Royals');
  // Bottom navigation is present instead of the desktop tab row.
  await expect(page.getByRole('navigation', { name: 'Room sections' }).last()).toBeVisible();
  await hostCtx.close();
});
