// Flow 1: the first run. A new learner is sent to onboarding, lands on Today with the placement
// card, takes the placement check against the real rounds of the API, and comes back to Today.
import { expect, noSidewaysScroll, test } from '../src/fixtures';

test('first run: onboarding, placement, then Today', async ({ page, api }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome', level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/onboarding$/);
  await noSidewaysScroll(page);

  await page.getByLabel('What should we call you?').fill('Zuzka');
  await page.getByRole('radio', { name: '15 min' }).click();
  await expect(page.getByLabel('Time zone')).not.toHaveValue('');
  await page.getByRole('button', { name: 'Start learning' }).click();

  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
  await expect(page.getByText('Hello, Zuzka')).toBeVisible();
  const me = await api.call('profile.get');
  expect(me.body.displayName).toBe('Zuzka');
  expect(me.body.settings.onboardedAt).toEqual(expect.any(String));
  expect(me.body.placementDoneAt).toBeNull();

  await page.getByRole('link', { name: 'Start the placement check' }).click();
  await expect(page.getByRole('heading', { name: 'Placement check', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Start the check' }).click();
  const bar = page.getByRole('progressbar', { name: 'Progress of the placement check' });
  await expect(bar).toBeVisible();
  await noSidewaysScroll(page);

  // Answer whatever the API asks until the result shows: the first meaning of every word
  // (or "I don't know" for every third), and the cue's form, typed, in the case round.
  const result = page.getByTestId('placement-result');
  const lemma = page.getByTestId('placement-lemma');
  const sentence = page.getByTestId('placement-sentence');
  let answered = 0;
  for (let guard = 0; guard < 120; guard++) {
    await expect(result.or(lemma).or(sentence)).toBeVisible({ timeout: 30_000 });
    if (await result.isVisible()) break;
    if (await lemma.isVisible()) {
      const before = await lemma.textContent();
      const options = page.getByRole('group', { name: /^Meanings of / }).getByRole('button');
      await (answered % 3 === 2 ? options.last() : options.first()).click();
      answered++;
      // The next word, the next round, or the result.
      await expect(async () => {
        const visible = await lemma.isVisible();
        if (visible) expect(await lemma.textContent()).not.toBe(before);
      }).toPass({ timeout: 30_000 });
      continue;
    }
    const field = page.getByRole('textbox', { name: 'Your answer' });
    const before = await sentence.textContent();
    if (answered % 2 === 0) {
      await page.getByRole('button', { name: 'I don’t know' }).click();
    } else {
      const cue = page.locator('p', { hasText: 'Use the word:' }).locator('span[lang="sk"]');
      const typed = (await cue.textContent()) ?? '';
      await field.fill(typed.trim());
      await page.getByRole('button', { name: 'Next' }).click();
    }
    answered++;
    await expect(async () => {
      const visible = await sentence.isVisible();
      if (visible) expect(await sentence.textContent()).not.toBe(before);
    }).toPass({ timeout: 30_000 });
  }
  await expect(result).toBeVisible();
  expect(answered).toBeGreaterThan(3);
  await expect(result.getByText('Your starting point')).toBeVisible();
  await noSidewaysScroll(page);

  const done = await api.call('profile.get');
  expect(done.body.placementDoneAt).toEqual(expect.any(String));

  await page.getByRole('button', { name: 'Go to Today' }).click();
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('link', { name: 'Start the placement check' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();

  // A reload stays on Today: the server's profile now ends the first run.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Start the placement check' })).toHaveCount(0);
});
