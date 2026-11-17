import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { main } from './cli';
import { FIXTURE_CONLLU } from './testing/fixtures';

const root = mkdtempSync(join(tmpdir(), 'evals-cli-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const savedKey = process.env.ANTHROPIC_API_KEY;
afterEach(() => {
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
});

const treebank = join(root, 'ud');
const data = join(root, 'data');
const lines: string[] = [];
const log = (s: string) => lines.push(s);

describe('command line', () => {
  it('builds the datasets from a treebank folder', async () => {
    rmSync(treebank, { recursive: true, force: true });
    mkdirSync(treebank, { recursive: true });
    copyFileSync(FIXTURE_CONLLU, join(treebank, 'sk_snk-ud-test.conllu'));
    await main(['build', '--treebank', treebank, '--lexicon', 'mini', '--out', data], log);
    expect(lines.at(-1)).toMatch(/^datasets: \d+ correct, \d+ injected/);
    const manifest = JSON.parse(readFileSync(join(data, 'manifest.json'), 'utf8'));
    expect(manifest.morphology).toBe('testkit/mini');
  });

  it('prints the estimate of the full live eval and sends nothing', async () => {
    const cache = join(root, 'cache');
    await main(['estimate', '--data', data, '--lexicon', 'mini', '--cache', cache], log);
    const text = lines.at(-1) ?? '';
    expect(text).toMatch(/^Full live eval, nothing sent: \d+ requests, about \$\d+\.\d\d/);
    expect(text).toContain('claude-sonnet-5-5');
    expect(text).toContain('`tutor.analyze` | claude-opus-5-5');
  });

  it('refuses a live run without a key', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(
      main(
        ['run', '--mode', 'live', '--data', data, '--lexicon', 'mini', '--cache', join(root, 'c1')],
        log,
      ),
    ).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it('refuses a live run whose estimate is above the spend cap, before any request', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-a-key';
    await expect(
      main(
        [
          'run',
          '--mode',
          'live',
          '--data',
          data,
          '--lexicon',
          'mini',
          '--cache',
          join(root, 'c2'),
          '--max-spend',
          '0.0001',
        ],
        log,
      ),
    ).rejects.toThrow(/above the spend cap/);
  });

  it('runs in mock mode and writes the report', async () => {
    const out = join(root, 'out');
    await main(
      [
        'run',
        '--mode',
        'mock',
        '--data',
        data,
        '--lexicon',
        'mini',
        '--cache',
        join(root, 'c3'),
        '--out',
        out,
      ],
      log,
    );
    expect(readFileSync(join(out, 'report.md'), 'utf8')).toContain('# Eval run (mock)');
    await main(['compare', join(out, 'report.json'), join(out, 'report.json')], log);
    expect(lines.at(-1)).toContain('# Model comparison');
  });

  it('rejects a malformed model option', async () => {
    await expect(
      main(['run', '--data', data, '--lexicon', 'mini', '--model', 'tutor.reply'], log),
    ).rejects.toThrow(/<route>=<model>/);
  });
});
