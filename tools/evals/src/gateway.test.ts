import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { costOf, createMockGateway } from '@app/ai';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CACHE_MIN_TOKENS, createEvalGateway, estimateTokens, requestKey } from './gateway';

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'evals-cache-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const Schema = z.object({ en: z.string() });
const req = (text: string) => ({
  route: 'reader.translate' as const,
  userId: 'u',
  system: [{ text: 'Translate.', cache: true }],
  messages: [{ role: 'user' as const, content: text }],
  schema: Schema,
});

function files(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true }))
      e.isDirectory() ? walk(join(d, e.name)) : out.push(e.name);
  };
  walk(dir);
  return out;
}

describe('eval gateway', () => {
  it('records answers and replays them without a model call', async () => {
    const dir = tempDir();
    const inner = createMockGateway({});
    inner.script('reader.translate', {
      data: { en: 'I live in town.' },
      usage: { inputTokens: 100, outputTokens: 10, costUsd: 0.0006, latencyMs: 900 },
    });
    inner.script('tutor.reply', { text: ['S kým ', 'ideš?'] });
    const rec = createEvalGateway({ mode: 'record', inner, cacheDir: dir });
    expect((await rec.structured(req('Bývam v meste.'))).data).toEqual({ en: 'I live in town.' });
    const streamed = await rec.stream({
      route: 'tutor.reply',
      userId: 'u',
      system: [{ text: 'Reply.' }],
      messages: [{ role: 'user', content: 'Ahoj' }],
      onText: () => {},
    });
    expect(streamed.text).toBe('S kým ideš?');
    expect(files(dir)).toHaveLength(2);

    const never = createMockGateway({});
    const replay = createEvalGateway({ mode: 'replay', inner: never, cacheDir: dir });
    const again = await replay.structured(req('Bývam v meste.'));
    expect(again.data).toEqual({ en: 'I live in town.' });
    // The usage of the recorded call is reported, so cost and delay survive the replay.
    expect(again.usage).toMatchObject({ costUsd: 0.0006, latencyMs: 900 });
    const pieces: string[] = [];
    await replay.stream({
      route: 'tutor.reply',
      userId: 'u',
      system: [{ text: 'Reply.' }],
      messages: [{ role: 'user', content: 'Ahoj' }],
      onText: (d) => pieces.push(d),
    });
    expect(pieces.join('')).toBe('S kým ideš?');
    expect(never.calls).toHaveLength(0);
    expect(replay.log.every((c) => c.cached)).toBe(true);
  });

  it('stops a replay on a request it has no answer for', async () => {
    const replay = createEvalGateway({
      mode: 'replay',
      inner: createMockGateway({}),
      cacheDir: tempDir(),
    });
    await expect(replay.structured(req('Nové.'))).rejects.toThrow(/No cached answer/);
  });

  it('keeps model refusals and invalid output, not outages', async () => {
    const dir = tempDir();
    const inner = createMockGateway({});
    inner.script('reader.translate', { error: 'refused' }, { error: 'upstream_failed' });
    const rec = createEvalGateway({ mode: 'record', inner, cacheDir: dir });
    await expect(rec.structured(req('a'))).rejects.toMatchObject({ code: 'refused' });
    await expect(rec.structured(req('b'))).rejects.toMatchObject({ code: 'upstream_failed' });
    const replay = createEvalGateway({
      mode: 'replay',
      inner: createMockGateway({}),
      cacheDir: dir,
    });
    await expect(replay.structured(req('a'))).rejects.toMatchObject({ code: 'refused' });
    await expect(replay.structured(req('b'))).rejects.toThrow(/No cached answer/);
  });

  it('keys a request by everything the model sees, the model included', () => {
    const base = { system: [{ text: 'S' }], messages: [{ role: 'user', content: 'M' }] };
    const k = requestKey('structured', 'tutor.reply', 'claude-opus-5-5', base, Schema);
    expect(requestKey('structured', 'tutor.reply', 'claude-opus-5-5', base, Schema)).toBe(k);
    expect(requestKey('structured', 'tutor.reply', 'claude-sonnet-5-5', base, Schema)).not.toBe(k);
    expect(
      requestKey(
        'structured',
        'tutor.reply',
        'claude-opus-5-5',
        { ...base, system: [{ text: 'S2' }] },
        Schema,
      ),
    ).not.toBe(k);
    expect(
      requestKey('structured', 'tutor.reply', 'claude-opus-5-5', base, z.object({ x: z.number() })),
    ).not.toBe(k);
  });

  it('estimates in a dry run: nothing stored, the price from B8 table', async () => {
    const dir = tempDir();
    const inner = createMockGateway({});
    inner.respond('reader.translate', () => ({ data: { en: 'x' } }));
    const dry = createEvalGateway({ mode: 'estimate', inner, cacheDir: dir });
    await dry.structured(req('Bývam v meste.'));
    expect(files(dir)).toHaveLength(0);
    const [call] = dry.log;
    expect(call?.estimated).toBe(true);
    const u = call?.usage;
    // $4 per million input tokens, $20 per million output tokens.
    expect(u?.costUsd).toBeCloseTo(
      ((u?.inputTokens ?? 0) * 4 + (u?.outputTokens ?? 0) * 20) / 1e6,
      6,
    );
    expect(u?.costUsd).toBe(
      costOf('claude-opus-5-5', {
        inputTokens: u?.inputTokens ?? 0,
        outputTokens: u?.outputTokens ?? 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    );
    // The worst case uses the whole token limit (2000 for reader.translate).
    expect(call?.worstUsd).toBeGreaterThan(u?.costUsd ?? 0);
  });

  it('counts cache reads at $0.20 per million for a prefix above the minimum', async () => {
    const inner = createMockGateway({});
    inner.respond('reader.translate', () => ({ data: { en: 'x' } }));
    const dry = createEvalGateway({ mode: 'estimate', inner, cacheDir: tempDir() });
    const long = 'Pravidlo. '.repeat(CACHE_MIN_TOKENS); // about 3.3 tokens per repeat
    const r = (m: string) => ({ ...req(m), system: [{ text: long, cache: true }] });
    await dry.structured(r('a'));
    await dry.structured(r('b'));
    const [first, second] = dry.log;
    const prefix = estimateTokens(long);
    expect(first?.usage.cacheWriteTokens).toBe(prefix);
    expect(second?.usage.cacheReadTokens).toBe(prefix);
    expect(second?.usage.costUsd).toBeLessThan((first?.usage.costUsd ?? 0) / 3);
  });

  it('counts cached answers as free in a dry run', async () => {
    const dir = tempDir();
    const inner = createMockGateway({});
    inner.respond('reader.translate', () => ({ data: { en: 'x' }, usage: { costUsd: 0.01 } }));
    await createEvalGateway({ mode: 'record', inner, cacheDir: dir }).structured(req('a'));
    const dry = createEvalGateway({ mode: 'estimate', inner, cacheDir: dir });
    await dry.structured(req('a'));
    await dry.structured(req('b'));
    expect(dry.log.map((c) => [c.cached, c.estimated])).toEqual([
      [true, false],
      [false, true],
    ]);
  });
});
