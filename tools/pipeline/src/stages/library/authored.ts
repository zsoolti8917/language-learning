// The authored library texts: one Markdown file per text in content/authored/library/, named
// after its id, with a YAML front matter and the Slovak text as its body. Paragraphs are
// separated by an empty line, which the sentence splitter also treats as a boundary.
//
//   ---
//   id: lib-001
//   ord: 1
//   title: Nový byt
//   level: A2
//   topic: home
//   ---
//   Volám sa Jana a mám 28 rokov. …
import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { LibrarySourceSchema } from '@app/contracts';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { existsSync } from '../../lib/files';

/** The levels of the starter library: from A2 to B1. */
export const LIBRARY_LEVELS = ['A2', 'B1'] as const;
export const DEFAULT_LICENSE = 'CC BY 4.0';

export const FrontMatterSchema = z.strictObject({
  id: z.string().regex(/^lib-\d{3}$/u, "an id like 'lib-003'"),
  ord: z.int().nonnegative(),
  title: z.string().min(1),
  level: z.enum(LIBRARY_LEVELS),
  /** What the text is about, for the report. Not loaded. */
  topic: z.string().min(1).optional(),
  source: LibrarySourceSchema.default('authored'),
  license: z.string().min(1).default(DEFAULT_LICENSE),
});
export type FrontMatter = z.infer<typeof FrontMatterSchema>;

export interface AuthoredText extends FrontMatter {
  body: string;
  /** The file it came from, for messages. */
  file: string;
}

const FRONT = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/u;

/** Parses one authored text. Throws with the file name when it is malformed. */
export function parseAuthoredText(file: string, content: string): AuthoredText {
  const m = FRONT.exec(content.replace(/\r\n?/gu, '\n'));
  if (!m) throw new Error(`${file}: no front matter between --- lines`);
  let data: unknown;
  try {
    data = parseYaml(m[1] as string);
  } catch (e) {
    throw new Error(`${file}: front matter is not YAML: ${(e as Error).message}`);
  }
  const r = FrontMatterSchema.safeParse(data);
  if (!r.success)
    throw new Error(
      `${file}: ${r.error.issues.map((i) => `${i.path.join('.') || 'front matter'}: ${i.message}`).join('; ')}`,
    );
  const body = (m[2] as string)
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
  if (body === '') throw new Error(`${file}: the text is empty`);
  if (basename(file, '.md') !== r.data.id)
    throw new Error(`${file}: the file name must be the id, ${r.data.id}.md`);
  return { ...r.data, body, file };
}

/** Every `*.md` file of the folder, parsed, in file name order. */
export async function readAuthoredTexts(dir: string): Promise<AuthoredText[]> {
  if (!existsSync(dir)) throw new Error(`${dir} does not exist`);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort();
  const out: AuthoredText[] = [];
  for (const f of files) out.push(parseAuthoredText(f, await readFile(join(dir, f), 'utf8')));
  return out;
}
