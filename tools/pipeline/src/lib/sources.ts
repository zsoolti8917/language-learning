// The catalog of raw data sources, the record `fetch` writes for each, and content/SOURCES.md.
// Only the stages know where their data came from (docs/architecture.md, "Licences").
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync, readJson, writeFileAtomic } from './files';

export interface SourceFile {
  /** File name inside `content/raw/<source id>/`. */
  name: string;
  /** Where `fetch` downloads it from. */
  url: string;
  /** Known sha256, if any. `fetch` refuses a different file unless told to accept it. */
  sha256?: string;
}

export interface Source {
  id: string;
  name: string;
  /** The page that describes the source and states its licence. */
  page: string;
  /** The licence as the source states it. */
  license: string;
  files: SourceFile[];
}

/** Every source the pipeline knows. A stage names the ids it reads. */
export const SOURCES: readonly Source[] = [
  {
    id: 'snk-morphology',
    name: 'SNK morphological database 2015-02-05',
    page: 'https://korpus.sk/en/corpora-and-databases/databases/morphology-database/',
    license:
      'Research purposes only, under GNU AGPL v3, CC BY-SA 4.0 or GNU FDL 1.3. Ask the institute before a public release.',
    files: [
      {
        name: 'ma-2015-02-05.txt.xz',
        url: 'https://korpus.sk/wp-content/uploads/uploaded/documents/databases/morfologicka_databaza/ma-2015-02-05.txt.xz',
        sha256: '1367796465abb0262019fb2c112d33ed45584efd3e8fc989a93dbd4efb388753',
      },
      {
        name: 'tagset-www.pdf',
        url: 'https://korpus.sk/wp-content/uploads/uploaded/documents/databases/morfologicka_databaza/tagset-www.pdf',
        sha256: '0dbd76fecd6048fc222c6eee205f84519fcff5a1797bb5d48d172bdc9176156b',
      },
    ],
  },
  {
    id: 'araneum-arf',
    name: 'Araneum Slovacum VII Maximum ARF frequency lists',
    page: 'https://www.juls.savba.sk/dataset_araneaarf_en.html',
    license: 'No licence stated. Ask JÚĽŠ before a public release.',
    files: [
      {
        name: 'dataset-arf-araneum-slovacum-vii-lemma-pos.tsv.xz',
        url: 'https://www.juls.savba.sk/data/aranea-arf/dataset-arf-araneum-slovacum-vii-lemma-pos.tsv.xz',
        sha256: '7b8ec66ad0a956da0421954ac733eeb564e783d32ff99a4ff99e390407ed5b7c',
      },
      {
        name: 'dataset-arf-araneum-slovacum-vii-word-tag.tsv.xz',
        url: 'https://www.juls.savba.sk/data/aranea-arf/dataset-arf-araneum-slovacum-vii-word-tag.tsv.xz',
        sha256: 'a5d5ced3b8381234b4ed7e3fc8c3d9927a49793dfb6947e8954b890982ada235',
      },
      {
        name: 'dataset-arf-araneum-slovacum-vii-word.tsv.xz',
        url: 'https://www.juls.savba.sk/data/aranea-arf/dataset-arf-araneum-slovacum-vii-word.tsv.xz',
        sha256: '6453025d9fb6d9b412ee2101951672861ad9e5224788f93003791eb5e962f58c',
      },
    ],
  },
  {
    id: 'frequencywords',
    name: 'FrequencyWords sk 2018 (OpenSubtitles)',
    page: 'https://github.com/hermitdave/FrequencyWords',
    license: 'CC BY-SA 4.0 for the content (MIT for the code). Credit the source.',
    files: [
      {
        name: 'sk_full.txt',
        url: 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/sk/sk_full.txt',
        sha256: '83e57bd891ba644afee82cddcb8cdc209df2b69bdb6c6771a83907f490348632',
      },
      {
        name: 'sk_50k.txt',
        url: 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/sk/sk_50k.txt',
        sha256: '10eddbcd086ff26a814a140e1d5b20a1ba0ee8b0870be1a9a09268ba7aeaa094',
      },
      {
        name: 'LICENSE',
        url: 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/LICENSE',
        sha256: 'e08d916cc953f85f7dfa0df530f6d7931f14ce804d053602662d8649b5fac829',
      },
    ],
  },
  {
    id: 'kaikki-wiktionary',
    name: 'Wiktionary Slovak extract (kaikki.org)',
    page: 'https://kaikki.org/dictionary/Slovak/',
    license: 'CC BY-SA 4.0 and GFDL (Wiktionary). Credit the source and share alike.',
    files: [
      {
        name: 'kaikki.org-dictionary-Slovak.jsonl',
        url: 'https://kaikki.org/dictionary/Slovak/kaikki.org-dictionary-Slovak.jsonl',
        sha256: '3bdaf508a2ba385e629316c49905bf3f533af9361a5a90e6ae3dd802e69bb805',
      },
    ],
  },
  {
    id: 'tatoeba',
    name: 'Tatoeba sentences and links (Slovak, English)',
    page: 'https://tatoeba.org/en/downloads',
    license: 'CC BY 2.0 FR. Credit the source.',
    files: [
      {
        name: 'slk_sentences.tsv.bz2',
        url: 'https://downloads.tatoeba.org/exports/per_language/slk/slk_sentences.tsv.bz2',
        sha256: 'f4d052420454de72c636a048b61212a0852e05416f8388baeb38c2da8a74117f',
      },
      {
        name: 'eng_sentences.tsv.bz2',
        url: 'https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2',
        sha256: '3b5b3ecfcac5037b09f81ef048fa16fedc4d24838db5b6fbeedca1dfab374cbf',
      },
      {
        name: 'slk-eng_links.tsv.bz2',
        url: 'https://downloads.tatoeba.org/exports/per_language/slk/slk-eng_links.tsv.bz2',
        sha256: 'f33f14b5b5501304d67b4139db4c56910fa962954406f3249a0c003ed10b7163',
      },
      {
        name: 'eng-slk_links.tsv.bz2',
        url: 'https://downloads.tatoeba.org/exports/per_language/eng/eng-slk_links.tsv.bz2',
        sha256: '213d7d50465c04f948dcb6b9dd60ce960866ab4ce49e935d831eecfe75b1017e',
      },
    ],
  },
  {
    id: 'ud-slovak-snk',
    name: 'UD Slovak SNK treebank',
    page: 'https://github.com/UniversalDependencies/UD_Slovak-SNK',
    license: 'CC BY-SA 4.0. Credit the source.',
    // Pinned to the commit the shared copy was cloned from (2026-11-10).
    files: (
      [
        [
          'sk_snk-ud-train.conllu',
          '086b3ec1b48bc5942ac42ae274d9a26a75633152b1d444c649369aa4faa5d825',
        ],
        [
          'sk_snk-ud-dev.conllu',
          '5660577846d500db86ab139618518d106e0191a100155ee4e7d37254d6036819',
        ],
        [
          'sk_snk-ud-test.conllu',
          '3cdd11080a868685cf1fd5d20274603754aea00930847130c5d9e1b90ff5136b',
        ],
        ['LICENSE.txt', '899b1804a12ebc090b96339614eede1b64b686721b650a71430b55b5235f7f79'],
      ] as const
    ).map(([name, sha256]) => ({
      name,
      url: `https://raw.githubusercontent.com/UniversalDependencies/UD_Slovak-SNK/757c74c7c78ef427dde3a11553e22280e257c09a/${name}`,
      sha256,
    })),
  },
];

export function sourceById(id: string, catalog: readonly Source[] = SOURCES): Source {
  const s = catalog.find((x) => x.id === id);
  if (!s) throw new Error(`unknown source "${id}". Known: ${catalog.map((x) => x.id).join(', ')}`);
  return s;
}

/** What `fetch` records about one source, in `content/raw/<id>/source.json`. */
export interface SourceRecord {
  id: string;
  name: string;
  page: string;
  license: string;
  files: {
    name: string;
    url: string;
    sha256: string;
    bytes: number;
    fetchedAt: string;
    from: string;
  }[];
}

export const SOURCE_RECORD = 'source.json';

export function rawDir(raw: string, id: string): string {
  return join(raw, id);
}

export async function readSourceRecord(raw: string, id: string): Promise<SourceRecord | null> {
  const p = join(rawDir(raw, id), SOURCE_RECORD);
  return existsSync(p) ? readJson<SourceRecord>(p) : null;
}

// --- content/SOURCES.md --------------------------------------------------------------------

const BEGIN = '<!-- fetched:begin (written by `pnpm run pipeline fetch`; edit above or below) -->';
const END = '<!-- fetched:end -->';
const HEADER = '| Source | File | URL | Fetched | Bytes | sha256 | Licence |';

export interface FetchedRow {
  source: string;
  file: string;
  url: string;
  fetchedAt: string;
  bytes: number;
  sha256: string;
  license: string;
}

const DEFAULT_MD = `# Sources

Raw data the content pipeline reads. \`pnpm run pipeline fetch --source <id>\` places a source in
\`content/raw/<id>/\` (not in git) and records it in the table below: where it came from, when,
its size, its sha256 checksum and its licence as the source states it. The catalog of sources is
\`tools/pipeline/src/lib/sources.ts\`.

The SNK morphological database and the Araneum lists may be used for personal study; ask their
institutes before any public release (docs/architecture.md, "Licences").

## Fetched files

${BEGIN}
${END}
`;

function cell(s: string): string {
  return s.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function parseRows(block: string): FetchedRow[] {
  const rows: FetchedRow[] = [];
  for (const line of block.split('\n')) {
    if (!line.startsWith('| ') || line.startsWith(HEADER) || line.startsWith('|---')) continue;
    const parts = line
      .slice(2, -2)
      .split(/ (?<!\\)\| /u)
      .map((c) => c.replaceAll('\\|', '|'));
    if (parts.length !== 7) continue;
    const [source, file, url, fetchedAt, bytes, sha, license] = parts as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    rows.push({
      source,
      file,
      url,
      fetchedAt,
      bytes: Number(bytes.replaceAll(',', '')),
      sha256: sha.replaceAll('`', ''),
      license,
    });
  }
  return rows;
}

function renderRows(rows: FetchedRow[]): string {
  const sorted = [...rows].sort((a, b) =>
    a.source === b.source ? (a.file < b.file ? -1 : 1) : a.source < b.source ? -1 : 1,
  );
  return [
    HEADER,
    '|---|---|---|---|---:|---|---|',
    ...sorted.map(
      (r) =>
        `| ${cell(r.source)} | ${cell(r.file)} | ${cell(r.url)} | ${r.fetchedAt} | ${r.bytes.toLocaleString('en-US')} | \`${r.sha256}\` | ${cell(r.license)} |`,
    ),
  ].join('\n');
}

/** The fetched rows recorded in a SOURCES.md text. */
export function readFetchedRows(md: string): FetchedRow[] {
  const a = md.indexOf(BEGIN);
  const b = md.indexOf(END);
  if (a < 0 || b < a) return [];
  return parseRows(md.slice(a + BEGIN.length, b));
}

/** Replaces or adds rows (by source and file) in the generated block of SOURCES.md. */
export function upsertFetchedRows(md: string | null, rows: FetchedRow[]): string {
  let text = md ?? DEFAULT_MD;
  if (!text.includes(BEGIN) || !text.includes(END))
    text = `${text.trimEnd()}\n\n## Fetched files\n\n${BEGIN}\n${END}\n`;
  const existing = readFetchedRows(text);
  const key = (r: FetchedRow) => `${r.source}\u0000${r.file}`;
  const byKey = new Map(existing.map((r) => [key(r), r]));
  for (const r of rows) byKey.set(key(r), r);
  const a = text.indexOf(BEGIN) + BEGIN.length;
  const b = text.indexOf(END);
  return `${text.slice(0, a)}\n${renderRows([...byKey.values()])}\n${text.slice(b)}`;
}

export async function recordInSourcesMd(path: string, rows: FetchedRow[]): Promise<boolean> {
  const before = existsSync(path) ? await readFile(path, 'utf8') : null;
  const after = upsertFetchedRows(before, rows);
  if (after === before) return false;
  await writeFileAtomic(path, after);
  return true;
}
