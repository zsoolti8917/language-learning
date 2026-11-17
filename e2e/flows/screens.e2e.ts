// Every screen of a learner with some history, on the real API: each loads without an error
// state, a console error, a 5xx answer or an answer outside its contract (the fixture checks the
// last three), and none scrolls sideways at 390 px.
import { expect, noSidewaysScroll, onboard, test, uuidv7 } from '../src/fixtures';

test('every screen loads for a learner with history', async ({ page, api }) => {
  await onboard(api, 'Peter');
  // Words to learn, a text with a capture, a finished lesson, a short conversation.
  const words = await api.call('words.list', { query: { band: 0, status: 'unknown', limit: 3 } });
  await api.call('words.triage', {
    body: { decisions: words.body.items.map((w) => ({ lemmaId: w.lemmaId, decision: 'learn' })) },
  });
  const textId = uuidv7();
  await api.call('texts.create', {
    body: { id: textId, title: 'Doma', body: 'Bývam v meste. Dnes idem do kina.' },
  });
  await expect
    .poll(async () => (await api.call('texts.get', { params: { id: textId } })).body.status)
    .toBe('ready');
  const notes = await api.call('notes.list', { query: { kind: 'word' } });
  const noteId = notes.body.items[0]?.id ?? '';
  const course = await api.call('declension.course');
  const lessonId = course.body.lessons[0]?.id ?? '';
  const lesson = await api.call('declension.lesson', { params: { id: lessonId } });
  const patternId =
    lesson.body.steps.flatMap((s) => s.exercises).find((e) => e.features.pattern)?.features
      .pattern ?? 'mesto';
  const conversationId = uuidv7();
  const scenarios = await api.call('tutor.scenarios');
  await api.call('tutor.startConversation', {
    body: { id: conversationId, scenarioId: scenarios.body.items[0]?.id ?? '' },
  });
  await api.raw('tutor.sendMessage', {
    params: { id: conversationId },
    body: { clientId: uuidv7(), content: 'Dnes idem do kina s kamarát.' },
  });

  const screens: [string, string][] = [
    ['/', 'Today'],
    ['/settings', 'Settings'],
    ['/settings/about', 'About'],
    ['/review', 'Review'],
    ['/deck', 'Deck'],
    [`/deck/${noteId}`, 'Note'],
    ['/words', 'Common words'],
    ['/words/band/0', 'Word band'],
    ['/lemma/20', 'Word'],
    ['/read', 'Library'],
    ['/read/import', 'Import a text'],
    [`/read/${textId}`, 'Reader'],
    ['/cases', 'Case course'],
    [`/cases/lesson/${lessonId}`, 'Lesson'],
    ['/cases/train', 'Trainer'],
    [`/cases/pattern/${patternId}`, 'Pattern'],
    ['/tutor', 'Tutor'],
    [`/tutor/${conversationId}`, 'Conversation'],
  ];
  for (const [path, title] of screens) {
    await test.step(path, async () => {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
      // Loading ends; no screen shows its error or not found state.
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
      await expect(
        page.getByText(/could not (load|be loaded)|does not exist|not found|went wrong/i),
      ).toHaveCount(0);
      await noSidewaysScroll(page);
    });
  }

  // Screens that show the history: the deck lists the notes, About the versions.
  await page.goto('/deck');
  await expect(page.getByRole('list', { name: 'Deck' }).getByRole('link')).toHaveCount(
    notes.body.items.length,
  );
  await page.goto('/settings/about');
  const health = await (await page.request.get('/api/v1/health')).json();
  await expect(page.getByText(health.contentVersion)).toBeVisible();
  await page.goto(`/tutor/${conversationId}`);
  await expect(page.getByRole('list', { name: 'Messages' }).locator('li[data-role]')).toHaveCount(3);
});
