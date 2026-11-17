// The lemma id registry, `content/registry/lemma-ids.tsv` (docs/contracts.md, "Ids").
// A key per lemma, a number per key, append only: a key keeps its number forever, a number is
// never reused, and learner data points at these numbers.
import { readFile } from 'node:fs/promises';
import { existsSync, writeFileAtomic } from './files';

const HEADER = [
  '# Lemma id registry (docs/contracts.md, "Ids"). Append only: a key keeps its id forever,',
  '# and an id is never reused. Written by `pnpm run pipeline morph`; never edit or reorder lines.',
  '# id\tkey',
];

const KEY_RE = /^[^|\t]+\|[a-z]+\|[^|\t]*\|\d+$/u;

export class LemmaRegistry {
  private readonly byKey = new Map<string, number>();
  private readonly byId = new Map<number, string>();
  /** Entries in file order: the loaded ones first, then the ones added since. */
  private readonly order: number[] = [];
  private readonly loadedCount: number;
  private max = 0;

  constructor(entries: Iterable<readonly [number, string]> = []) {
    for (const [id, key] of entries) this.put(id, key);
    this.loadedCount = this.order.length;
  }

  private put(id: number, key: string): void {
    if (!Number.isInteger(id) || id < 1) throw new Error(`registry: bad id ${id}`);
    if (!KEY_RE.test(key)) throw new Error(`registry: bad key "${key}"`);
    if (this.byId.has(id)) throw new Error(`registry: id ${id} used twice`);
    if (this.byKey.has(key)) throw new Error(`registry: key "${key}" registered twice`);
    this.byKey.set(key, id);
    this.byId.set(id, key);
    this.order.push(id);
    if (id > this.max) this.max = id;
  }

  get size(): number {
    return this.order.length;
  }

  /** How many entries were added since the registry was loaded. */
  get added(): number {
    return this.order.length - this.loadedCount;
  }

  get maxId(): number {
    return this.max;
  }

  idOf(key: string): number | undefined {
    return this.byKey.get(key);
  }

  keyOf(id: number): string | undefined {
    return this.byId.get(id);
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  /** The id of a key; a new key gets the next free number. */
  assign(key: string): number {
    const known = this.byKey.get(key);
    if (known !== undefined) return known;
    const id = this.maxId + 1;
    this.put(id, key);
    return id;
  }

  /** Assigns ids to new keys in a stable order (code point order of the key). */
  assignAll(keys: Iterable<string>): void {
    const fresh = [...new Set(keys)].filter((k) => !this.byKey.has(k));
    fresh.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    let next = this.maxId;
    for (const k of fresh) this.put(++next, k);
  }

  entries(): [number, string][] {
    return this.order.map((id) => [id, this.byId.get(id) as string]);
  }

  serialize(): string {
    return `${[...HEADER, ...this.entries().map(([id, key]) => `${id}\t${key}`)].join('\n')}\n`;
  }

  static parse(text: string): LemmaRegistry {
    const entries: [number, string][] = [];
    let n = 0;
    for (const line of text.split('\n')) {
      n++;
      if (line === '' || line.startsWith('#')) continue;
      const tab = line.indexOf('\t');
      const id = Number(line.slice(0, tab));
      const key = line.slice(tab + 1);
      if (tab < 0 || !Number.isInteger(id)) throw new Error(`registry line ${n}: "${line}"`);
      entries.push([id, key]);
    }
    return new LemmaRegistry(entries);
  }
}

/** Splits a lemma key into its parts: 'mesto|noun|n|1'. */
export function parseLemmaKey(key: string): {
  lemma: string;
  pos: string;
  gender: string;
  n: number;
} {
  const parts = key.split('|');
  if (parts.length !== 4 || !KEY_RE.test(key)) throw new Error(`bad lemma key "${key}"`);
  const [lemma, pos, gender, n] = parts as [string, string, string, string];
  return { lemma, pos, gender, n: Number(n) };
}

export function lemmaKey(lemma: string, pos: string, gender: string | undefined, n = 1): string {
  return `${lemma}|${pos}|${gender ?? ''}|${n}`;
}

export async function loadRegistry(path: string): Promise<LemmaRegistry | null> {
  if (!existsSync(path)) return null;
  return LemmaRegistry.parse(await readFile(path, 'utf8'));
}

/**
 * Writes the registry, refusing anything but an append: every entry of the file on disk must
 * still be there with the same id, in the same place. Returns false when nothing changed.
 */
export async function saveRegistry(path: string, registry: LemmaRegistry): Promise<boolean> {
  const text = registry.serialize();
  if (existsSync(path)) {
    const before = await readFile(path, 'utf8');
    if (before === text) return false;
    assertAppendOnly(LemmaRegistry.parse(before), registry);
  }
  await writeFileAtomic(path, text);
  return true;
}

/** Throws unless `after` keeps every entry of `before`, in order, with the same id. */
export function assertAppendOnly(before: LemmaRegistry, after: LemmaRegistry): void {
  const a = before.entries();
  const b = after.entries();
  for (let i = 0; i < a.length; i++) {
    const [id, key] = a[i] as [number, string];
    const other = b[i];
    if (!other || other[0] !== id || other[1] !== key)
      throw new Error(
        `registry is append only: entry ${id} "${key}" would change to ${other ? `${other[0]} "${other[1]}"` : 'nothing'}`,
      );
  }
}
