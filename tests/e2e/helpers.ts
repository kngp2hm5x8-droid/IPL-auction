import { expect, type Page } from '@playwright/test';

export async function createRoom(page: Page, name: string): Promise<string> {
  await page.goto('/create');
  await page.locator('#host-name').fill(name);
  await page.getByRole('button', { name: 'Create room' }).click();
  await page.waitForURL(/\/room\/IPL-[A-Z0-9]{4}\/lobby/);
  return page.url().match(/IPL-[A-Z0-9]{4}/)![0];
}

export async function joinRoom(page: Page, code: string, name: string, franchise: string, short: string) {
  await page.goto(`/join/${code}`);
  await page.locator('#join-name').fill(name);
  await page.getByRole('radio', { name: new RegExp(franchise) }).click();
  await page.getByRole('button', { name: `Join as ${short}` }).click();
  await page.waitForURL(new RegExp(`/room/${code}`));
}

export async function confirm(page: Page, label: string) {
  await page.getByRole('dialog').getByRole('button', { name: label, exact: true }).click();
}

export async function noHorizontalScroll(page: Page) {
  const [scroll, width] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scroll, 'page must not scroll horizontally').toBeLessThanOrEqual(width + 1);
}
