# Declension exercises (`exercises`, route `content.exercises`)

Each sentence becomes a gap exercise: the learner sees the sentence with one gap and the base form, and types or picks the missing form. The gap's form comes from the morphology; you write the sentence around it. These exercises are the heart of the app.

You work bucket by bucket. A bucket is a case, a number and a gender (`acc.sg.f`). Its slots pair a word in the bucket's form with a trigger, the word that demands the case. The pairing is mechanical, so many slots have no natural sentence. You write sentences only for slots where one exists and leave the others out.

## Steps

1. `offline slots <bucket>` prints the bucket's triggers and every open slot: slot id, trigger, the gap text and the base form. A note says when a slot cannot pass at all.
2. Write your sentences to `content/build/model-answers/exercises/drafts/<bucket>.jsonl`, one JSON object per line, only for the slots you choose:
   ```json
   {"slot":"acc.sg.f/000","sentenceSk":"Každé ráno čítam knihu.","sentenceEn":"I read a book every morning.","gap":"knihu"}
   ```
3. `offline put exercises content.exercises content/build/model-answers/exercises/drafts/<bucket>.jsonl` writes the answer files of the whole bucket from your draft, with SKIP for every slot you left out. Run it again after each change of the draft.
4. `offline lint exercises content.exercises <bucket>`; mend every `ERROR` in the draft, read every `hint`, then `put` and `lint` again. The last line counts the items that pass.

Aim for 60 passing sentences per bucket, and at least 48. Take the slots in order and keep the natural ones. Quality comes first: a bucket with 45 good sentences is better than one with 60 where some are odd. Spread the sentences over the bucket's triggers as far as natural sentences allow.

## Rules the pipeline checks

- The gap text stands in the sentence exactly once, letter for letter, with no change of form or word order. `gap` repeats it as it stands in the sentence (capitalised only when it starts the sentence).
- 4 to 10 words, one or two short sentences. It ends with `.`, `?` or `!`. No digits.
- The trigger governs the gap:
  - A preposition, numeral, quantity word, container noun or adjective trigger stands directly before the gap.
  - A verb trigger is in the same clause as the gap, and no preposition stands right before the gap.
  - A question word trigger opens a short question and the gap is in the answer: "Komu pomáhaš? Bratovi."
- You may use another form of the trigger when Slovak needs it: another person or tense of a verb, `zo` for `z`, `so` for `s`, `vo` for `v`, `ku` for `k`, `dve` or `dvaja` for `dva`, `traja`, `štyria`. With masculine animate nouns the nominative needs `dvaja`, `traja`, `štyria`.
- A pronoun gap (base form `on` or `ona`) may stand in the short form where Slovak uses it: `mu` for `jemu` in "Pomáham mu." The long form is right under stress or at the start of the sentence: "Jemu to nevadí." Write `gap` as the pronoun stands in your sentence.
- Every other word is a known form of one of the 3,000 most common words. The only names allowed are Peter, Jana, Martin, Eva, Tomáš, Anna, Bratislava and Slovensko, and only in exactly these forms.

## What makes a good exercise

- Natural everyday Slovak, as in the common guide. The trigger and the word must make sense together. "Ďakujem hlavám." is grammar without meaning: leave that slot out.
- Only one case fits the gap. A learner who sees the sentence with the gap and the base form must be able to tell the case from the trigger alone.
  - After prepositions with two cases (`na`, `v`, `o`, `po`, `za`, `pred`, `nad`, `pod`, `medzi`) the verb decides: motion towards a place takes the accusative, a position takes the locative or instrumental. Use a verb that leaves no doubt (`ísť`, `dať`, `položiť` against `byť`, `stáť`, `sedieť`, `ležať`, `bývať`).
  - Do not build a sentence where another case is also correct in the gap, or where the gap could be read as another number.
- In a plural bucket the context should make the plural natural (a numeral, `všetky`, `tieto`, a plural verb), where this fits.
- A question word for people (`kto`, `koho`, `komu`, `o kom`, `s kým`) goes with a person, one for things (`čo`, `čomu`, `o čom`, `čím`) with a thing. Leave a slot out when they clash.
- Vary the sentences: different subjects, verbs and situations. No two sentences of a bucket with the same frame.
- `sentenceEn` is a natural English translation of the whole sentence.

## Leave a slot out when

- the trigger and the word make no natural sentence;
- the note says the slot cannot pass (the form is also another case that the preposition takes);
- the word needs rare words around it to make sense;
- you are not fully sure the sentence is right.
