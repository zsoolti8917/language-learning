import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { existsSync, listFiles } from '../lib/files';
import { type BatchClient, MockBatchClient, type MockReply } from './client';
import { GLOSS_GROUP_SIZE, type GlossRequest, glossesTask } from './prompts/content-glosses';
import {
  type BatchJob,
  type BatchTask,
  buildRequest,
  DEFAULT_MODEL,
  OFFLINE_MODEL,
  type OfflineRequest,
  offlinePath,
  requestHash,
  runBatch,
  SpendLimitError,
} from './runner';

interface In {
  word: string;
}
const Out = z.object({ word: z.string(), gloss: z.string().min(1) });
type Out = z.infer<typeof Out>;

const task: BatchTask<In, Out> = {
  route: 'test.route',
  promptVersion: 1,
  maxTokens: 500,
  system: 'Gloss the word.',
  schema: Out,
  user: (i) => i.word,
  check: (i, o) => (o.word === i.word ? [] : [`answered "${o.word}" for "${i.word}"`]),
  estimateOutputTokens: () => 50,
};

const jobs = (...words: string[]): BatchJob<In>[] =>
  words.map((w) => ({ id: w, input: { word: w } }));
const wordOf = (params: { messages: { content: unknown }[] }) =>
  String(params.messages[0]?.content);
const good = (params: { messages: { content: unknown }[] }): MockReply => ({
  json: { word: wordOf(params), gloss: `gloss of ${wordOf(params)}` },
});

let cacheDir: string;
beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'runner-'));
});
afterEach(() => rm(cacheDir, { recursive: true, force: true }));

describe('requests', () => {
  it('builds one Messages request with the cached system prompt and the JSON schema', () => {
    const p = buildRequest(task, { word: 'mesto' });
    expect(p.model).toBe(DEFAULT_MODEL);
    expect(p.model).toBe('claude-opus-5-5');
    expect(p.max_tokens).toBe(500);
    expect(p.system).toEqual([
      { type: 'text', text: 'Gloss the word.', cache_control: { type: 'ephemeral' } },
    ]);
    expect(p.messages).toEqual([{ role: 'user', content: 'mesto' }]);
    expect(p.output_config?.effort).toBe('low');
    expect(p.output_config?.format?.type).toBe('json_schema');
    expect(p.output_config?.format?.schema).toMatchObject({ type: 'object' });
    // Opus 5.5 rejects disabled thinking and budgets; the runner leaves thinking alone.
    expect('thinking' in p).toBe(false);
    expect('temperature' in p).toBe(false);
  });

  it('hashes requests by content, so any prompt or schema change is a new request', () => {
    const a = requestHash(buildRequest(task, { word: 'mesto' }));
    expect(requestHash(buildRequest(task, { word: 'mesto' }))).toBe(a);
    expect(requestHash(buildRequest(task, { word: 'žena' }))).not.toBe(a);
    expect(requestHash(buildRequest({ ...task, system: 'Other.' }, { word: 'mesto' }))).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/u);
  });
});

describe('mock mode', () => {
  it('sends each request once, caches valid answers, and sends nothing for cached ones', async () => {
    const client = new MockBatchClient(good);
    const first = await runBatch(task, jobs('mesto', 'žena'), { mode: 'mock', cacheDir, client });
    expect(first.sent).toBe(2);
    expect(first.results.map((r) => r.output.gloss).sort()).toEqual([
      'gloss of mesto',
      'gloss of žena',
    ]);
    expect(first.failures).toEqual([]);
    expect(client.created).toHaveLength(1);

    const second = await runBatch(task, jobs('mesto', 'žena', 'dom'), {
      mode: 'mock',
      cacheDir,
      client,
    });
    expect(second.cached).toBe(2);
    expect(second.sent).toBe(1);
    expect(client.created).toHaveLength(2);
    expect(client.created[1]?.map((r) => wordOf(r.params))).toEqual(['dom']);
    expect(second.results.find((r) => r.id === 'mesto')).toMatchObject({ cached: true });

    const third = await runBatch(task, jobs('dom', 'mesto'), { mode: 'mock', cacheDir, client });
    expect(third.sent).toBe(0);
    expect(client.created).toHaveLength(2);
    expect(third.results).toHaveLength(2);
  });

  it('rejects and reports an answer that breaks the schema, and does not cache it', async () => {
    let broken = true;
    const client = new MockBatchClient((params) =>
      wordOf(params) === 'žena' && broken ? { json: { word: 'žena', gloss: 42 } } : good(params),
    );
    const r = await runBatch(task, jobs('mesto', 'žena'), { mode: 'mock', cacheDir, client });
    expect(r.results.map((x) => x.id)).toEqual(['mesto']);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toMatchObject({ id: 'žena' });
    expect(r.failures[0]?.reason).toMatch(/^schema: gloss: /u);

    broken = false;
    const again = await runBatch(task, jobs('mesto', 'žena'), { mode: 'mock', cacheDir, client });
    expect(again.cached).toBe(1);
    expect(again.sent).toBe(1);
    expect(again.failures).toEqual([]);
  });

  it('rejects answers that fail the task check, are not JSON, are cut off, refused or errored', async () => {
    const replies: Record<string, MockReply> = {
      a: { json: { word: 'other', gloss: 'x' } },
      b: { text: 'not json' },
      c: { json: { word: 'c', gloss: 'x' }, stopReason: 'max_tokens' },
      d: { json: { word: 'd', gloss: 'x' }, stopReason: 'refusal' },
      e: { error: 'overloaded' },
      f: { expired: true },
    };
    const client = new MockBatchClient((params) => replies[wordOf(params)] as MockReply);
    const r = await runBatch(task, jobs(...Object.keys(replies)), {
      mode: 'mock',
      cacheDir,
      client,
    });
    const reasons = Object.fromEntries(r.failures.map((f) => [f.id, f.reason]));
    expect(reasons).toEqual({
      a: 'check: answered "other" for "a"',
      b: 'answer is not JSON',
      c: 'cut off at max_tokens',
      d: 'refused',
      e: 'errored: overloaded',
      f: 'expired',
    });
    expect(r.results).toEqual([]);
    expect(await listFiles(join(cacheDir, 'test.route'))).toEqual([]);
  });

  it('sends identical jobs as one request', async () => {
    const client = new MockBatchClient(good);
    const r = await runBatch(
      task,
      [
        { id: 'one', input: { word: 'mesto' } },
        { id: 'two', input: { word: 'mesto' } },
      ],
      { mode: 'mock', cacheDir, client },
    );
    expect(r.requests).toBe(1);
    expect(client.sent).toHaveLength(1);
    expect(r.results.map((x) => x.id).sort()).toEqual(['one', 'two']);
  });

  it('answers from task.mock when no client is given', async () => {
    const words = Array.from({ length: GLOSS_GROUP_SIZE + 3 }, (_, i) => ({
      key: `w${i}|noun|f|1`,
      lemma: `w${i}`,
      pos: 'noun',
    }));
    const groups: BatchJob<GlossRequest>[] = [
      { id: 'g0', input: { words: words.slice(0, GLOSS_GROUP_SIZE) } },
      { id: 'g1', input: { words: words.slice(GLOSS_GROUP_SIZE) } },
    ];
    const r = await runBatch(glossesTask, groups, { mode: 'mock', cacheDir });
    expect(r.failures).toEqual([]);
    expect(r.results.flatMap((x) => x.output.items)).toHaveLength(words.length);
  });
});

describe('safety switches', () => {
  const never: BatchClient = {
    create: () => {
      throw new Error('must not send');
    },
    retrieve: () => {
      throw new Error('must not poll');
    },
    results: () => {
      throw new Error('must not read');
    },
  };

  it('dry run counts requests and estimates the cost without sending', async () => {
    const logs: string[] = [];
    const r = await runBatch(task, jobs('mesto', 'žena', 'dom'), {
      mode: 'dry-run',
      cacheDir,
      client: never,
      log: (m) => logs.push(m),
    });
    expect(r.sent).toBe(0);
    expect(r.estimate.requests).toBe(3);
    expect(r.estimate.outputTokens).toBe(150);
    expect(r.estimate.inputTokens).toBeGreaterThan(3 * 400);
    expect(r.estimate.usd).toBeGreaterThan(0);
    expect(r.estimate.worstUsd).toBeGreaterThan(r.estimate.usd);
    expect(logs.join('\n')).toMatch(
      /3 requests for 3 jobs, 0 cached, 3 to send; estimate .* \$0\.\d+ at batch prices/u,
    );
    expect(logs.join('\n')).toMatch(/dry run, nothing sent/u);
    expect(existsSync(join(cacheDir, 'test.route'))).toBe(false);
  });

  it('dry run leaves cached requests out of the estimate', async () => {
    // A live run, with the API played by the scripted client.
    await runBatch(task, jobs('mesto'), {
      mode: 'live',
      cacheDir,
      client: new MockBatchClient(good),
    });
    const r = await runBatch(task, jobs('mesto', 'žena'), {
      mode: 'dry-run',
      cacheDir,
      client: never,
    });
    expect(r.cached).toBe(1);
    expect(r.estimate.requests).toBe(1);
    expect(r.results).toHaveLength(1);
  });

  it('never lets a mock answer stand in for a real one', async () => {
    await runBatch(task, jobs('mesto'), {
      mode: 'mock',
      cacheDir,
      client: new MockBatchClient(good),
    });
    const dry = await runBatch(task, jobs('mesto'), { mode: 'dry-run', cacheDir, client: never });
    expect(dry.cached).toBe(0);
    const live = new MockBatchClient(good);
    const r = await runBatch(task, jobs('mesto'), { mode: 'live', cacheDir, client: live });
    expect(r.sent).toBe(1);
    expect(r.results[0]?.cached).toBe(false);
  });

  it('refuses a live run estimated above $5 unless a higher limit is given', async () => {
    const big: BatchTask<In, Out> = { ...task, estimateOutputTokens: () => 100_000 };
    const many = jobs(...Array.from({ length: 10 }, (_, i) => `w${i}`));
    // 10 × 100,000 output tokens × $20 / M × 0.5 = $10.
    await expect(
      runBatch(big, many, { mode: 'live', cacheDir, client: never }),
    ).rejects.toBeInstanceOf(SpendLimitError);
    await expect(
      runBatch(big, many, { mode: 'live', cacheDir, client: never, maxSpendUsd: 9 }),
    ).rejects.toThrow(/above the limit \$9\.00/u);
    const client = new MockBatchClient(good);
    const r = await runBatch(big, many, { mode: 'live', cacheDir, client, maxSpendUsd: 20 });
    expect(r.sent).toBe(10);
  });

  it('collects a batch left by an interrupted run instead of sending it again', async () => {
    const inner = new MockBatchClient(good);
    let crash = true;
    const flaky: BatchClient = {
      create: (r) => inner.create(r),
      retrieve: (id) => {
        if (crash) throw new Error('connection lost');
        return inner.retrieve(id);
      },
      results: (id) => inner.results(id),
    };
    await expect(
      runBatch(task, jobs('mesto', 'žena'), { mode: 'mock', cacheDir, client: flaky }),
    ).rejects.toThrow('connection lost');
    expect(await readdir(join(cacheDir, 'test.route', 'pending'))).toHaveLength(1);
    crash = false;
    const r = await runBatch(task, jobs('mesto', 'žena'), {
      mode: 'mock',
      cacheDir,
      client: flaky,
    });
    expect(inner.created).toHaveLength(1);
    expect(r.sent).toBe(0);
    expect(r.results).toHaveLength(2);
    expect(await readdir(join(cacheDir, 'test.route', 'pending'))).toEqual([]);
  });

  it('splits large runs into several batches', async () => {
    const client = new MockBatchClient(good);
    const r = await runBatch(task, jobs('a', 'b', 'c', 'd', 'e'), {
      mode: 'mock',
      cacheDir,
      client,
      maxPerBatch: 2,
    });
    expect(client.created.map((b) => b.length)).toEqual([2, 2, 1]);
    expect(r.batchIds).toHaveLength(3);
  });
});

describe('offline mode', () => {
  const never: BatchClient = {
    create: () => {
      throw new Error('must not send');
    },
    retrieve: () => {
      throw new Error('must not poll');
    },
    results: () => {
      throw new Error('must not read');
    },
  };
  const hashOf = (word: string) => requestHash(buildRequest(task, { word }));
  const offline = () => ({
    mode: 'offline' as const,
    cacheDir,
    client: never,
    requestsDir: join(cacheDir, 'requests'),
    answersDir: join(cacheDir, 'answers'),
  });
  const answer = async (word: string, value: unknown) => {
    const path = offlinePath(join(cacheDir, 'answers'), task.route, hashOf(word));
    await mkdir(join(cacheDir, 'answers', task.route), { recursive: true });
    await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value));
  };
  const requestFiles = async () =>
    existsSync(join(cacheDir, 'requests', task.route))
      ? (await readdir(join(cacheDir, 'requests', task.route))).sort()
      : [];

  it('writes every open request as a file and sends nothing', async () => {
    const logs: string[] = [];
    const r = await runBatch(task, jobs('mesto', 'žena'), {
      ...offline(),
      log: (m) => logs.push(m),
    });
    expect(r.sent).toBe(0);
    expect(r.results).toEqual([]);
    expect(r.open.sort()).toEqual([hashOf('mesto'), hashOf('žena')].sort());
    expect(r.failures.map((f) => f.reason)).toEqual(['no answer yet', 'no answer yet']);
    expect(await requestFiles()).toEqual(
      [`${hashOf('mesto')}.json`, `${hashOf('žena')}.json`].sort(),
    );
    const request = JSON.parse(
      await readFile(offlinePath(join(cacheDir, 'requests'), task.route, hashOf('mesto')), 'utf8'),
    ) as OfflineRequest;
    expect(request).toMatchObject({
      hash: hashOf('mesto'),
      route: 'test.route',
      promptVersion: 1,
      jobs: ['mesto'],
      system: 'Gloss the word.',
      user: 'mesto',
    });
    expect(request.schema).toMatchObject({ type: 'object' });
    expect(logs.join('\n')).toMatch(/2 requests open/u);
    expect(logs.join('\n')).toMatch(/nothing sent/u);
  });

  it('accepts a valid answer file, records who wrote it and closes the request', async () => {
    await runBatch(task, jobs('mesto', 'žena'), offline());
    await answer('mesto', { word: 'mesto', gloss: 'town' });
    const r = await runBatch(task, jobs('mesto', 'žena'), {
      ...offline(),
      answeredBy: 'a-writer',
    });
    expect(r.results).toHaveLength(1);
    expect(r.results[0]).toMatchObject({
      id: 'mesto',
      output: { word: 'mesto', gloss: 'town' },
      cached: false,
      model: 'a-writer',
    });
    expect(r.open).toEqual([hashOf('žena')]);
    expect(await requestFiles()).toEqual([`${hashOf('žena')}.json`]);

    // The answer is in the cache now: the file may go, and every mode reads it back.
    await rm(join(cacheDir, 'answers'), { recursive: true });
    const again = await runBatch(task, jobs('mesto'), offline());
    expect(again.cached).toBe(1);
    expect(again.results[0]).toMatchObject({ cached: true, model: 'a-writer' });
    const dry = await runBatch(task, jobs('mesto'), { mode: 'dry-run', cacheDir, client: never });
    expect(dry.cached).toBe(1);
    expect(dry.estimate.requests).toBe(0);
    expect(dry.results[0]?.model).toBe('a-writer');
  });

  it('names the default writer when none is given', async () => {
    await answer('mesto', { word: 'mesto', gloss: 'town' });
    const r = await runBatch(task, jobs('mesto'), offline());
    expect(r.results[0]?.model).toBe(OFFLINE_MODEL);
  });

  it('refuses an answer that is not JSON, breaks the schema or fails the check, and keeps it open', async () => {
    await answer('mesto', '{ not json');
    await answer('žena', { word: 'žena', gloss: 42 });
    await answer('dom', { word: 'strom', gloss: 'tree' });
    const logs: string[] = [];
    const r = await runBatch(task, jobs('mesto', 'žena', 'dom'), {
      ...offline(),
      log: (m) => logs.push(m),
    });
    expect(r.results).toEqual([]);
    expect(r.open).toHaveLength(3);
    const reasons = new Map(r.failures.map((f) => [f.id, f.reason]));
    expect(reasons.get('mesto')).toBe('answer is not JSON');
    expect(reasons.get('žena')).toMatch(/^schema: gloss/u);
    expect(reasons.get('dom')).toBe('check: answered "strom" for "dom"');
    expect(await requestFiles()).toHaveLength(3);
    expect(await listFiles(join(cacheDir, task.route))).toEqual([]);
    expect(logs.join('\n')).toMatch(/rejected dom: check/u);
  });

  it('removes the request files of jobs that are no longer asked', async () => {
    await runBatch(task, jobs('mesto', 'žena'), offline());
    await runBatch(task, jobs('žena', 'dom'), offline());
    expect(await requestFiles()).toEqual(
      [`${hashOf('dom')}.json`, `${hashOf('žena')}.json`].sort(),
    );
  });

  it('needs the two folders', async () => {
    await expect(
      runBatch(task, jobs('mesto'), { mode: 'offline', cacheDir, client: never }),
    ).rejects.toThrow(/requestsDir and answersDir/u);
  });
});

describe('content.glosses', () => {
  it('checks that every word is answered once', () => {
    const input: GlossRequest = {
      words: [
        { key: 'mesto|noun|n|1', lemma: 'mesto', pos: 'noun' },
        { key: 'žena|noun|f|1', lemma: 'žena', pos: 'noun' },
      ],
    };
    expect(
      glossesTask.check?.(input, { items: [{ key: 'mesto|noun|n|1', glosses: ['town'] }] }),
    ).toEqual(['key "žena|noun|f|1" not answered']);
    expect(
      glossesTask.check?.(input, {
        items: [
          { key: 'mesto|noun|n|1', glosses: ['town'] },
          { key: 'mesto|noun|n|1', glosses: ['city'] },
          { key: 'x', glosses: ['x'] },
          { key: 'žena|noun|f|1', glosses: ['woman'] },
        ],
      }),
    ).toEqual(['key "mesto|noun|n|1" answered twice', 'unknown key "x"']);
    expect(glossesTask.schema.safeParse({ items: [{ key: 'k', glosses: [] }] }).success).toBe(
      false,
    );
    expect(
      glossesTask.schema.safeParse({ items: [{ key: 'k', glosses: ['a', 'b', 'c', 'd'] }] })
        .success,
    ).toBe(false);
  });

  it('sends the words as JSON with their forms', () => {
    const p = buildRequest(glossesTask, {
      words: [
        { key: 'mesto|noun|n|1', lemma: 'mesto', pos: 'noun', gender: 'n', forms: ['meste'] },
      ],
    });
    expect(JSON.parse(String(p.messages[0]?.content))).toEqual([
      { key: 'mesto|noun|n|1', lemma: 'mesto', pos: 'noun', gender: 'n', forms: ['meste'] },
    ]);
    expect(p.output_config?.effort).toBe('low');
  });
});
