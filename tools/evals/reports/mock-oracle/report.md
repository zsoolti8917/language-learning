# Eval run (mock)

> The answers come from the mock model (the oracle in `tools/evals/src/oracle.ts`). These numbers check the harness; they say nothing about Claude.

Datasets: 300 correct sentences, 300 with an injected case error, 500 analyzer sentences (seed 20261117). Morphology: content/build (100681 lemmas, 5000 ranked, 221 triggers).

Prompt versions and models:

| Route | Prompt version | Model |
|---|---|---|
| `tutor.analyze` | v1 | claude-opus-5-5 |
| `tutor.reply` | v1 | claude-opus-5-5 |
| `reader.disambiguate` | v1 | claude-opus-5-5 |

## Targets

| Metric | Target | Value | Met |
|---|---|---|---|
| False corrections on correct sentences, after verification | at most 2 % | 0.0 % (0/300) | yes |
| Injected errors found | at least 85 % | 100.0 % (300/300) | yes |
| Analyzer case accuracy (words the data knows) | at least 95 % | 98.7 % (2121/2150) | yes |

## Tutor

300 injected and 300 correct sentences; 0 stopped by a model error.

| Metric | Before verification | After verification (shown) |
|---|---|---|
| Recall: injected errors found | 100.0 % (300/300) | 100.0 % (300/300) |
| Precision of case errors | 100.0 % (300/300) | 100.0 % (300/300) |
| False corrections: correct sentences with a case error | 0.0 % (0/300) | 0.0 % (0/300) |
| Exact expected form, of found errors |  | 100.0 % (300/300) |
| Exact expected form, of all injected errors |  | 100.0 % (300/300) |

### Verification step

False reports (case errors that are not the injected one): 0. Removed by verification: n/a (0/0). True reports lost: 0.0 % (0/300).

### By case (the case the sentence needs)

| Case | Recall | Exact form of found |
|---|---|---|
| nom | 100.0 % (76/76) | 100.0 % (76/76) |
| gen | 100.0 % (58/58) | 100.0 % (58/58) |
| dat | 100.0 % (5/5) | 100.0 % (5/5) |
| acc | 100.0 % (92/92) | 100.0 % (92/92) |
| loc | 100.0 % (45/45) | 100.0 % (45/45) |
| ins | 100.0 % (24/24) | 100.0 % (24/24) |

### By kind of trigger

| Trigger | Recall | Exact form of found |
|---|---|---|
| preposition | 100.0 % (109/109) | 100.0 % (109/109) |
| verb | 100.0 % (66/66) | 100.0 % (66/66) |
| numeral | 100.0 % (5/5) | 100.0 % (5/5) |
| subject | 100.0 % (57/57) | 100.0 % (57/57) |
| noun | 100.0 % (35/35) | 100.0 % (35/35) |
| other | 100.0 % (28/28) | 100.0 % (28/28) |

### Rule checks on replies

| Check | Replies |
|---|---|
| No issue | 100.0 % (600/600) |
| Longer than 60 words | 0.0 % (0/600) |
| Prompts an error without a question | 0.0 % (0/600) |
| Names a form that was not verified | 0.0 % (0/600) |
| Markdown | 0.0 % (0/600) |
| Empty | 0.0 % (0/600) |

## Analyzer

500 sentences, 4558 words (0 not aligned with the analyzer's tokens).

| Metric | Value |
|---|---|
| Words the morphology data knows | 97.4 % (4439/4558) |
| Lemma accuracy (known words) | 99.0 % (4394/4439) |
| Case accuracy (known words) | 98.7 % (2121/2150) |
| Case accuracy (all words, unknown ones wrong) | 93.8 % (2121/2261) |

### By how the reading was chosen

| Method | Words | Lemma | Case |
|---|---|---|---|
| single | 962 | 98.1 % (944/962) | 96.4 % (378/392) |
| rule | 952 | 99.2 % (944/952) | 99.1 % (524/529) |
| model | 2525 | 99.2 % (2506/2525) | 99.2 % (1219/1229) |
| none | 119 | 0.0 % (0/119) | 0.0 % (0/111) |

### Case accuracy by gold case

| Case | Accuracy |
|---|---|
| nom | 96.6 % (560/580) |
| gen | 99.6 % (446/448) |
| dat | 98.3 % (117/119) |
| acc | 99.5 % (550/553) |
| voc | 100.0 % (1/1) |
| loc | 99.6 % (251/252) |
| ins | 99.5 % (196/197) |

### Most frequent case confusions

| Gold | Chosen | Words |
|---|---|---|
| nom | gen | 10 |
| nom | none | 4 |
| nom | acc | 4 |
| acc | nom | 1 |
| acc | loc | 1 |
| acc | gen | 1 |
| dat | loc | 1 |
| dat | nom | 1 |
| gen | dat | 1 |
| gen | acc | 1 |

## Cost and delay per route

| Route | Model | Calls | Cached | Input tok | Output tok | Cache read tok | Cost | Per call | Mean delay | p95 delay |
|---|---|---|---|---|---|---|---|---|---|---|
| `reader.disambiguate` | claude-opus-5-5 | 57 | 0 | 276512 | 9382 | 0 | $0.00 | $0.00 | n/a | n/a |
| `tutor.analyze` | claude-opus-5-5 | 600 | 0 | 1026492 | 30577 | 0 | $0.00 | $0.00 | n/a | n/a |
| `tutor.reply` | claude-opus-5-5 | 600 | 0 | 549259 | 3221 | 0 | $0.00 | $0.00 | n/a | n/a |

Total: 1257 calls, 0 from the cache, $0.00.
