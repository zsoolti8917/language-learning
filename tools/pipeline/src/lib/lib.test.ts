import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readLines } from './lines';
import {
  assertAppendOnly,
  LemmaRegistry,
  lemmaKey,
  loadRegistry,
  parseLemmaKey,
  saveRegistry,
} from './registry';
import { codeDirOf, runStage, type Stage, type StageContext } from './runner';
import { readFetchedRows, upsertFetchedRows } from './sources';
import { type TempRoot, tempRoot } from './testing';

let t: TempRoot;
beforeEach(async () => {
  t = await tempRoot();
});
afterEach(() => t.remove());

async function collect(it: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe('lemma registry', () => {
  it('gives each key a number, new keys after the highest, in code point order', () => {
    const r = new LemmaRegistry([
      [1, 'chlap|noun|m_anim|1'],
      [20, 'mesto|noun|n|1'],
    ]);
    r.assignAll(['žena|noun|f|1', 'mesto|noun|n|1', 'dom|noun|m_inan|1', 'dom|noun|m_inan|1']);
    expect(r.entries()).toEqual([
      [1, 'chlap|noun|m_anim|1'],
      [20, 'mesto|noun|n|1'],
      [21, 'dom|noun|m_inan|1'],
      [22, 'žena|noun|f|1'],
    ]);
    expect(r.added).toBe(2);
    expect(r.assign('dom|noun|m_inan|1')).toBe(21);
    expect(r.assign('ísť|verb||1')).toBe(23);
  });

  it('round-trips through its file, and only ever appends', async () => {
    const path = t.paths.registry;
    const r = new LemmaRegistry([[1, 'chlap|noun|m_anim|1']]);
    expect(await saveRegistry(path, r)).toBe(true);
    expect(await saveRegistry(path, r)).toBe(false);
    const loaded = (await loadRegistry(path)) as LemmaRegistry;
    expect(loaded.entries()).toEqual(r.entries());
    loaded.assign('mesto|noun|n|1');
    expect(await saveRegistry(path, loaded)).toBe(true);
    expect((await readFile(path, 'utf8')).trim().split('\n').slice(-2)).toEqual([
      '1\tchlap|noun|m_anim|1',
      '2\tmesto|noun|n|1',
    ]);
    // A registry that renumbers or drops a key is refused.
    await expect(
      saveRegistry(path, new LemmaRegistry([[5, 'chlap|noun|m_anim|1']])),
    ).rejects.toThrow(/append only/);
    await expect(
      saveRegistry(path, new LemmaRegistry([[1, 'chlap|noun|m_anim|1']])),
    ).rejects.toThrow(/append only/);
    expect(() =>
      assertAppendOnly(
        new LemmaRegistry([[1, 'a|noun|f|1']]),
        new LemmaRegistry([[1, 'b|noun|f|1']]),
      ),
    ).toThrow();
  });

  it('refuses duplicate ids, duplicate keys and malformed keys', () => {
    expect(
      () =>
        new LemmaRegistry([
          [1, 'a|noun|f|1'],
          [1, 'b|noun|f|1'],
        ]),
    ).toThrow(/twice/);
    expect(
      () =>
        new LemmaRegistry([
          [1, 'a|noun|f|1'],
          [2, 'a|noun|f|1'],
        ]),
    ).toThrow(/twice/);
    expect(() => new LemmaRegistry([[1, 'mesto']])).toThrow(/bad key/);
    expect(lemmaKey('ja', 'pron', undefined)).toBe('ja|pron||1');
    expect(parseLemmaKey('mesto|noun|n|1')).toEqual({
      lemma: 'mesto',
      pos: 'noun',
      gender: 'n',
      n: 1,
    });
  });
});

describe('SOURCES.md', () => {
  const row = {
    source: 'snk-morphology',
    file: 'ma.txt.xz',
    url: 'https://example.org/ma.txt.xz',
    fetchedAt: '2026-11-17',
    bytes: 6914520,
    sha256: 'abc',
    license: 'CC BY-SA 4.0 | AGPL',
  };

  it('keeps one row per file, keeps the text around the block, and reads its rows back', () => {
    const md = upsertFetchedRows(null, [row]);
    expect(md).toContain('# Sources');
    expect(readFetchedRows(md)).toEqual([row]);
    const again = upsertFetchedRows(md, [row]);
    expect(again).toBe(md);
    const edited = `${md}\nNotes written by hand.\n`;
    const two = upsertFetchedRows(edited, [
      { ...row, file: 'b.pdf' },
      { ...row, sha256: 'def' },
    ]);
    expect(two).toContain('Notes written by hand.');
    expect(readFetchedRows(two).map((r) => [r.file, r.sha256])).toEqual([
      ['b.pdf', 'abc'],
      ['ma.txt.xz', 'def'],
    ]);
  });
});

describe('readLines', () => {
  it('reads plain and gzip files', async () => {
    await mkdir(t.root, { recursive: true });
    await writeFile(join(t.root, 'a.txt'), 'one\ntwo\r\nthree');
    await writeFile(join(t.root, 'a.txt.gz'), gzipSync('one\ntwo\n'));
    expect(await collect(readLines(join(t.root, 'a.txt')))).toEqual(['one', 'two', 'three']);
    expect(await collect(readLines(join(t.root, 'a.txt.gz')))).toEqual(['one', 'two']);
  });

  it.skipIf(!hasTool('xz'))(
    'reads xz files, and stops the decompressor when the reader stops',
    async () => {
      const path = join(t.root, 'a.txt.xz');
      await writeFile(path, execFileSync('xz', ['-c'], { input: 'x\ny\nz\n' }));
      expect(await collect(readLines(path))).toEqual(['x', 'y', 'z']);
      for await (const line of readLines(path)) {
        expect(line).toBe('x');
        break;
      }
    },
  );

  it('fails on a missing file', async () => {
    await expect(collect(readLines(join(t.root, 'missing.txt')))).rejects.toThrow();
  });
});

describe('the stage runner', () => {
  function counter(): Stage & { runs: number } {
    const stage = {
      name: 'demo',
      description: 'copies in.txt to out.txt and appends to a log that is input and output',
      codeDir: codeDirOf(import.meta.url),
      runs: 0,
      inputs: (ctx: StageContext) => [
        join(ctx.paths.content, 'in.txt'),
        join(ctx.paths.content, 'log.txt'),
      ],
      outputs: (ctx: StageContext) => [
        join(ctx.paths.build, 'out.txt'),
        join(ctx.paths.content, 'log.txt'),
      ],
      params: (ctx: StageContext) => ({ upper: ctx.args.upper ?? false }),
      run: async (ctx: StageContext) => {
        stage.runs++;
        const text = await readFile(join(ctx.paths.content, 'in.txt'), 'utf8');
        await mkdir(ctx.paths.build, { recursive: true });
        await writeFile(
          join(ctx.paths.build, 'out.txt'),
          ctx.args.upper ? text.toUpperCase() : text,
        );
        // Like the registry: written only when something new comes in.
        const logPath = join(ctx.paths.content, 'log.txt');
        const log = await readFile(logPath, 'utf8').catch(() => '');
        if (!log.includes(text)) await writeFile(logPath, `${log}${text}\n`);
        return { ok: true };
      },
    };
    return stage;
  }

  it('skips a stage whose inputs, parameters and outputs did not change', async () => {
    await mkdir(t.paths.content, { recursive: true });
    await writeFile(join(t.paths.content, 'in.txt'), 'a');
    const s = counter();
    expect((await runStage(s, t.ctx())).skipped).toBe(false);
    // The log changed during the run; it still counts as unchanged on the next one.
    expect((await runStage(s, t.ctx())).skipped).toBe(true);
    expect(s.runs).toBe(1);

    await writeFile(join(t.paths.content, 'in.txt'), 'b');
    expect((await runStage(s, t.ctx())).skipped).toBe(false);
    expect((await runStage(s, t.ctx({ upper: true }))).skipped).toBe(false);
    expect((await runStage(s, t.ctx({ upper: true }))).skipped).toBe(true);
    expect((await runStage(s, t.ctx({ upper: true }), { force: true })).skipped).toBe(false);

    await writeFile(join(t.paths.build, 'out.txt'), 'edited by hand');
    expect((await runStage(s, t.ctx({ upper: true }))).skipped).toBe(false);
    expect(await readFile(join(t.paths.build, 'out.txt'), 'utf8')).toBe('B');
    expect(s.runs).toBe(5);
  });

  it('always runs a stage marked alwaysRun', async () => {
    const s = {
      ...counter(),
      alwaysRun: true,
      inputs: () => [],
      outputs: () => [],
      run: async () => 1,
    };
    expect((await runStage(s, t.ctx())).skipped).toBe(false);
    expect((await runStage(s, t.ctx())).skipped).toBe(false);
  });
});

function hasTool(tool: string): boolean {
  try {
    execFileSync(tool, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
