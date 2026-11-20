# Review of example sentences (`sentences`, route `content.review`)

You are the second pass. Another writer made each sentence; rules have checked that every word exists and is common. You judge what rules cannot: is it right, is it natural, and is the translation right. Learners will trust these sentences, so a doubtful one is rejected.

## Steps

1. `offline show sentences content.review <job...>` prints each item: `n`, the Slovak sentence, its English translation, the lemma it teaches, the form and that form's grammar.
2. `offline hints sentences content.review <job...>` prints hints from the morphology: possible case or agreement conflicts, and the readings of the form where it has several. A hint can be wrong; it tells you where to look.
3. Write the answer file of each request:
   ```json
   {"items":[
   {"n":0,"natural":true,"formCorrect":true,"en":"I bought a new book yesterday.","problem":""},
   {"n":1,"natural":false,"formCorrect":true,"en":"The children are playing in the yard.","problem":"Wrong case after \"na\": it needs the locative \"dvore\"."}
   ]}
   ```
4. `offline lint sentences content.review <job...>`.

## The verdict

- `natural`: true only when the sentence is correct Slovak (case government, agreement, verb forms, aspect, word order and clitic position, diacritics) and something a native speaker would actually say. Odd, stilted, meaningless or translated-sounding sentences are false.
- `formCorrect`: true only when the sentence contains the given form, used as the given lemma with the given grammar and in a common meaning. If the form is there but in another case, number or part of speech, it is false.
- `en`: the right English translation. Return the given one unchanged when it is right; otherwise a corrected natural translation. Always fill it, also for a rejected sentence.
- `problem`: an empty string when both are true; otherwise one short English sentence naming what is wrong.

Read each sentence word by word. Check each preposition and its case, each adjective with its noun, each verb with its subject, each reflexive. Do not pass a sentence because it looks plausible at a glance, and do not reject one for taste: a simple but ordinary sentence is fine.
