// The tutor's main flow at 390 x 844 against the scripted mock stream (../mocks.ts): one error
// fixed by the learner, one corrected by the tutor, a summary with one card. Also the retry, the
// view that follows a long reply, and no sideways scroll or console error anywhere.
import { expect, type Locator, type Page, test } from '@playwright/test';
import { en } from '../../../messages/en';
import { m } from '../messages';

const DEV_USER = '0193a1b2-c3d4-7e5f-8a6b-000000000001';
const DEV_SESSION = {
  userId: DEV_USER,
  email: 'dev@example.test',
  accessToken: `dev:${DEV_USER}`,
  expiresAt: null,
};

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

async function noSidewaysScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(clientWidth).toBe(390);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

/** Signs in, picks the first scenario and lands in its chat. */
async function startChat(page: Page) {
  await page.addInitScript((s) => {
    localStorage.setItem('app.devSession', JSON.stringify(s));
  }, DEV_SESSION);
  await page.goto('/tutor');
  await expect(page.getByRole('heading', { name: en.screens.scenarios, level: 1 })).toBeVisible();
  await noSidewaysScroll(page);
  const card = page.locator('[data-scenario="scn-city-walk"]');
  await card.getByRole('button', { name: m.t('scenarios.start') }).click();
  await expect(page.getByRole('heading', { name: en.screens.chat, level: 1 })).toBeVisible();
  await expect(page.getByText('Ideš dnes do mesta?')).toBeVisible();
}

const field = (page: Page) => page.getByRole('textbox', { name: m.t('composer.label') });
const list = (page: Page) => page.getByRole('list', { name: m.t('chat.messagesLabel') });

async function send(page: Page, text: string) {
  await field(page).fill(text);
  await field(page).press('Enter');
}

/** The tutor reply with this text, once `done` has settled it. */
function reply(page: Page, text: string): Locator {
  return list(page).locator('li[data-role="tutor"][data-state="sent"]', { hasText: text });
}

test('a scenario with one error fixed, one corrected, and a summary with one card', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await startChat(page);

  // The composer sits above the tab bar; its controls are big enough to tap.
  const nav = page.getByRole('navigation', { name: en.tabs.label });
  const sendButton = page.getByRole('button', { name: m.t('composer.send') });
  const navBox = await nav.boundingBox();
  const sendBox = await sendButton.boundingBox();
  expect(navBox && sendBox).toBeTruthy();
  if (navBox && sendBox) {
    expect(sendBox.y + sendBox.height).toBeLessThanOrEqual(navBox.y);
    expect(sendBox.height).toBeGreaterThanOrEqual(44);
  }

  // 1. Typed with the accent bar: "kamarát" is prompted, its answer is not shown.
  await field(page).click();
  await page.keyboard.type('Dnes idem do kina s kamar');
  await page
    .getByRole('toolbar', { name: m.t('composer.accentBar') })
    .getByRole('button', { name: 'á', exact: true })
    .click();
  await page.keyboard.type('t.');
  await expect(field(page)).toHaveValue('Dnes idem do kina s kamarát.');
  await field(page).press('Enter');
  await expect(reply(page, 'S kým ideš do kina?')).toBeVisible();
  const kamarat = list(page).locator('[data-mark][data-error-id$="e001"]');
  await expect(kamarat).toHaveText('kamarát');
  await expect(kamarat).toHaveAttribute('data-mark', 'prompted');
  await expect(page.getByText(m.t('marks.prompted', { given: 'kamarát' }))).toBeVisible();
  await expect(list(page).getByText('kamarátom')).toHaveCount(0);

  // 2. The learner fixes it; "mesto" is the next prompted error; both criteria are met.
  await send(page, 'Idem s kamarátom. Potom ideme do mesto.');
  await expect(reply(page, 'Výborne, s kamarátom!')).toBeVisible();
  await expect(kamarat).toHaveAttribute('data-mark', 'self_corrected');
  await expect(page.getByText(m.t('marks.selfCorrected', { given: 'kamarát' }))).toBeVisible();
  const mesto = list(page).locator('[data-mark][data-error-id$="e002"]');
  await expect(mesto).toHaveText('mesto');
  await expect(mesto).toHaveAttribute('data-mark', 'prompted');
  await expect(page.locator('[data-criterion][data-met="true"]')).toHaveCount(2);

  // 3. The learner misses again: the tutor corrects it and a card is added.
  await send(page, 'Do mesto.');
  await expect(reply(page, 'Aha, idete do mesta.')).toBeVisible();
  await expect(mesto).toHaveAttribute('data-mark', 'corrected');
  await expect(
    page.getByText(m.t('marks.corrected', { given: 'mesto', expected: 'mesta' })),
  ).toBeVisible();
  await expect(page.locator('[data-card-chip]')).toHaveCount(1);
  await noSidewaysScroll(page);

  // 4. The end summary shows one card and leads to the review.
  await page.getByRole('button', { name: m.t('chat.end'), exact: true }).click();
  const summary = page.getByRole('region', { name: m.t('summary.title') });
  await expect(summary).toBeVisible();
  await expect(summary.getByText(m.t('summary.cardsOne'))).toBeVisible();
  await expect(summary.locator('[data-correction]')).toHaveCount(2);
  await expect(summary.getByRole('link', { name: m.t('summary.toReview') })).toHaveAttribute(
    'href',
    '/review',
  );
  await noSidewaysScroll(page);
  expect(errors).toEqual([]);
});

test('a failed reply is sent again with the same client id and shown once', async ({ page }) => {
  const errors = watchErrors(page);
  const clientIds: string[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/messages')) {
      clientIds.push((req.postDataJSON() as { clientId: string }).clientId);
    }
  });
  await startChat(page);
  await send(page, 'To je chyba.');
  const alert = page.getByRole('alert').filter({ hasText: m.t('turn.failed') });
  await expect(alert).toBeVisible();
  await alert.getByRole('button', { name: m.t('turn.retry') }).click();
  await expect(reply(page, 'S kým ideš do kina?')).toBeVisible();
  await expect(alert).toHaveCount(0);
  await expect(list(page).locator('li[data-role="learner"]')).toHaveCount(1);
  expect(clientIds).toHaveLength(2);
  expect(clientIds[1]).toBe(clientIds[0]);
  expect(errors).toEqual([]);
});

async function scrollState(list: Locator) {
  return list.evaluate((el) => ({
    top: el.scrollTop,
    gap: el.scrollHeight - el.scrollTop - el.clientHeight,
    height: el.scrollHeight,
  }));
}

test('a long reply keeps the view at the bottom', async ({ page }) => {
  await startChat(page);
  await send(page, 'Rozprávaj dlho.');
  const streaming = list(page).locator('li[data-role="tutor"][data-state="streaming"]');
  await expect(streaming).toBeVisible();
  // While it streams, and after, the list stays at its bottom.
  let grew = false;
  let last = 0;
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(150);
    const s = await scrollState(list(page));
    expect(s.gap).toBeLessThanOrEqual(48);
    if (last && s.height > last) grew = true;
    last = s.height;
  }
  expect(grew).toBe(true);
  await expect(reply(page, 'Veta číslo 24')).toBeVisible();
  expect((await scrollState(list(page))).gap).toBeLessThanOrEqual(48);
});

test('a long reply leaves the view alone once the learner scrolled up', async ({ page }) => {
  await startChat(page);
  await send(page, 'Rozprávaj dlho.');
  const streaming = list(page).locator('li[data-role="tutor"][data-state="streaming"]');
  await expect(streaming).toBeVisible();
  await page.waitForTimeout(200);
  await list(page).evaluate((el) => {
    el.scrollTop = 0;
    el.dispatchEvent(new Event('scroll'));
  });
  await expect(reply(page, 'Veta číslo 24')).toBeVisible();
  const s = await scrollState(list(page));
  expect(s.top).toBe(0);
  expect(s.gap).toBeGreaterThan(48);
});
