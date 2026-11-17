// Flow 6: sorting common words. The learner opens the first band, sorts 25 new words one at a
// time (Known, Learn, Ignore, a swipe, an undo), the decisions go out in batches of 20, and
// the API's statuses, counts and new cards follow every decision.
import { expect, noSidewaysScroll, onboard, test } from '../src/fixtures';

test('sorting common words', async ({ page, api }) => {
  await onboard(api);
  const bands = (await api.call('words.bands')).body.bands;
  const band = bands[0];
  expect(band?.unknown).toBeGreaterThan(25);
  const from = band?.fromRank ?? 0;
  const to = band?.toRank ?? 0;
  const total = band?.unknown ?? 0;

  const batches: { lemmaId: number; decision: string }[][] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/api/v1/words/triage'))
      batches.push((req.postDataJSON() as { decisions: (typeof batches)[number] }).decisions);
  });

  await page.goto('/words');
  await expect(page.getByRole('heading', { name: 'Common words', level: 1 })).toBeVisible();
  await expect(
    page.getByRole('progressbar', { name: `Known in words ${from}–${to}` }),
  ).toBeVisible();
  await noSidewaysScroll(page);
  await page.getByRole('link', { name: new RegExp(`Words ${from}–${to}`) }).click();
  await expect(page.getByRole('heading', { name: 'Word band', level: 1 })).toBeVisible();
  await expect(page.getByRole('tabpanel').getByRole('link').first()).toBeVisible();

  await page.getByRole('button', { name: 'Sort new words' }).click();
  await expect(page.getByText(`0 of ${total}`)).toBeVisible();
  await page.getByRole('button', { name: 'Show meaning' }).click();
  await expect(page.getByTestId('sort-gloss')).toBeVisible();
  await noSidewaysScroll(page);

  const choices = ['Known', 'Learn', 'Ignore'];
  for (let i = 0; i < 24; i++) {
    await page.getByRole('button', { name: choices[i % 3], exact: true }).click();
    await expect(page.getByText(`${i + 1} of ${total}`)).toBeVisible();
  }
  // A swipe to the right decides Known for the 25th word.
  const card = page.getByTestId('sort-card');
  const box = await card.boundingBox();
  if (!box) throw new Error('no card');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 60, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, y + 4, { steps: 4 });
  await page.mouse.move(box.x + 220, y + 6, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByText(`25 of ${total}`)).toBeVisible();
  await expect.poll(() => batches.map((b) => b.length)).toEqual([20]);

  // Undo, then Learn instead.
  const shown = await page.getByTestId('sort-lemma').textContent();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText(`24 of ${total}`)).toBeVisible();
  await expect(page.getByTestId('sort-lemma')).not.toHaveText(shown ?? '');
  await page.getByRole('button', { name: 'Learn', exact: true }).click();
  await expect(page.getByText(`25 of ${total}`)).toBeVisible();

  const last = page.waitForResponse((r) => r.url().endsWith('/api/v1/words/triage'));
  await page.getByRole('button', { name: 'Finish' }).click();
  expect((await last).status()).toBe(200);
  await expect.poll(() => batches.map((b) => b.length)).toEqual([20, 5]);
  await expect(page.getByRole('button', { name: 'Sort new words' })).toBeVisible();

  // The server holds every decision.
  const decisions = batches.flat();
  const count = (d: string) => decisions.filter((x) => x.decision === d).length;
  expect(decisions.at(-1)?.decision).toBe('learn');
  const after = (await api.call('words.bands')).body.bands[0];
  expect(after?.known).toBe((band?.known ?? 0) + count('known'));
  expect(after?.learning).toBe((band?.learning ?? 0) + count('learn'));
  expect(after?.unknown).toBe(total - 25);
  for (const d of decisions.slice(0, 6)) {
    const lemma = await api.call('lemmas.get', { params: { id: d.lemmaId } });
    const status = { known: 'known', learn: 'learning', ignored: 'ignored' }[d.decision];
    expect(lemma.body.status).toBe(status);
    expect(lemma.body.noteId !== null).toBe(d.decision === 'learn');
  }
  const words = await api.call('notes.list', { query: { kind: 'word' } });
  expect(words.body.items).toHaveLength(count('learn'));

  // The band's new list shrank by the 25 sorted words.
  await page.getByRole('tab', { name: 'New' }).click();
  await expect(page.getByRole('tabpanel').getByRole('link')).toHaveCount(Math.min(total - 25, 50));
  await noSidewaysScroll(page);
});
