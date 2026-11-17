# Model evals

How well the model finds case errors in a learner's message and reads Slovak forms in an imported text, measured without hand labelling. The code lives in `tools/evals` (package I3).

> **Status, 2026-11-17: no live run yet.** There is no Claude API key and no approved spend. Every number below that comes from a model is from the **mock model** (an oracle that knows the labels) and checks the harness, not Claude. The live numbers are filled in by the first live run (see "What remains for the live run").

## What is measured

| Suite | Dataset | Steps run, as the API runs them | Routes called |
|---|---|---|---|
| Tutor | 300 correct sentences + 300 sentences with one injected case error | `analyzeMessage` (`tutor.analyze`) → `verifyErrors` (morphology check) → `decideTurn` → `tutor.reply` → `checkReply` | `tutor.analyze`, `tutor.reply` |
| Analyzer | 500 sentences with the treebank's checked lemma and case of every word | `analyzeText` of `modules/analyzer/service.ts`, ten sentences per imported text | `reader.disambiguate` |

The runners import the steps from `apps/api` (`modules/tutor/pipeline.ts`, `modules/analyzer/service.ts`); nothing is reimplemented. The morphology port, lemma facts and trigger list come from memory (`tools/evals/src/lexicon.ts`), built from the pipeline's morphology output with the lexicon module's own functions; it passes the shared `MorphologyPort` suite, so lookups order and filter as the real port does. Glosses are not scored, so the analyzer runs with a dictionary that never calls `reader.gloss`.

Each tutor sentence is the learner's first message in a free conversation scenario (`EVAL_SCENARIO`, level B1, all six cases as targets), after the tutor's opening line.

## Datasets

Built by `pnpm --filter @app/evals run evals build` from the UD Slovak SNK treebank (CC BY-SA 4.0, all three splits) and the SNK morphology (`content/build/morph`, ranks from `content/build/freq`). Committed in `tools/evals/data/`; seed 20261117. The three sets share no sentence.

| File | Rows | What a row holds |
|---|---:|---|
| `tutor-correct.jsonl` | 300 | A treebank sentence. The tutor must find no case error. |
| `tutor-injected.jsonl` | 300 | The sentence with one noun phrase in another case, the original, and the label: span, given words, expected words, expected and given case, number, head lemma, kind of trigger, trigger word, each changed word. |
| `analyzer-gold.jsonl` | 500 (4,558 words, 2,261 with a scored case) | Each word with offsets, treebank lemma, UPOS, case and number. |

**Which sentences.** 5 to 20 words, a capital first letter and a final `.`, `?` or `!`, no digits, symbols, quotes or multiword tokens, and every noun, adjective, determiner, pronoun, verb and preposition known to the morphology data, so a miss is the model's and not a gap in the data. Sentences are dealt to the three sets in turn; a sentence dealt to the injected set that cannot take an error is dropped (37 were), so the correct set gets no leftovers.

**The injection.** A noun with a case and its one-word agreeing modifiers (`amod`, `det`), when they stand together, are put into another case of the same lemmas, keeping number and the modifiers' gender. The nominative is tried first in two of five phrases that are not nominative, as learners do; other cases in random order; never the vocative. A swap is refused when the new head form is a form of the original case in either number (*chodby* for *chodbu* could be a plural), or a form of another lemma of the same spelling with that case, because then it is no error, and the tutor's verification would rightly drop it.

Distribution of the 300 injected errors:

| Kind of trigger (from the treebank's tree) | Errors | | Case needed | Errors | | Case written | Errors |
|---|---:|---|---|---:|---|---|---:|
| preposition (`case` dependent) | 109 | | nominative | 76 | | nominative | 84 |
| verb (object or oblique of a verb) | 66 | | genitive | 58 | | genitive | 35 |
| subject (`nsubj`) | 57 | | dative | 5 | | dative | 56 |
| noun (`nmod`, mostly genitive) | 35 | | accusative | 92 | | accusative | 21 |
| other | 28 | | locative | 45 | | locative | 44 |
| numeral (`nummod`) | 5 | | instrumental | 24 | | instrumental | 60 |

175 errors change one word, 111 two, 14 three or four. The dative and numeral rows are small; read their figures with their counts.

**Known limits of the labels.** An injected sentence can turn out grammatical in another reading (an instrumental of manner, a partitive genitive), and then a "miss" is right. The per case results of a live run (`tutor-cases.jsonl`) list every miss for a person to read; misses that are in fact correct sentences should be counted out, not tuned for. Treebank sentences are literary and news Slovak, harder than a learner's messages.

## Metrics

Every rate is shown with its numerator and denominator.

**Tutor** (`tutorMetrics` in `tools/evals/src/metrics.ts`). "Shown" means a case error that verification kept as `verified`: what the learner is prompted with. "Before verification" counts every case error the model reported.

| Metric | Definition |
|---|---|
| Recall | Injected sentences where a shown case error overlaps the label's span |
| Precision | Shown case errors that overlap a label, over all shown case errors (both sets) |
| Exact expected form | Found errors whose `expected` holds the treebank's form for every changed word they cover; also over all injected errors |
| False corrections | Correct sentences with at least one shown case error |
| Verification | False reports (case errors not matching a label) and the share verification removed; true reports it lost; the reasons |
| Splits | Recall and exact form by the case needed and by the kind of trigger; false corrections by the claimed case and error type |
| Reply rule checks | Share of replies with no issue, over 60 words, prompting without a question, naming a form that was not verified (expected forms of prompted, unverified and dropped errors), Markdown, empty |

**Analyzer** (`analyzerMetrics`). Gold words are aligned with the analyzer's tokens by character span (all 4,558 align). Case is scored on nouns, proper nouns, adjectives, determiners, pronouns and numerals with a gold case (prepositions carry none in the app's tags).

| Metric | Definition |
|---|---|
| Known words | Words the morphology data has a reading for |
| Lemma accuracy | Known words whose chosen lemma is the treebank's (case-insensitive, with the naming conventions below) |
| Case accuracy | Known words with a gold case whose chosen case is the gold case. **The target's measure.** |
| Case accuracy, all words | The same with unknown words (mostly foreign proper names) counted wrong |
| By method | Words, lemma and case accuracy by how the reading was chosen: `single`, `rule`, `model`, `guess`, `none` (unknown) |

Lemma conventions that differ by design, not by error: the data files *to*, *tá* under *ten*, the plural *ľudia* as its own lemma, and negated verbs as lemmas of their own (*nemať*); the scorer accepts these.

**Cost and delay** per route and model, from the usage numbers of every call (`routeCosts`): calls, cached calls, input, output and cache tokens, cost, cost per call, mean and 95th percentile delay. A replayed run reports the usage that was recorded with the answer.

## Targets

| Target | Proposed |
|---|---|
| False corrections on correct sentences, after verification | at most 2 % |
| Injected errors found (recall, after verification) | at least 85 % |
| Analyzer case accuracy (known words) | at least 95 % |

## Results

### Live run: not yet

| Metric | Dataset size | Value |
|---|---:|---|
| False corrections after verification | 300 correct sentences | pending the key |
| Recall after verification | 300 injected errors | pending the key |
| Precision after verification | every shown error | pending the key |
| Exact expected form | found errors | pending the key |
| Verification: false reports removed | every false report | pending the key |
| Reply rule checks | 600 replies | pending the key |
| Analyzer case accuracy | 2,158 known words with a case | pending the key |
| Analyzer lemma accuracy | 4,447 known words | pending the key |
| Cost and delay per route | 1,257 calls | pending the key |

### Harness check with the mock model (`tools/evals/reports/mock-oracle/report.md`)

The oracle answers `tutor.analyze` with the label, `reader.disambiguate` with the gold reading when it is among the listed readings, and `tutor.reply` with a short question. These are **upper bounds set by the data and the code around the model**, not model scores:

| Metric | Dataset size | Value | What it shows |
|---|---:|---|---|
| Recall after verification, perfect reports | 300 | 100.0 % | Verification keeps every correct report of an injected error |
| False corrections, perfect reports | 300 | 0.0 % | |
| Analyzer case accuracy, perfect model picks | 2,158 known words | **98.1 %** | The ceiling: 41 words are wrong before the model is asked |
| of which `single` (one reading in the data) | 397 | 95.5 % | Proper names the data reads as another word (*Maja* as genitive of *máj*) |
| of which `rule` | 537 | 98.1 % | Numerals in the accusative (*osem*, *šesť*, *desať*, *mnoho*, *zopár*) are narrowed to the genitive by a rule |
| Known words | 4,558 | 97.6 % | 111 words unknown, almost all foreign proper names |

So the 95 % target leaves the model about three points of room below the ceiling. Two fixes outside the model would raise the ceiling (B3's rules, not in this package): keep a counting numeral's own case, and do not trust a single reading of a capitalised word that the data knows only as a common noun.

Planted mistakes land where they should (tested in `run.test.ts`): a false report on every correct sentence shows as 100 % before verification and 0 % after (some dropped as `given_equals_expected` or `given_valid_for_case`, the rest left unverified and so never shown); missed labels lower recall before and after verification alike; wrong picks lower the `model` row.

## Cost of the full live eval (dry run, nothing sent)

`pnpm --filter @app/evals run evals estimate` (`tools/evals/reports/estimate.md`). Prices of B8's table: Claude Opus 5.5 $4 input, $20 output, $0.20 cache read per million tokens (Sonnet 5.5 half). Tokens are UTF-8 bytes / 3, as the batch runner counts; output per call is an assumption (`EXPECTED_OUTPUT`: 900 for an analysis at medium effort with its thinking, 250 for a reply, 150 + 20 per word for disambiguation, never above the call's token limit). The prompts in use are below the cacheable minimum, so no cache reads are counted.

| Route | Model | Requests | Estimate | At most |
|---|---|---:|---:|---:|
| `reader.disambiguate` | claude-opus-5-5 | 57 | $2.60 | $2.61 |
| `tutor.analyze` | claude-opus-5-5 | 600 | $17.81 | $31.01 |
| `tutor.reply` | claude-opus-5-5 | 600 | $6.13 | $51.13 |
| `reader.disambiguate` | claude-sonnet-5-5 (comparison) | 57 | $1.30 | $1.31 |
| `tutor.reply` | claude-sonnet-5-5 (comparison) | 600 | $3.06 | $25.56 |
| **Total** | | **1,914** | **$30.90** | $111.62 |

"At most" assumes every call uses its whole token limit. A first run of 25 cases per set (`--limit 25`) is 156 requests, about $2.43.

## Prompt versions in use and their scores

| Route | Version | Owner | Scores |
|---|---|---|---|
| `tutor.analyze` | v1 | B9 | not measured yet (no key) |
| `tutor.reply` | v1 | B9 | not measured yet |
| `reader.disambiguate` | v1 | B3 | not measured yet |

Every report records the version of each route it ran (`promptVersions()` of `@app/ai`), and the cache key holds the whole request, so a new version is a new set of requests and its answers never mix with the old version's. When a version is scored, add its row here with the report's figures; keep old rows.

## How to run

All commands from the repository root. None sends a request unless `--mode live` is given with a key.

```sh
# Once: the inputs (local copies of the raw data, see content/SOURCES.md)
pnpm run pipeline fetch --source snk-morphology,ud-slovak-snk,araneum-arf,frequencywords
pnpm run pipeline morph
pnpm run pipeline freq            # ranks; optional, but the analyzer orders readings by them

# Datasets (committed; rebuild only after changing the injection or the selection)
pnpm --filter @app/evals run evals build

# The harness with the mock model (seconds, no key)
pnpm --filter @app/evals run evals run --mode mock

# The cost of the full live eval, with the comparison (nothing sent)
pnpm --filter @app/evals run evals estimate

# Live, once the key exists and the spend is approved. The run estimates first and refuses
# to start above --max-spend (default $5); the same cap stops calls during the run.
ANTHROPIC_API_KEY=… pnpm --filter @app/evals run evals run --mode live --limit 25 --max-spend 3
ANTHROPIC_API_KEY=… pnpm --filter @app/evals run evals run --mode live --max-spend 35

# Repeat any run from the cached answers (no key, no cost)
pnpm --filter @app/evals run evals run --mode replay

# The cheaper model on tutor.reply and reader.disambiguate, then the side by side
ANTHROPIC_API_KEY=… pnpm --filter @app/evals run evals run --mode live --max-spend 6 \
  --model tutor.reply=claude-sonnet-5-5 --model reader.disambiguate=claude-sonnet-5-5 \
  --out tools/evals/reports/sonnet
pnpm --filter @app/evals run evals compare tools/evals/reports/latest/report.json tools/evals/reports/sonnet/report.json
```

Options of `run`: `--suite all|tutor|analyzer`, `--limit N` (first N cases of each set), `--no-replies` (skip `tutor.reply`), `--concurrency N` (default 4), `--per-text N` (analyzer sentences per text, default 10), `--cache DIR`, `--out DIR`, `--data DIR`, `--lexicon build|mini`.

**Cached answers.** Live answers go to `tools/evals/cache/<route>.jsonl`, one line per request, keyed by a hash of everything the model sees (route, model, token limit, system blocks, messages, output schema). Commit the cache with the report: `--mode replay` then rebuilds the same report anywhere, and a later live run only pays for requests that changed. Refusals, cut off answers and answers that break the schema are cached too (the same request gets the same answer); outages are not. Mock answers never enter this cache. Reports of live and replay runs go to `tools/evals/reports/latest/` (`report.md`, `report.json`, `tutor-cases.jsonl`, `analyzer-words.jsonl`); mock and dry runs to `content/build/evals/<mode>/`.

## What remains for the live run

Prompt tuning against the real model is out of reach without the key. Once it exists and the spend is approved:

1. Run `pnpm --filter @app/ai run smoke` once (B8's check of the key and the wiring).
2. Live run with `--limit 25 --max-spend 3` (about $2.43). Read `tools/evals/reports/latest/tutor-cases.jsonl`: are the misses real misses, or sentences the injection made grammatical? Check the measured output tokens and delay against the estimate's assumptions (`EXPECTED_OUTPUT`), and whether `reader.disambiguate` answers are cut off (its token limit is 256 + 16 per word with adaptive thinking on; a cut off batch turns every word in it into a guess, visible as `guess` in the method split).
3. Full live run (about $26.54 for the base run; raise `--max-spend` to the approved amount). Commit `tools/evals/cache/` and `tools/evals/reports/latest/`, and fill in the results and prompt version tables above.
4. Where a target is missed: write `v2` of the prompt in its folder as a small pull request to its owner (B9 for `tutor.*`, B3 for `reader.disambiguate`), rerun (only the changed route is paid for), and record both versions with their scores here. Do not tune on cases a person marked as bad labels.
5. The cheaper model comparison on `tutor.reply` and `reader.disambiguate` (about $4.36), then `compare`. The choice of model stays with the owner of the app; setting it is `AI_MODEL_TUTOR_REPLY` / `AI_MODEL_READER_DISAMBIGUATE`.
