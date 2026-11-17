# Builds the committed freq/dict sample (this folder) from a full run.
# Run after `pnpm run pipeline freq` on the full data, from the repository root:
#   python3 -I tools/pipeline/src/stages/freq/fixtures/make-sample.py . tools/pipeline/src/stages/freq/fixtures
# Keeps the lemmas ranked 1-60, every lemma whose web or subtitle rank is as high as theirs,
# a few common nouns and adjectives, and every lemma sharing a spelling with those; then the
# rows of the raw lists that touch their spellings. Python standard library only.
import json, lzma, sys, os
root, outdir = sys.argv[1], sys.argv[2]
B = os.path.join(root, 'content/build'); R = os.path.join(root, 'content/raw')
os.makedirs(outdir, exist_ok=True)
ranks = []
for i, line in enumerate(open(f'{B}/freq/ranks.tsv')):
    if i == 0: continue
    c = line.rstrip('\n').split('\t')
    ranks.append(dict(rank=int(c[0]), id=int(c[1]), key=c[2], web=int(c[4]), sub=int(c[5])))
TOP = 60
top = [r for r in ranks if r['rank'] <= TOP]
maxw = max(r['web'] for r in top); maxs = max(r['sub'] for r in top)
core = {r['id'] for r in ranks if r['rank'] <= TOP or r['web'] <= maxw or r['sub'] <= maxs}
# A few lemmas further down, so the sample has common nouns and adjectives.
extra_keys = ['mesto|noun|n|1', 'žena|noun|f|1', 'pekný|adj||1', 'dom|noun|m_inan|1', 'kniha|noun|f|1']
lemmas = {}
for line in open(f'{B}/morph/lemmas.jsonl'):
    l = json.loads(line); lemmas[l['id']] = l
for l in lemmas.values():
    if l['key'] in extra_keys: core.add(l['id'])
print('maxWeb', maxw, 'maxSub', maxs, 'core', len(core), file=sys.stderr)
forms = [json.loads(line) for line in open(f'{B}/morph/forms.jsonl')]
S = set()
for f in forms:
    if f['lemmaId'] in core: S.add(f['form']); S.add(f['form'].lower())
F = {f['form'] for f in forms if f['form'] in S or f['form'].lower() in S}
keep_forms = [f for f in forms if f['lemmaId'] in core or f['form'] in F]
ids = {f['lemmaId'] for f in keep_forms} | core
print('lemmas', len(ids), 'forms', len(keep_forms), file=sys.stderr)
with open(f'{outdir}/lemmas.jsonl', 'w') as o:
    for i in sorted(ids): o.write(json.dumps(lemmas[i], ensure_ascii=False, separators=(',', ':')) + '\n')
with open(f'{outdir}/forms.jsonl', 'w') as o:
    for f in keep_forms: o.write(json.dumps(f, ensure_ascii=False, separators=(',', ':')) + '\n')
texts = {lemmas[i]['lemma'] for i in ids}
n = 0
with lzma.open(f'{outdir}/lemma-pos.tsv.xz', 'wt', preset=9) as o:
    for line in lzma.open(f'{R}/araneum-arf/dataset-arf-araneum-slovacum-vii-lemma-pos.tsv.xz', 'rt'):
        t = line.split('\t', 1)[0]
        if t[:-1] in texts: o.write(line); n += 1
print('lemma-pos rows', n, file=sys.stderr)
n = 0
with lzma.open(f'{outdir}/word-tag.tsv.xz', 'wt', preset=9) as o:
    for line in lzma.open(f'{R}/araneum-arf/dataset-arf-araneum-slovacum-vii-word-tag.tsv.xz', 'rt'):
        w = line.split('\t', 1)[0]
        if w in S or w.lower() in S: o.write(line); n += 1
print('word-tag rows', n, file=sys.stderr)
n = 0
with open(f'{outdir}/sk_full.txt', 'w') as o:
    for line in open(f'{R}/frequencywords/sk_full.txt'):
        w = line.rsplit(' ', 1)[0].lower()
        if w in S: o.write(line); n += 1
print('subtitle rows', n, file=sys.stderr)
# Wiktionary entries for the sample's lemma spellings, trimmed to the fields dict reads.
n = 0
with open(f'{outdir}/kaikki-sample.jsonl', 'w') as o:
    for line in open(f'{R}/kaikki-wiktionary/kaikki.org-dictionary-Slovak.jsonl'):
        e = json.loads(line)
        if e['word'] not in texts: continue
        keep = {k: e[k] for k in ('word', 'pos', 'lang_code', 'head_templates') if k in e}
        keep['senses'] = [{k: s[k] for k in ('glosses', 'raw_glosses', 'tags', 'form_of', 'alt_of') if k in s} for s in e.get('senses', [])]
        if 'head_templates' in keep:
            keep['head_templates'] = [{'name': h.get('name'), 'args': h.get('args', {})} for h in keep['head_templates']]
        o.write(json.dumps(keep, ensure_ascii=False, separators=(',', ':')) + '\n'); n += 1
print('kaikki rows', n, file=sys.stderr)
