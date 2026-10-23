/**
 * Core acceptance journey with two independent users (separate browser contexts =
 * separate anonymous Firebase identities, like two devices).
 */
import { expect, test } from '@playwright/test';
import { confirm, createRoom, joinRoom } from './helpers';

test('create → join → auction → XI → season → champion, with refresh in between', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  // 1–2. Host creates a room; guest joins on "another device" and claims Mumbai Indians.
  const code = await createRoom(host, 'Host Hari');
  await host.getByTestId('slot-CSK').getByRole('button', { name: /Claim/ }).click();
  await expect(host.getByTestId('slot-CSK')).toContainText('Host Hari');
  await joinRoom(guest, code, 'Bina', 'Mumbai Indians', 'MI');

  // 3–5. Both see the same synchronized lobby.
  await expect(host.getByTestId('slot-MI')).toContainText('Bina');
  await expect(guest.getByTestId('slot-CSK')).toContainText('Host Hari');
  // A franchise owned by someone else cannot be claimed.
  await expect(guest.getByTestId('slot-CSK').getByRole('button', { name: /Claim|Switch/ })).toHaveCount(0);

  // 6–7. Host starts the auction; the current player appears on every screen.
  await host.getByTestId('start-auction').click();
  await confirm(host, 'Start auction');
  await guest.waitForURL(/\/auction$/);
  await host.waitForURL(/\/auction$/);
  const player = (await host.getByTestId('lot-player').textContent())!;
  await expect(guest.getByTestId('lot-player')).toHaveText(player);

  // Spectator-only controls: the guest has no auctioneer buttons.
  await expect(guest.getByTestId('sold-button')).toHaveCount(0);

  // 8–9. Guest bids; every device shows MI leading at the same price.
  const bid = guest.getByTestId('bid-button');
  await expect(bid).toBeEnabled({ timeout: 10_000 });
  await bid.click();
  await expect(host.getByTestId('leader')).toContainText('Mumbai Indians');
  const price = await host.getByTestId('current-bid').innerText();
  await expect(guest.getByTestId('current-bid')).toHaveText(price);
  await expect(guest.getByTestId('bid-button')).toBeDisabled(); // cannot outbid yourself

  // 11–13. Auctioneer sells; player lands in MI's squad and exactly the price is deducted.
  await host.getByTestId('sold-button').click();
  await expect(host.getByTestId('purse-MI')).not.toHaveText('₹120 Cr');
  const purse = await host.getByTestId('purse-MI').innerText();
  await expect(guest.getByTestId('purse-MI')).toHaveText(purse);
  await expect(host.getByTestId('purse-CSK')).toHaveText('₹120 Cr');

  // 14. The next player appears.
  await expect(host.getByTestId('lot-player')).not.toHaveText(player);

  // 20 (part). A refresh does not lose the room, role or franchise.
  await guest.reload();
  await expect(guest.getByTestId('bid-button')).toBeVisible();
  await expect(guest.getByTestId('purse-MI')).toHaveText(purse);

  // 15. Close the auction (supplementary draft completes the squads).
  await host.getByRole('button', { name: 'End auction early…' }).click();
  await confirm(host, 'End auction');
  await expect(host.getByRole('heading', { name: 'Auction complete' })).toBeVisible();

  // The purchased player is in MI's squad.
  await guest.goto(`/room/${code}/squad/MI`);
  await expect(guest.getByText(player, { exact: true })).toBeVisible();

  // 16. Guest builds and locks a valid Playing XI.
  await guest.goto(`/room/${code}/xi`);
  await guest.getByRole('button', { name: 'Auto-pick' }).click();
  await expect(guest.getByText('11/11 players')).toBeVisible();
  await guest.getByTestId('lock-xi').click();
  await confirm(guest, 'Lock XI');
  await expect(guest.getByText('Locked', { exact: true })).toBeVisible();

  // 17–19. Season: fixtures generated, matches simulated, table and playoffs update.
  await host.goto(`/room/${code}/tournament`);
  await host.getByTestId('start-season').click();
  await confirm(host, 'Start season');
  await host.getByTestId('play-next').click();
  await host.waitForURL(/\/match\/L01$/);
  await host.getByTestId('skip').click();
  await expect(host.getByTestId('match-result')).toBeVisible();
  await host.goto(`/room/${code}/tournament`);
  await host.getByRole('tab', { name: 'Points table' }).click();
  await expect(host.getByTestId('row-MI').locator('td').nth(2)).toHaveText('1'); // played 1
  await expect(host.getByTestId('row-CSK').locator('td').nth(2)).toHaveText('1');
  await expect(host.getByRole('tab', { name: 'Playoffs' })).toBeVisible();
  await host.getByRole('button', { name: 'Sim to the end' }).click();
  await expect(host.getByTestId('champion')).toBeVisible({ timeout: 30_000 });

  // 20. A fresh visit restores the completed season for the guest too.
  await guest.goto(`/room/${code}`);
  await expect(guest.getByTestId('champion')).toBeVisible();

  await hostCtx.close();
  await guestCtx.close();
});
