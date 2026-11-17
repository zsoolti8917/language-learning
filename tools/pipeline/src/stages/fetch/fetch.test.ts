import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFetchedRows, type Source } from '../../lib/sources';
import { type TempRoot, tempRoot } from '../../lib/testing';
import { fetchSources } from '.';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const DEMO: Source = {
  id: 'demo',
  name: 'Demo source',
  page: 'https://example.org/demo',
  license: 'CC BY 4.0',
  files: [
    { name: 'a.txt', url: 'https://example.org/a.txt', sha256: sha('alpha\n') },
    { name: 'b.txt', url: 'https://example.org/b.txt' },
  ],
};

let t: TempRoot;
let local: string;
beforeEach(async () => {
  t = await tempRoot();
  local = join(t.root, 'shared');
  await mkdir(join(local, 'demo'), { recursive: true });
  await writeFile(join(local, 'demo', 'a.txt'), 'alpha\n');
});
afterEach(() => t.remove());

describe('fetch', () => {
  it('copies a local file, downloads the rest, and records both', async () => {
    const urls: string[] = [];
    const download = async (url: string, dest: string) => {
      urls.push(url);
      await writeFile(dest, 'beta\n');
    };
    const files = await fetchSources(t.ctx(), {
      sources: [DEMO],
      from: [local],
      allowChanged: false,
      download,
    });
    expect(files.map((f) => [f.file, f.status])).toEqual([
      ['a.txt', 'copied'],
      ['b.txt', 'downloaded'],
    ]);
    expect(urls).toEqual(['https://example.org/b.txt']);
    expect(await readFile(join(t.paths.raw, 'demo', 'a.txt'), 'utf8')).toBe('alpha\n');

    const record = JSON.parse(await readFile(join(t.paths.raw, 'demo', 'source.json'), 'utf8'));
    expect(record).toMatchObject({ id: 'demo', license: 'CC BY 4.0' });
    expect(record.files[1]).toMatchObject({
      name: 'b.txt',
      sha256: sha('beta\n'),
      bytes: 5,
      fetchedAt: '2026-11-17',
    });

    const md = await readFile(t.paths.sourcesMd, 'utf8');
    expect(readFetchedRows(md)).toEqual([
      expect.objectContaining({
        source: 'demo',
        file: 'a.txt',
        url: 'https://example.org/a.txt',
        sha256: sha('alpha\n'),
        license: 'CC BY 4.0',
      }),
      expect.objectContaining({ file: 'b.txt', fetchedAt: '2026-11-17', bytes: 5 }),
    ]);

    // A second run finds both files in place and changes nothing.
    const again = await fetchSources(t.ctx(), {
      sources: [DEMO],
      from: [local],
      allowChanged: false,
      download,
    });
    expect(again.map((f) => f.status)).toEqual(['up to date', 'up to date']);
    expect(urls).toHaveLength(1);
    expect(await readFile(t.paths.sourcesMd, 'utf8')).toBe(md);
  });

  it('refuses a file whose checksum differs from the catalog unless told to accept it', async () => {
    await writeFile(join(local, 'demo', 'a.txt'), 'changed\n');
    const opts = { sources: [DEMO], from: [local], files: ['a.txt'] };
    await expect(fetchSources(t.ctx(), { ...opts, allowChanged: false })).rejects.toThrow(
      /differs from the catalog/,
    );
    await expect(readFile(join(t.paths.raw, 'demo', 'a.txt'))).rejects.toThrow();
    const ok = await fetchSources(t.ctx(), { ...opts, allowChanged: true });
    expect(ok[0]?.sha256).toBe(sha('changed\n'));
  });
});
