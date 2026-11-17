#!/usr/bin/env python3
"""Cuts the sentences sample from the real Tatoeba and UD files.

Kept are the real sentences whose words are all forms of the mini dataset (so the mini
dataset can tokenize them), and a share of those with exactly one word outside it (they
must be rejected as rare). Run from the repository root:

    python3 tools/pipeline/src/stages/sentences/fixtures/make-sample.py /mnt/project-files/raw-data
"""
import bz2
import json
import re
import sys
from pathlib import Path

RAW = Path(sys.argv[1] if len(sys.argv) > 1 else 'content/raw')
HERE = Path(__file__).parent
MINI = Path('packages/testkit/mini/forms.jsonl')
WORD = re.compile(r'\w+')
ONE_UNKNOWN_TATOEBA = 40
ONE_UNKNOWN_UD = 25

forms = {json.loads(l)['form'].lower() for l in MINI.open(encoding='utf-8')}


def unknown(text):
    return [w for w in (x.lower() for x in WORD.findall(text)) if w not in forms]


# --- Tatoeba ---------------------------------------------------------------------------
tat = RAW / 'tatoeba'
links = {}
for line in bz2.open(tat / 'slk-eng_links.tsv.bz2', 'rt', encoding='utf-8'):
    a, b = line.rstrip('\n').split('\t')
    links.setdefault(a, []).append(b)
keep = []
loose = 0
for line in bz2.open(tat / 'slk_sentences.tsv.bz2', 'rt', encoding='utf-8'):
    sid, _, text = line.rstrip('\n').split('\t')
    if sid not in links or len(WORD.findall(text)) < 3:
        continue
    u = unknown(text)
    if not u:
        keep.append(line)
    elif len(u) == 1 and loose < ONE_UNKNOWN_TATOEBA and len(WORD.findall(text)) >= 4:
        keep.append(line)
        loose += 1
ids = {l.split('\t')[0] for l in keep}
eng_ids = {e for s in ids for e in links[s]}
eng = [l for l in bz2.open(tat / 'eng_sentences.tsv.bz2', 'rt', encoding='utf-8')
       if l.split('\t')[0] in eng_ids]
link_rows = [f'{s}\t{e}\n' for s in sorted(ids, key=int) for e in links[s]]
out = HERE / 'tatoeba'
out.mkdir(exist_ok=True)
for name, rows in [('slk_sentences.tsv', keep), ('eng_sentences.tsv', eng),
                   ('slk-eng_links.tsv', link_rows)]:
    with bz2.open(out / f'{name}.bz2', 'wt', encoding='utf-8') as f:
        f.writelines(rows)
print(f'tatoeba: {len(keep)} Slovak sentences ({loose} with one rare word), {len(eng)} English')

# --- UD ----------------------------------------------------------------------------------
ud = RAW / 'ud-slovak-snk'
out = HERE / 'ud'
out.mkdir(exist_ok=True)
for split in ['train', 'dev', 'test']:
    blocks = (ud / f'sk_snk-ud-{split}.conllu').read_text(encoding='utf-8').split('\n\n')
    kept = []
    loose = 0
    for b in blocks:
        m = re.search(r'^# text = (.*)$', b, re.M)
        if not m or len(WORD.findall(m.group(1))) < 3:
            continue
        u = unknown(m.group(1))
        if not u:
            kept.append(b)
        elif len(u) == 1 and loose < ONE_UNKNOWN_UD and len(WORD.findall(m.group(1))) >= 4:
            kept.append(b)
            loose += 1
    (out / f'sk_snk-ud-{split}.conllu').write_text(
        '\n\n'.join(kept) + '\n\n', encoding='utf-8')
    print(f'ud {split}: {len(kept)} sentences ({loose} with one rare word)')
