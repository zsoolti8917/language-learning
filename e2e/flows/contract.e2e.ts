// The checks every flow relies on: the page's API answers are validated against the contracts
// (and a drifting answer would be caught), and the API runs with real ports only.
import { checkResponse, endpointOf } from '../src/contract';
import { API_URL, expect, onboard, test } from '../src/fixtures';

test('API answers seen by the page are checked against their contract', async ({
  page,
  api,
  watch,
}) => {
  await onboard(api);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
  await expect
    .poll(() => watch.checked.filter((c) => /^GET \/api\/v1\/(today|me) 200$/.test(c)).length)
    .toBeGreaterThanOrEqual(2);

  // The checker itself: a drifting body, a wrong status and a bad error shape are all caught.
  const today = await api.call('profile.today');
  expect(checkResponse('GET', '/api/v1/today', 200, 'application/json', today.text)).toEqual([]);
  const broken = { ...today.body, review: undefined };
  expect(
    checkResponse('GET', '/api/v1/today', 200, 'application/json', JSON.stringify(broken)),
  ).not.toEqual([]);
  expect(checkResponse('POST', '/api/v1/reports', 200, 'application/json', '{}')).not.toEqual([]);
  expect(
    checkResponse('GET', '/api/v1/notes/x', 404, 'application/json', '{"message":"no"}'),
  ).not.toEqual([]);
  expect(endpointOf('POST', '/api/v1/texts/abc/sentences/2/translation')?.name).toBe(
    'texts.translateSentence',
  );
  expect(endpointOf('GET', '/api/v1/me/export')?.name).toBe('profile.export');
});

test('the API answers a new learner from its real modules, not from contract examples', async ({
  playwright,
}) => {
  // GET /health needs no login and reports the versions.
  const ctx = await playwright.request.newContext({ baseURL: API_URL });
  const health = await ctx.get('/api/v1/health');
  expect(health.status()).toBe(200);
  const text = await health.text();
  expect(checkResponse('GET', '/api/v1/health', 200, 'application/json', text)).toEqual([]);
  // A stand in would answer with the contract example; the real profile module creates a
  // profile for this new learner instead.
  const id = '0193a1b2-c3d4-7e5f-8a6b-00000000e2e0';
  const me = await ctx.get('/api/v1/me', { headers: { authorization: `Bearer dev:${id}` } });
  expect(me.status()).toBe(200);
  expect(((await me.json()) as { userId: string }).userId).toBe(id);
  await ctx.dispose();
});
