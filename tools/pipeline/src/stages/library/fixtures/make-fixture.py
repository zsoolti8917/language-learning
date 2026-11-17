#!/usr/bin/env python3
"""Cuts the real morphology and ranks down to what the library and scenarios tests need.

Reads content/build/morph/{lemmas,forms}.jsonl and content/build/freq/lemmas.jsonl (run
fetch, morph and freq first) and writes, beside this script:

- forms.jsonl: every form row whose spelling a word of content/authored/library/ or
  content/authored/scenarios/ may need (as written and in lower case), plus the top forms
  of the lemmas these rows name, so freq.top-forms passes;
- lemmas.jsonl: the morph rows of those lemmas and of the mini dataset's trigger lemmas;
- ranks.jsonl: the freq rows of those lemmas.

Rerun it after changing an authored text or scenario:
    python3 tools/pipeline/src/stages/library/fixtures/make-fixture.py
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..', '..', '..'))
BUILD = os.path.join(ROOT, 'content', 'build')
AUTHORED = [os.path.join(ROOT, 'content', 'authored', d) for d in ('library', 'scenarios')]
MINI_TRIGGERS = os.path.join(ROOT, 'packages', 'testkit', 'mini', 'triggers.jsonl')
WORD = re.compile(r'[^\W\d_]+')


def rows(path):
    with open(path, encoding='utf-8') as f:
        for line in f:
            if line.strip():
                yield json.loads(line)


def write(name, items):
    with open(os.path.join(HERE, name), 'w', encoding='utf-8') as f:
        for r in items:
            f.write(json.dumps(r, ensure_ascii=False, separators=(',', ':')) + '\n')


wanted = set()
for d in AUTHORED:
    for name in sorted(os.listdir(d)):
        with open(os.path.join(d, name), encoding='utf-8') as f:
            for w in WORD.findall(f.read()):
                wanted.add(w)
                wanted.add(w.lower())

forms = [r for r in rows(os.path.join(BUILD, 'morph', 'forms.jsonl')) if r['form'] in wanted]
ids = {r['lemmaId'] for r in forms} | {r['lemmaId'] for r in rows(MINI_TRIGGERS) if 'lemmaId' in r}
ranks = [r for r in rows(os.path.join(BUILD, 'freq', 'lemmas.jsonl')) if r['id'] in ids]
top = {(r['id'], f['form']) for r in ranks for f in r['topForms']}
have = {(r['lemmaId'], r['form']) for r in forms}
extra = [
    r for r in rows(os.path.join(BUILD, 'morph', 'forms.jsonl'))
    if (r['lemmaId'], r['form']) in top and (r['lemmaId'], r['form']) not in have
]
lemmas = [r for r in rows(os.path.join(BUILD, 'morph', 'lemmas.jsonl')) if r['id'] in ids]
all_forms = sorted(forms + extra, key=lambda r: (r['lemmaId'], r['form']))
write('forms.jsonl', all_forms)
write('lemmas.jsonl', lemmas)
write('ranks.jsonl', ranks)
print(f'{len(lemmas)} lemmas, {len(all_forms)} forms, {len(ranks)} ranks')
