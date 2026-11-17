// Smoke test against the real Claude API: one schema checked call and one streamed call.
// Spends real money (well under one cent). Not part of CI or the tests: run it by hand with
//
//   ANTHROPIC_API_KEY=… pnpm --filter @app/ai run smoke
//
// Without a key it prints a note and exits 0. The key is never printed.
import { z } from 'zod';
import { createAnthropicGateway } from './anthropic';
import { routeOverridesFromEnv } from './routes';
import type { UsageRow } from './types';

const USER = '00000000-0000-7000-8000-000000000000';

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    console.log('smoke: ANTHROPIC_API_KEY is not set, nothing to do.');
    return;
  }
  const rows: UsageRow[] = [];
  const gateway = createAnthropicGateway(
    {
      mode: 'anthropic',
      apiKey,
      dailyBudgetUsd: 1,
      spendToday: async () => ({
        spentUsd: rows.reduce((n, r) => n + r.costUsd, 0),
        resetsAt: new Date(Date.now() + 86_400_000).toISOString(),
      }),
      recordUsage: async (row) => {
        rows.push(row);
      },
    },
    { routes: routeOverridesFromEnv(process.env) },
  );

  const system = [
    {
      text: 'You translate one Slovak sentence into natural English. Answer with JSON only.',
      cache: true,
    },
  ];
  const translated = await gateway.structured({
    route: 'reader.translate',
    userId: USER,
    system,
    messages: [{ role: 'user', content: 'Bývam v meste.' }],
    schema: z.object({ en: z.string() }),
  });
  console.log('structured:', translated.data);

  process.stdout.write('stream: ');
  const replied = await gateway.stream({
    route: 'tutor.reply',
    userId: USER,
    system: [
      {
        text: 'You are a friendly Slovak tutor. Answer in one short Slovak sentence.',
        cache: true,
      },
    ],
    messages: [{ role: 'user', content: 'Ahoj, idem dnes do kina.' }],
    onText: (d) => process.stdout.write(d),
  });
  process.stdout.write('\n');
  if (!replied.text.trim()) throw new Error('the stream returned no text');

  for (const r of rows)
    console.log(
      `usage: ${r.route} ${r.model} ${r.status} in=${r.inputTokens} out=${r.outputTokens} ` +
        `cacheRead=${r.cacheReadTokens} cacheWrite=${r.cacheWriteTokens} ` +
        `$${r.costUsd.toFixed(6)} ${r.latencyMs}ms ${r.requestId ?? ''}`,
    );
}

main().catch((e: unknown) => {
  const err = e as { name?: string; code?: string; message?: string; details?: unknown };
  console.error('smoke failed:', err.name, err.code ?? '', err.message, err.details ?? '');
  process.exit(1);
});
