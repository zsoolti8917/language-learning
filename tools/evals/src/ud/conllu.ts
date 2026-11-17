// A small CoNLL-U reader for the UD Slovak SNK treebank. Each word gets its character offsets
// in the sentence text, rebuilt from the forms and `SpaceAfter=No`, so labels and the
// analyzer's tokens can be compared by position.

export interface UdToken {
  /** 1-based index in the sentence. */
  id: number;
  form: string;
  lemma: string;
  upos: string;
  /** The SNK tag of the treebank (`SSfs2`). */
  xpos: string;
  feats: Record<string, string>;
  /** 0 for the root. */
  head: number;
  deprel: string;
  spaceAfter: boolean;
  /** Character offsets in `UdSentence.text`. */
  s: number;
  e: number;
}

export interface UdSentence {
  /** The treebank's `sent_id`. */
  sentId: string;
  /** The split the sentence comes from: train, dev or test. */
  split: string;
  /** The sentence as rebuilt from its words (equal to `# text` when that is consistent). */
  text: string;
  tokens: UdToken[];
  /** True when the sentence has multiword tokens (`1-2` lines); such sentences are skipped. */
  multiword: boolean;
}

function parseFeats(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw === '_' || raw === '') return out;
  for (const part of raw.split('|')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return out;
}

/** Parses the text of a `.conllu` file. */
export function parseConllu(text: string, split: string): UdSentence[] {
  const out: UdSentence[] = [];
  let sentId = '';
  let rows: string[][] = [];
  let multiword = false;
  const flush = () => {
    if (rows.length === 0) return;
    const tokens: UdToken[] = [];
    let pos = 0;
    let built = '';
    for (const r of rows) {
      const form = r[1] ?? '';
      const misc = r[9] ?? '_';
      const spaceAfter = !misc.split('|').includes('SpaceAfter=No');
      const s = pos;
      const e = s + form.length;
      built += form;
      pos = e;
      if (spaceAfter) {
        built += ' ';
        pos += 1;
      }
      tokens.push({
        id: Number(r[0]),
        form,
        lemma: r[2] ?? '',
        upos: r[3] ?? '',
        xpos: r[4] ?? '',
        feats: parseFeats(r[5] ?? '_'),
        head: Number(r[6]),
        deprel: r[7] ?? '',
        spaceAfter,
        s,
        e,
      });
    }
    out.push({ sentId, split, text: built.trimEnd(), tokens, multiword });
    rows = [];
    multiword = false;
    sentId = '';
  };
  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      flush();
      continue;
    }
    if (line.startsWith('#')) {
      const m = /^# sent_id = (.*)$/.exec(line);
      if (m) sentId = (m[1] ?? '').trim();
      continue;
    }
    const cols = line.split('\t');
    if (cols.length !== 10) continue;
    const id = cols[0] ?? '';
    if (id.includes('-')) {
      multiword = true;
      continue;
    }
    if (id.includes('.')) continue; // empty nodes
    rows.push(cols);
  }
  flush();
  return out;
}

/** The dependents of a word. */
export function childrenOf(sentence: UdSentence, id: number): UdToken[] {
  return sentence.tokens.filter((t) => t.head === id);
}

export function tokenById(sentence: UdSentence, id: number): UdToken | undefined {
  return sentence.tokens[id - 1]?.id === id
    ? sentence.tokens[id - 1]
    : sentence.tokens.find((t) => t.id === id);
}
