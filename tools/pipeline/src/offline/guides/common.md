# Offline fill: what every writer and reviewer needs

You answer requests of the content pipeline that would otherwise go to the model API. A request is a file; your answer is a JSON file in the answers folder. The pipeline then checks each answer with the same schema and rules as an API answer and writes the content the app loads. The learner is an English speaker who is not a beginner and struggles most with Slovak declension, so every case ending must be right.

## Setup

- Work from the repository root (the folder with `pnpm-workspace.yaml`). First: `export PATH=/opt/node24/bin:$PATH`.
- The helper is `pnpm --filter @app/pipeline run offline <command>`. Below it is written `offline <command>`.
- Write only answer files and your own drafts under `content/build/model-answers/`. Do not run pipeline stages (`pnpm run pipeline ...`), do not change code or other files, do not use git, and do not start other agents.

## Commands

| Command | Does |
|---|---|
| `offline show <stage> <route> <job...>` | Prints requests in a compact table, with the path of each answer file. |
| `offline lint <stage> <route> <job...>` | Checks your answer files as the pipeline will. `ERROR` lines name what makes an item fail. `hint` lines name what to look at again; a hint can be wrong. |
| `offline word <form...>` | What the morphology knows of written forms: lemma, rank, form tags, and whether the word is allowed. |
| `offline forms <lemma...>` | Every form of a common lemma by tag. |

A job is the id you were given (`g12`, `t3`, `s40`, `r7`, `lib-004`, `acc.sg.f`). Several jobs can stand in one command.

Form tags: `s` singular or `p` plural, then the case digit (1 nominative, 2 genitive, 3 dative, 4 accusative, 5 vocative, 6 locative, 7 instrumental), then for adjectives, pronouns and numerals the gender (`m` masculine animate, `i` masculine inanimate, `f` feminine, `n` neuter). `s4f` is the accusative singular feminine. Verb tags start with `v:`.

## Answer files

- One file per request, at the path `show` prints: `content/build/model-answers/<stage>/<route>/<hash>.json`.
- Valid JSON in UTF-8, in the shape your guide gives. Every item of the request is answered exactly once, with its id unchanged.
- Run `lint` after writing and mend every `ERROR`. Read every `hint` and decide.

## Slovak

- Standard written Slovak with full diacritics. No Czech forms, no dialect, no slang.
- Never guess a form. When you are not fully sure of an ending, check it with `offline forms` or `offline word`.
- Natural means: a native speaker would say or write this sentence in everyday life without anyone noticing it. A sentence that is only grammatical is not enough.

## When you finish

Report in under 150 words: per job how many items pass, how many you left out and why, and anything the next person should know. Do not paste the content.
