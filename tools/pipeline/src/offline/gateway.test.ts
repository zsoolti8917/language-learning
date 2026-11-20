import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isAiGatewayError, promptFor, type StructuredRequest, systemFor } from '@app/ai';
import { type Disambiguation, DisambiguationSchema } from '@app/api/modules/analyzer/model';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from '../lib/files';
import { type TempRoot, tempRoot } from '../lib/testing';
import { offlinePath } from '../model/runner';
import { answerProblems, DISAMBIGUATE_ROUTE } from '../stages/analysis/answers';
import { createOfflineGateway, gatewayRequest } from './gateway';

const USER = '00000000-0000-7000-8000-000000000000';

/** A `reader.disambiguate` request for one word with two readings. */
function request(word = 'ženy'): StructuredRequest<Disambiguation> {
  const message = JSON.stringify({
    contexts: [`Vidím ${word}.`],
    words: [
      {
        w: 0,
        context: 0,
        word,
        readings: [
          { i: 0, lemma: 'žena', pos: 'noun', case: 'gen', number: 'sg', gender: 'f' },
          { i: 1, lemma: 'žena', pos: 'noun', case: 'acc', number: 'pl', gender: 'f' },
        ],
      },
    ],
  });
  return {
    route: DISAMBIGUATE_ROUTE,
    userId: USER,
    system: systemFor(DISAMBIGUATE_ROUTE),
    messages: [{ role: 'user', content: message }],
    schema: DisambiguationSchema,
  };
}

let t: TempRoot;
let n = 0;
/** A fresh pair of folders for each test. */
function dirs() {
  n += 1;
  return {
    requestsDir: join(t.root, `requests-${n}`),
    answersDir: join(t.root, `answers-${n}`),
  };
}
async function answer(dir: string, hash: string, content: string) {
  const path = offlinePath(dir, DISAMBIGUATE_ROUTE, hash);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return path;
}

beforeAll(async () => {
  t = await tempRoot();
});
afterAll(() => t.remove());

describe('the request of a gateway call', () => {
  it('has a stable hash that follows the message, and shows the prompt and the schema', () => {
    const a = gatewayRequest(request());
    expect(a.hash).toBe(gatewayRequest(request()).hash);
    expect(a.hash).not.toBe(gatewayRequest(request('knihy')).hash);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(a.route).toBe(DISAMBIGUATE_ROUTE);
    expect(a.promptVersion).toBe(promptFor(DISAMBIGUATE_ROUTE).version);
    expect(a.system).toContain('annotator of Slovak grammar');
    expect(JSON.parse(a.user).words[0].word).toBe('ženy');
    expect(a.schema).toMatchObject({ type: 'object', required: ['picks'] });
  });
});

describe('the offline gateway', () => {
  it('fails like an outage without an answer and leaves the request for a writer', async () => {
    const d = dirs();
    const g = createOfflineGateway(d);
    g.job('lib-001');
    const err = await g.structured(request()).catch((e) => e);
    expect(isAiGatewayError(err)).toBe(true);
    expect(err.code).toBe('upstream_failed');
    expect(err.details).toMatchObject({ reason: 'offline_open', route: DISAMBIGUATE_ROUTE });
    // The same request under another job is one request with both jobs.
    g.job('lib-002');
    await g.structured(request()).catch(() => undefined);
    expect(g.calls.map((c) => c.job)).toEqual(['lib-001', 'lib-002']);
    expect(g.open()).toHaveLength(2);

    // Nothing is written before close; close leaves exactly the open requests.
    expect(existsSync(d.requestsDir)).toBe(false);
    const stale = offlinePath(d.requestsDir, DISAMBIGUATE_ROUTE, 'f'.repeat(64));
    await mkdir(dirname(stale), { recursive: true });
    await writeFile(stale, '{}');
    await g.close([DISAMBIGUATE_ROUTE]);
    const hash = gatewayRequest(request()).hash;
    expect(await readdir(join(d.requestsDir, DISAMBIGUATE_ROUTE))).toEqual([`${hash}.json`]);
    const written = JSON.parse(
      await readFile(offlinePath(d.requestsDir, DISAMBIGUATE_ROUTE, hash), 'utf8'),
    );
    expect(written).toMatchObject({
      hash,
      route: DISAMBIGUATE_ROUTE,
      jobs: ['lib-001', 'lib-002'],
    });
    expect(written.user).toBe(request().messages[0]?.content);
  });

  it('returns a valid answer file as the answer, at no cost, under the name of its writer', async () => {
    const d = dirs();
    const hash = gatewayRequest(request()).hash;
    await answer(d.answersDir, hash, '{"picks":[{"w":0,"c":1}]}');
    const g = createOfflineGateway({ ...d, answeredBy: 'a-writer', check: answerProblems });
    const r = await g.structured(request());
    expect(r.data).toEqual({ picks: [{ w: 0, c: 1 }] });
    expect(r.usage).toMatchObject({ model: 'a-writer', costUsd: 0, inputTokens: 0 });
    expect(g.open()).toEqual([]);
    expect(g.calls[0]).toMatchObject({
      hash,
      model: 'a-writer',
      data: { picks: [{ w: 0, c: 1 }] },
    });
    // An answered request is no open request: close removes its file.
    const rpath = offlinePath(d.requestsDir, DISAMBIGUATE_ROUTE, hash);
    await mkdir(dirname(rpath), { recursive: true });
    await writeFile(rpath, '{}');
    await g.close([DISAMBIGUATE_ROUTE]);
    expect(existsSync(rpath)).toBe(false);
  });

  it('stops on an answer file that is not JSON, not the schema or refused by the check', async () => {
    const hash = gatewayRequest(request()).hash;
    for (const [content, message] of [
      ['{"picks":[', /not JSON/u],
      ['{"picks":"none"}', /schema: picks/u],
      ['{"picks":[{"w":0,"c":7}]}', /word 0 \("ženy"\) has no reading 7/u],
      ['{"picks":[]}', /no pick for word 0 \("ženy"\)/u],
      ['{"picks":[{"w":0,"c":1},{"w":0,"c":0}]}', /picked twice/u],
      ['{"picks":[{"w":0,"c":1},{"w":3,"c":0}]}', /word 3, which the request does not ask/u],
    ] as const) {
      const d = dirs();
      const path = await answer(d.answersDir, hash, content);
      const g = createOfflineGateway({ ...d, check: answerProblems });
      const err = await g.structured(request()).catch((e) => e);
      expect(isAiGatewayError(err), content).toBe(false);
      expect(String(err.message), content).toMatch(message);
      expect(String(err.message), content).toContain(path);
    }
  });

  it('a dry run counts the calls and writes nothing', async () => {
    const d = dirs();
    const g = createOfflineGateway({ ...d, dry: true });
    await g.structured(request()).catch(() => undefined);
    await g.close([DISAMBIGUATE_ROUTE]);
    expect(g.open()).toHaveLength(1);
    expect(existsSync(d.requestsDir)).toBe(false);
  });

  it('answers structured calls only', async () => {
    const g = createOfflineGateway(dirs());
    await expect(
      g.stream({
        route: 'tutor.reply',
        userId: USER,
        system: [],
        messages: [],
        onText: () => undefined,
      }),
    ).rejects.toThrow(/structured calls only/u);
  });
});
