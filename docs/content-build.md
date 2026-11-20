# The content build

How the full content set is built, how its model written parts were made without the API, what the build of 2026-11-20 holds against its targets, how it was checked and what is still open (work package I2).

## The build in one page

The pipeline (`tools/pipeline`) turns the downloaded sources and the authored files into a content set, checks it and loads it. Every stage is run as `pnpm run pipeline <stage>` from `tools/pipeline`; a stage whose inputs did not change is skipped.

| # | Stage | Makes | Model routes |
|---:|---|---|---|
| 1 | `fetch` | the sources in `content/raw/` | |
| 2 | `morph` | lemmas, forms and patterns from the SNK morphology | |
| 3 | `freq` | the frequency rank of each lemma and its most used forms | |
| 4 | `dict` | the dictionary: Wiktionary senses, generated glosses, the editor's list | `content.glosses` |
| 5 | `sentences` | example sentences from Tatoeba, the treebank and writers | `content.sentences`, `content.review`, `content.translate` |
| 6 | `triggers` | the words that govern a case | |
| 7 | `lessons` | the declension lessons | |
| 8 | `exercises` | declension exercises | `content.exercises`, `content.exercises.review` |
| 9 | `scenarios` | the tutor's scenarios | |
| 10 | `library` | the reading texts with their review and analysis | `content.review` |
| 11 | `validate` | the assembled set in `content/build/set/` and every check | |
| 12 | `load` | the set in the database, with a new content version | |
| 13 | `analysis` | the word by word analysis of the reading texts, with the analyzer of `apps/api` | `reader.disambiguate`, `reader.gloss` |
| 14 | `audit` | the review reports: a second pass over a random sample | `content.audit.sentences`, `content.audit.exercises`, `content.audit.glosses` |

What a model wrote is kept in git, so a rebuild needs no model call:

| File | Holds |
|---|---|
| `content/generated/glosses.jsonl` | generated glosses |
| `content/generated/sentences.jsonl` | generated example sentences and translations of treebank sentences |
| `content/generated/exercises.jsonl` | declension exercises |
| `content/generated/library-reviews.jsonl` | the review of each reading text |
| `content/generated/library-analysis.jsonl` | the analysis of each reading text |

What an editor decided is kept beside it, each row with its reason:

| File | Holds |
|---|---|
| `content/authored/glosses/overrides.yaml` | dictionary entries as they must read: the glosses of a lemma, their order and their notes |
| `content/authored/sentences/excluded.yaml` | real sentences that must not become examples |
| `content/authored/sentences/translations.yaml` | corrected English of real sentences whose Slovak is good |

`content/raw/` and `content/build/` are not in git.

### A complete rebuild

```sh
export PATH=/opt/node24/bin:$PATH
cd tools/pipeline
pnpm run pipeline fetch          # or copy the sources into content/raw/
for s in morph freq dict sentences triggers lessons exercises scenarios library validate; do
  pnpm run pipeline $s || break
done
pnpm run pipeline load --pglite /tmp/content-db     # or DATABASE_URL=... pnpm run pipeline load
```

`validate` takes about 30 s and `load` about 60 s into an empty PGlite database. `analysis` and `audit` come after a load and only when their inputs changed, see below.

### After a change

| Changed | Run again |
|---|---|
| `content/authored/glosses/overrides.yaml` or `glosses.jsonl` | `dict`, `validate`, `load`, then `analysis --all` (an analysis row carries the dictionary entries of its lemmas), `library`, `validate`, `load` |
| a reading text | `library --fill …` (its review), `validate`, `load`, `analysis --fill …`, `library`, `validate`, `load` |
| the analyzer rules in `apps/api/src/modules/analyzer` | `analysis --all`, `library`, `validate`, `load` |
| `content/authored/sentences/excluded.yaml`, `translations.yaml` or a row of `sentences.jsonl` | `sentences` (with `--fill …` when it has to choose a new treebank sentence or lacks a sentence for a lemma), `validate`, `load` |
| anything a sampled item shows | `audit --fill …` asks again only for the requests whose items changed |

## Writing the model's part without the API: the offline fill

The model stages take `--fill none|dry-run|mock|live|offline`. `live` sends the requests through the Batch API. `offline` does the same work without it:

1. `pnpm run pipeline <stage> --fill offline --answered-by <writer>` writes every request it would send as a file, `content/build/model-requests/<stage>/<route>/<hash>.json`, and sends nothing.
2. A writer reads the request and puts the answer in `content/build/model-answers/<stage>/<route>/<hash>.json`.
3. The next run of the same command checks each answer exactly as it checks an API answer (the schema, then the rules of the task), accepts the valid ones with `model` set to the writer's name, and leaves in the request folder what is still open.

The helper `pnpm --filter @app/pipeline run offline <command>` shows requests in a readable form and checks answer files before a stage reads them (`list`, `show`, `lint`, `hints`, `slots`, `put`, `skip`, `word`, `forms`; see the head of `tools/pipeline/src/offline/cli.ts`). The guides in `tools/pipeline/src/offline/guides/` say for each route what a good answer is; `common.md` is for every writer.

The whole fill of this build was made this way, in working sessions, with `--answered-by claude-code-session`. Nothing was sent to the API.

Rules that kept the fill sound:

- A stage is never run while writers of that stage are at work: a run moves requests.
- Who writes does not check. Sentences, exercises and reading texts went through the pipeline's own review routes, answered by another reader than the writer; the audit is a further pass by readers who saw neither. An entry or a translation the editor wrote while judging the readers' remarks was read by a further reader as well.
- An answer is never mended inside the cache. A wrong answer is replaced in the answers folder and the stage accepts it again.
- A writer who cannot write a natural sentence for a form answers `SKIP`; the slot stays open and is reported.

## What the build holds

Content version `2026-11-20.8`, built on 2026-11-20. `validate` passes with one warning (the lemma without sentences, below).

| | Target | Built | |
|---|---:|---:|---|
| Lemmas ranked up to 3,000 with a gloss | 3,000 | 3,000 | 1,290 entries from Wiktionary, 1,710 written |
| Lemmas ranked up to 3,000 with two sentences | 3,000 | 2,999 | one shortfall, see below |
| Exercises for each bucket | 40 | 52 to 98 | 3,153 exercises in 44 buckets |
| Triggers | 200 | 221 | 119 verbs, 60 prepositions, 14 question words, 9 numerals, 7 quantity words, 6 adjectives, 6 nouns |
| Scenarios | 12 | 12 | 8 scenarios and 4 case coach sets |
| Reading texts | 12 | 12 | all reviewed and analysed |

The whole set: 100,681 lemmas, 1,072,858 forms, 13,359 senses for 10,560 lemmas (every lemma ranked up to 5,000 has an entry), 8,031 sentences with 8,679 links to lemmas, 221 triggers, 17 patterns, 9 lessons, 3,153 exercises (2,221 cloze, 780 choice of form, 152 choice of meaning), 12 scenarios, 12 texts.

**The shortfall.** `video` (adjective, rank 1,957) has no example sentence. The morphology lists it as an indeclinable adjective; standard Slovak writes it as part of a compound (`videohra`, `videozáznam`), so no natural sentence shows it as a word of its own. Its request is answered with `SKIP`, and `validate` reports it as its one warning. Two more requests were answered with `SKIP` on the way (`najviac` and `trochu` as numerals in a genitive and an instrumental that no natural sentence shows); both lemmas have their sentences from other forms.

## Cost

The estimate is what `--fill dry-run` printed for each stage before the fill, at the batch prices of the pipeline's model. The fill was written offline, so nothing was spent.

| Stage | Requests | Estimate | Spent |
|---|---:|---:|---:|
| `dict`: glosses | 129 | $1.66 | $0 |
| `sentences`: writing, review, translation | 309 | $15.11 | $0 |
| `exercises`: writing and review | 308 | $8.08 | $0 |
| `library`: reviews | 12 | $0.31 | $0 |
| `audit`: the second pass | 12 | $0.97 | $0 |
| `analysis`: readings and glosses of the texts | 36 | not priced | $0 |
| In all | 806 | $26.13 and the analysis | $0 |

The analysis stage counts its requests but has no price estimate. Requests that were asked again after a rejection or after a correction are not in the table (the later rounds of sentences and of the audit), and neither are the readings that are no route of the pipeline: the readers of the dictionary entries, of the real sentences and of the analysed texts worked from lists made for them.

## How each part was made and checked

### Dictionary

- **Written glosses.** 3,203 of the 5,000 ranked lemmas have no usable Wiktionary entry (1,710 of the top 3,000). Their glosses were written in 129 requests of 25 words; 43 more were written for words of the reading texts that no entry covered.
- **Every imported entry was read.** The import keeps the first three senses in Wiktionary's own order, which is often not the order of use (`sobota` showed "Sabbath" before "Saturday"). All 1,839 imported entries of the 5,000 ranked lemmas and of the words of the reading texts were read against the short dictionary of Slovak (KSSJ): first the 1,353 entries of the top 3,000 lemmas and of the texts, by eleven second readers (539 corrected), and after the review reports the 486 entries of ranks 3,001 to 5,000, by four more (179 corrected: `oceľový` was "steal", `výtvarný` "creative", `prízemie` "groundfloor").
- **Every verb entry was read for `sa` and `si`.** The app lists a verb without `sa` or `si` (`snažiť` for `snažiť sa`), and the written entries glossed the reflexive meaning without a mark: a learner who reads "snažiť: to try" learns a verb that does not exist. The review reports showed it (`strácať`, `nazývať`). All 869 written verb entries of the 5,000 ranked lemmas were read by a reader and then by a second reader (296 changed), and the 135 imported verb entries without such a note by one reader (21 changed). A meaning that needs the word now says so in its note: `with sa`, `with si`, `often with si`, with a short example where the pattern needs one (`páčiť`: "with sa: páči sa mi to"), and "with sa when the thing itself opens: dvere sa otvorili" where English has one verb for both. 376 verb entries of the editor's list carry such a note.
- **The editor's list.** The corrections stand in `content/authored/glosses/overrides.yaml`, which `dict` reads: the entry of a lemma named there shows exactly the listed glosses, in that order, each with its note and a line that says what was wrong. The list has 1,048 entries (539 from the first reading, 314 more after the verb entries and the second round of review reports, 192 more after the last reading, 3 more after the third round; 22 entries were corrected a second time). 1,217 senses of those entries keep the wording of their source, 685 are new (source `manual`). 1,028 of the 5,000 ranked lemmas show a corrected entry, 728 of the top 3,000.
- **The editor's own wording was read too.** The editor judged every proposal of the readers. Where the entry that stands is the editor's wording and not a reader's (47 entries), a further reader checked it: 45 are fine, 2 were mended (`sa` lacked its passive and impersonal use, a note of `rozhodnúť` was too strict).
- **The import was mended** for 931 lemmas: a gloss with nested brackets was cut in the middle, and an empty label was kept as a note.

### Example sentences

A lemma ranked up to 3,000 gets two or three short sentences (4 to 12 words). Each shows one of the lemma's most used forms, and every other word of it is a lemma ranked up to 3,000 as well.

- **Real sentences first.** Of 13,870 Tatoeba sentences with an English translation and 6,349 treebank sentences, 5,158 and 637 pass the rules. The stage chose 1,789 and 501 of them, the easiest first and different forms first. The treebank has no English, so the translations of its sentences were written (`content.translate`).
- **Written sentences for the rest.** 2,099 lemmas have a written sentence. The writers wrote 5,783 candidates. Each was checked by the rules (the form asked for stands in the sentence and can be read as that form, every word is known and common) and then read by a second reader (`content.review`), who rejected 34. One rejection was itself wrong: the reader took `člen` "grammatical article" for the other entry `člen` "member", because the review request does not show the meaning of the lemma. Its three sentences went through a second review with the meaning stated and passed.
- **Read again after the dictionary corrections.** The first corrections changed the entries of 246 lemmas with written sentences. The 102 that lost a meaning word of their earlier entry were read again against their sentences, and so were all 64 spellings that stand for several entries (132 lemmas, 382 linked sentences). Six written sentences stood under the wrong entry (`zatiaľ` as an adverb under the conjunction three times, `skoro`, both entries of `duch`). They are removed, and twelve new sentences were written and read by a second reader.
- **Every real sentence was read.** The sentences from Tatoeba and the treebank had been chosen by rules and never read, and the reading above had found wrong case labels among them. Eight readers read all 2,336 with their English and with the grammar shown for each taught word: 2,199 are fine, 95 got a remark, 42 were wrong. The editor judged every remark:
  - 63 sentences went on the list of exclusions with their reasons: Slovak written by learners, word for word calques, a missing comma or a typing error, fragments, and treebank labels that would mislead.
  - 60 sentences whose Slovak is good keep their place with corrected English (`content/authored/sentences/translations.yaml`): translations made through a third language ("here" for `tam`), and loose ones that hid the very word the sentence is shown for.
  - The wrong case labels came from three faults of the stage's rules, see below.
- **The sentences that came after the reading were read as well.** The stage chose anew: 11 treebank sentences got a translation, and 43 sentences were written for the 21 lemmas left short, of which a second reader accepted 42. A further reader then read the 103 real sentences that were new, had new English or taught one more word: 100 fine, 2 remarks, 1 wrong. The remarks led to two dictionary entries (`viesť` "to keep a diary", `za` with the idiom "čo je to za …?"); the wrong one and a later replacement that could be read two ways are excluded. The last replacement was read by one more reader.
- **Five faults of the stage** came out in these readings and are mended, each with a test:
  - A treebank sentence that Tatoeba has too was kept twice; 114 repeats are now left out.
  - The plural in -ov of an animal noun (`psov`) was read as a genitive only, so `Mám doma dvoch psov` was shown as an example of the genitive; it is an accusative.
  - A preposition gave its case to every following word that could agree with something. The phrase now ends where the agreement ends.
  - A personal pronoun (`on`, `ona`, `oni`) was read like an adjective: it took the case of the noun beside it and gave its own to adjectives. It now neither modifies nor is modified, and after a preposition only the forms that begin with n are the pronoun, so `jej`, `ich` and `jeho` there are the possessives.
  - A word in capitals (`DNA`) was read as a form written small (`dna`, of `dno`). A word of several capitals is now an abbreviation.
- **67 real sentences are left out by hand and 61 show corrected English**, each with its reason, in `content/authored/sentences/`. The last corrected translation came from the third round of the review reports.

The set holds 8,031 sentences with 8,679 links to lemmas: 1,789 from Tatoeba, 501 from the treebank and 5,741 written. 2,681 of the 3,000 lemmas have three sentences.

### Exercises

3,153 exercises fill the 44 buckets of the nine lessons, at least 52 in each. Every exercise was written for one slot (a lemma, a case, a number, a trigger), checked by the rules (the answer is the form the morphology gives for that slot, one option is right, every option is a real form) and then read by a second reader, who rejected 52. The second pass later found one phrase that is not Slovak (`po poradí` for `po poriadku`); the exercise is removed. The stage stored an answer that opens a later sentence of its text in lower case ("Koho hľadáš? Klienta."); the rule is mended and 79 stored exercises were repaired.

### Reading texts

The twelve texts are reviewed by the route `content.review`; all twelve pass. The shopping text (`lib-002`) was revised first: three phrases a native reader would not write.

**The analysis** is the one the app's reader shows: for every word its lemma, its case, number and gender or its verb form, the word that asks for the case, and the dictionary entry. The stage runs the analyzer of `apps/api` over each text and stores the result, so the app does not analyse the library texts on first use.

| How a word got its reading | Words |
|---|---:|
| the morphology has one reading | 610 |
| the analyzer's rules left one | 455 |
| chosen by the readers | 1,447 |
| guessed | 0 |
| In all | 2,512 |

The 1,447 choices were made twice, by two readers who did not see each other's answers:

| | Words |
|---|---:|
| both readers chose the same reading | 1,382 |
| they differed and the difference was settled (4 for the first reader, 10 for the second) | 14 |
| they agreed, and the choice was overruled: both had followed a list of readings that an earlier version of the rules had cut wrongly | 17 |
| decided without an earlier choice, after the rules changed the list of readings | 34 |

**The last check.** Four further readers then read every word of every text with everything the reader shows for it. They found no wrong case, number, gender or verb form in the 2,512 words, and 65 other things:

| Finding | Count | What was done |
|---|---:|---|
| the word named as the reason for a case is wrong | 50 | the rule was rewritten, see below: 43 are gone, 4 now name the right verb, 3 are left |
| the lemma: `už` twice and `ešte` once are adverbs, not particles | 3 | changed |
| the lemma: a negated verb is filed under a lemma of its own (`nemám` under `nemať`) | 4 | the morphology does so throughout; open |
| the lemma or gender of a word the morphology has wrong or lacks (`Košice` as neuter three times, `Dunčo`, `e-maily`, the comparative `lepšie`) | 6 | open, see the handoff note |
| the reader was not sure (`A` at the start of a question, `menej`) | 2 | left |

**The word that asks for a case.** The reader shows for a word in a case the word that is the reason for it. For verbs the analyzer named any verb between two punctuation marks that has a rule for the case, which is often the wrong verb in a long sentence. The rule now works clause by clause (`assignTriggers` in `apps/api/src/modules/analyzer/rules.ts`; the readings a word keeps, and with them the evals, do not change). It was measured against the trees of the Slovak treebank, on the 6,418 sentences in which every word has its treebank reading in the data:

| | Reasons given | Right | Wrong | Share right |
|---|---:|---:|---:|---:|
| before | 3,852 | 3,301 | 521 | 85.7 % |
| now | 3,692 | 3,616 | 64 | 97.9 % |

The rest of each row are words that hang on the named verb in the treebank, but not as its object (30 before, 12 now). In the twelve texts 47 of the 50 wrong reasons are mended, 21 right ones are new and none is lost. The three that are left: `číslo` and `tri` after `Je` in one sentence of `lib-006`, and `niekoľko` after `na` in `lib-011`.

## The review reports

The `audit` stage draws a random sample of the finished set (seed `i2`: 100 example sentences, 100 exercises, 100 dictionary entries of the top 3,000 lemmas) and gives it to a second pass: readers who made none of the items and saw none of the earlier checks. `wrong` means a learner would learn something false, `minor` that nothing is false but the item should be better. The reports are `content/build/audit/report.md` and `for-you.md`, the thirty items for a person. A sampled item keeps its place from run to run, so a later round reads the same sample as it then stands; only requests whose items changed are asked again.

The pass ran four times. What the first three rounds found was mended before the next; what the fourth found stands in the set and is listed below.

| Round | Set | Sentences: ok / minor / wrong | Exercises | Dictionary entries |
|---|---|---|---|---|
| 1 | before the dictionary corrections | 99 / 1 / 0 | 98 / 2 / 0 | not yet sampled |
| 2 | `2026-11-20.4` | 98 / 1 / 1 | 100 / 0 / 0 | 93 / 6 / 1 |
| 3 | `2026-11-20.6` | 98 / 2 / 0 | 100 / 0 / 0 | 96 / 4 / 0 |
| 4 | `2026-11-20.8`, the set of this build | 100 / 0 / 0 | 100 / 0 / 0 | 100 / 0 / 0 |

No exercise changed after round 2, so rounds 3 and 4 carry its verdicts for the exercises. Round 3 read all sentences and all entries anew. Round 4 read all sentences anew (the wording of a label had changed in every request) and the 44 entries of the two requests that hold a mended entry; the other 56 entries carry their verdicts of round 3.

**Round 1** read sentences and exercises and called none wrong. Its remarks led to the repair of 79 stored exercises (an answer that opens a later sentence of its text was stored in lower case), to the removal of one exercise (`po poradí` is not Slovak) and to one excluded sentence.

**Round 2** was the first with dictionary entries. Each finding was mended, and each was also taken as a sign of what else might be wrong in the part it came from:

| Finding | Mended | What else it led to |
|---|---|---|
| `koní` shown as a form of `kôň` "masculine inanimate" (wrong) | the morphology files the plural of an animal noun as a second, inanimate lemma; the entries of the three such lemmas with a rank (`pes`, `kôň`, `vták`) now say what the label means | a note in the handoff: 526 such pairs in the morphology |
| `Bolia ma prsia …` reads as sore breasts (minor) | the sentence is removed | the reading of every real sentence (above) had the same cause: sentences nobody had read |
| `čím` as a conjunction glossed "whereby" (wrong) | entry corrected | the 26 entries the editor wrote in this round were read by a further reader |
| `strácať`, `nazývať`: a meaning that needs `sa` without a mark (minor, twice) | entries corrected | every verb entry was read for `sa` and `si` (above): 317 entries changed |
| `odviezť`, `vyjsť`, `vážený`, `kreslo`: a vague first gloss, a missing common meaning, a definition as a note (minor) | entries corrected | the imported entries of ranks 3,001 to 5,000, which nobody had read, were read (above): 179 corrected |

**Round 3** read the sample on the set as it stood after all of that. Nothing was wrong, and six things were small:

| Finding | Mended |
|---|---|
| `Povedala mi, že bola zvedavá.` beside "She told me that she was curious." (Slovak keeps the tense of the reported words, so `bola` is "had been") | a corrected translation |
| `oceníte` labelled "present tense" beside "you will appreciate" | the label was the pipeline's own wording of the tag: it now reads "present form of a perfective verb (future meaning)" |
| `bezpečie`: "shelter" as a second meaning suggests a built refuge | "safety, security" |
| `orgán`: "organ" alone also reads as the instrument, which is the other word `organ` | "organ (of the body)" |
| `komentár`: "commentary" was missing | added |
| `k`: only the direction was given | "for" an occasion (`k narodeninám`) and "as of" a date added |

Round 2 had passed all four entries as they stood. Two are written entries, which had no reader of their own (`k`, `orgán`); one is an imported entry that its reader had passed (`komentár`), and one had already been corrected once (`bezpečie`). A second reading of the same hundred entries thus found small things the first had passed (a missing second meaning, a gloss that needs a note), though nothing false: one reading does not exhaust an entry.

**Round 4** read the set of this build and made no remark. Its readers named what they had weighed and passed, and none of it is changed:

- English that is literal but right: "the first league" (`do prvej ligy`), "the monthly payment for the internet", "the number of dead after the explosion", and "this crazy idea" for `taký šialený nápad`.
- A gloss that covers the use only loosely: `pošta` "mail (parcels and letters)" in `elektronickú poštu`, `nad` "above, over" in `nad tým premýšľam`, and the note of `nielen` ("not only … but also") beside the proverb `Nielen chlebom je človek živý`.
- Dictionary entries: `prehliadka` shows "tour" before "check-up, inspection", `doktor` has "doctor, PhD" as its second gloss, `priestor` says "space" alone.

**What the reports say about the rest.** The second pass is a sample: 100 of 8,031 sentences and 100 of 3,000 entries say how good the rest is likely to be, not that it is free of faults. The sampled items were mended three times, so the clean fourth round describes the sample more than the set. The third round is the better measure of the set as it stands: of a hundred entries that had passed every earlier check, a fresh reader found four that could be better and none that was wrong, and of a hundred sentences two and none. By that measure about one entry in twenty-five of the top 3,000 would still get a small remark. No wrong item in a hundred allows up to about three in a hundred in the whole set (at 95 % confidence), and a reader counts only what a reader notices.

Nobody has read the content as a person yet; `for-you.md` is the place to start.

## Database size

Measured after a load into an empty PGlite database, which stores tables as Postgres does (`pg_total_relation_size`):

| Table | Rows | Table MB | Indexes MB | Together MB |
|---|---:|---:|---:|---:|
| `ling.form` | 1,072,858 | 78.0 | 85.4 | 163.4 |
| `ling.lemma` | 100,681 | 12.0 | 13.0 | 25.0 |
| `ling.sentence` | 8,031 | 5.9 | 0.3 | 6.2 |
| `ling.exercise` | 3,153 | 2.7 | 0.2 | 2.9 |
| `ling.sense` | 13,359 | 0.9 | 0.3 | 1.3 |
| `ling.lemma_sentence` | 8,679 | 0.6 | 0.5 | 1.1 |
| every other table | | | | under 1 |
| The content in all | | | | 200.6 |

The free plan of Supabase allows 500 MB. The content takes two fifths of it, inside the 180 to 210 MB the architecture expected for the forms alone, so the load needs no rank limit. What Supabase itself keeps and what learners write come on top.

## What is open

- **The load into the development database.** This build was loaded into PGlite only. The real load is `DATABASE_URL=… pnpm run pipeline load` from `tools/pipeline` after the rebuild above; it needs the database secret, which this work did not have. After it the preview deployment should report the new content version, and the smoke script should pass against it.
- **`video` (adjective)** has no sentence, see above.
- **Faults of the morphology** that the texts showed, each listed in `docs/handoff/I2.md`.
- **Thirty items for a person**: `content/build/audit/for-you.md`, written by the `audit` stage.
