# Sources

Raw data the content pipeline reads. `pnpm run pipeline fetch --source <id>` places a source in
`content/raw/<id>/` (not in git) and records it in the table below: where it came from, when,
its size, its sha256 checksum and its licence as the source states it. The catalog of sources is
`tools/pipeline/src/lib/sources.ts`.

The SNK morphological database and the Araneum lists may be used for personal study; ask their
institutes before any public release (docs/architecture.md, "Licences").

The files below were first fetched on 2026-11-17 as copies of the project's shared download
folder (`/mnt/project-files/raw-data/`, downloaded the same day from the URLs listed); `fetch`
prefers such a local copy (`--from <dir>` or `PIPELINE_RAW_FROM`) and otherwise downloads.

## Fetched files

<!-- fetched:begin (written by `pnpm run pipeline fetch`; edit above or below) -->
| Source | File | URL | Fetched | Bytes | sha256 | Licence |
|---|---|---|---|---:|---|---|
| araneum-arf | dataset-arf-araneum-slovacum-vii-lemma-pos.tsv.xz | https://www.juls.savba.sk/data/aranea-arf/dataset-arf-araneum-slovacum-vii-lemma-pos.tsv.xz | 2026-11-17 | 127,797,192 | `7b8ec66ad0a956da0421954ac733eeb564e783d32ff99a4ff99e390407ed5b7c` | No licence stated. Ask JÚĽŠ before a public release. |
| araneum-arf | dataset-arf-araneum-slovacum-vii-word-tag.tsv.xz | https://www.juls.savba.sk/data/aranea-arf/dataset-arf-araneum-slovacum-vii-word-tag.tsv.xz | 2026-11-17 | 196,867,656 | `a5d5ced3b8381234b4ed7e3fc8c3d9927a49793dfb6947e8954b890982ada235` | No licence stated. Ask JÚĽŠ before a public release. |
| araneum-arf | dataset-arf-araneum-slovacum-vii-word.tsv.xz | https://www.juls.savba.sk/data/aranea-arf/dataset-arf-araneum-slovacum-vii-word.tsv.xz | 2026-11-17 | 125,220,784 | `6453025d9fb6d9b412ee2101951672861ad9e5224788f93003791eb5e962f58c` | No licence stated. Ask JÚĽŠ before a public release. |
| frequencywords | LICENSE | https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/LICENSE | 2026-11-17 | 1,068 | `e08d916cc953f85f7dfa0df530f6d7931f14ce804d053602662d8649b5fac829` | CC BY-SA 4.0 for the content (MIT for the code). Credit the source. |
| frequencywords | sk_50k.txt | https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/sk/sk_50k.txt | 2026-11-17 | 619,553 | `10eddbcd086ff26a814a140e1d5b20a1ba0ee8b0870be1a9a09268ba7aeaa094` | CC BY-SA 4.0 for the content (MIT for the code). Credit the source. |
| frequencywords | sk_full.txt | https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/sk/sk_full.txt | 2026-11-17 | 9,322,984 | `83e57bd891ba644afee82cddcb8cdc209df2b69bdb6c6771a83907f490348632` | CC BY-SA 4.0 for the content (MIT for the code). Credit the source. |
| kaikki-wiktionary | kaikki.org-dictionary-Slovak.jsonl | https://kaikki.org/dictionary/Slovak/kaikki.org-dictionary-Slovak.jsonl | 2026-11-17 | 57,679,634 | `3bdaf508a2ba385e629316c49905bf3f533af9361a5a90e6ae3dd802e69bb805` | CC BY-SA 4.0 and GFDL (Wiktionary). Credit the source and share alike. |
| snk-morphology | ma-2015-02-05.txt.xz | https://korpus.sk/wp-content/uploads/uploaded/documents/databases/morfologicka_databaza/ma-2015-02-05.txt.xz | 2026-11-17 | 6,914,520 | `1367796465abb0262019fb2c112d33ed45584efd3e8fc989a93dbd4efb388753` | Research purposes only, under GNU AGPL v3, CC BY-SA 4.0 or GNU FDL 1.3. Ask the institute before a public release. |
| snk-morphology | tagset-www.pdf | https://korpus.sk/wp-content/uploads/uploaded/documents/databases/morfologicka_databaza/tagset-www.pdf | 2026-11-17 | 127,907 | `0dbd76fecd6048fc222c6eee205f84519fcff5a1797bb5d48d172bdc9176156b` | Research purposes only, under GNU AGPL v3, CC BY-SA 4.0 or GNU FDL 1.3. Ask the institute before a public release. |
| tatoeba | eng-slk_links.tsv.bz2 | https://downloads.tatoeba.org/exports/per_language/eng/eng-slk_links.tsv.bz2 | 2026-11-17 | 176,409 | `213d7d50465c04f948dcb6b9dd60ce960866ab4ce49e935d831eecfe75b1017e` | CC BY 2.0 FR. Credit the source. |
| tatoeba | eng_sentences.tsv.bz2 | https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2 | 2026-11-17 | 24,947,715 | `3b5b3ecfcac5037b09f81ef048fa16fedc4d24838db5b6fbeedca1dfab374cbf` | CC BY 2.0 FR. Credit the source. |
| tatoeba | slk-eng_links.tsv.bz2 | https://downloads.tatoeba.org/exports/per_language/slk/slk-eng_links.tsv.bz2 | 2026-11-17 | 176,505 | `f33f14b5b5501304d67b4139db4c56910fa962954406f3249a0c003ed10b7163` | CC BY 2.0 FR. Credit the source. |
| tatoeba | slk_sentences.tsv.bz2 | https://downloads.tatoeba.org/exports/per_language/slk/slk_sentences.tsv.bz2 | 2026-11-17 | 372,830 | `f4d052420454de72c636a048b61212a0852e05416f8388baeb38c2da8a74117f` | CC BY 2.0 FR. Credit the source. |
| ud-slovak-snk | LICENSE.txt | https://raw.githubusercontent.com/UniversalDependencies/UD_Slovak-SNK/757c74c7c78ef427dde3a11553e22280e257c09a/LICENSE.txt | 2026-11-17 | 202 | `899b1804a12ebc090b96339614eede1b64b686721b650a71430b55b5235f7f79` | CC BY-SA 4.0. Credit the source. |
| ud-slovak-snk | sk_snk-ud-dev.conllu | https://raw.githubusercontent.com/UniversalDependencies/UD_Slovak-SNK/757c74c7c78ef427dde3a11553e22280e257c09a/sk_snk-ud-dev.conllu | 2026-11-17 | 1,202,759 | `5660577846d500db86ab139618518d106e0191a100155ee4e7d37254d6036819` | CC BY-SA 4.0. Credit the source. |
| ud-slovak-snk | sk_snk-ud-test.conllu | https://raw.githubusercontent.com/UniversalDependencies/UD_Slovak-SNK/757c74c7c78ef427dde3a11553e22280e257c09a/sk_snk-ud-test.conllu | 2026-11-17 | 1,215,043 | `3cdd11080a868685cf1fd5d20274603754aea00930847130c5d9e1b90ff5136b` | CC BY-SA 4.0. Credit the source. |
| ud-slovak-snk | sk_snk-ud-train.conllu | https://raw.githubusercontent.com/UniversalDependencies/UD_Slovak-SNK/757c74c7c78ef427dde3a11553e22280e257c09a/sk_snk-ud-train.conllu | 2026-11-17 | 7,626,608 | `086b3ec1b48bc5942ac42ae274d9a26a75633152b1d444c649369aa4faa5d825` | CC BY-SA 4.0. Credit the source. |
<!-- fetched:end -->
