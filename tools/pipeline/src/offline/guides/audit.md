# Audit of the finished content (`audit`, routes `content.audit.*`)

You are the second pass over a random sample of the finished content: example sentences, exercises and dictionary entries that learners will meet as they are. Another writer made each item and a first check passed it. Your verdict changes nothing in the set; it tells the editor how good the set is and what to mend, so it must be your own careful reading, not a guess.

## Steps

1. `offline show audit <route> <job...>` prints the items of a request. The routes and their jobs:
   - `content.audit.sentences`, jobs `s0`, `s1`, …: a Slovak sentence, its English translation, and each word the sentence teaches with its form, the grammar of that form and the meaning of the lemma (its glosses, each with its note in brackets).
   - `content.audit.exercises`, jobs `e0`, `e1`, …: the kind of exercise, the sentence, its translation, the answer with its case, number and gender, the base form the learner is shown, the trigger (the word that governs the case, with its meaning) and the options of a choice exercise.
   - `content.audit.glosses`, jobs `g0`, `g1`, …: a lemma with its part of speech and its English glosses in the order the app shows them.
2. Write the answer file of each request, one line per item:
   ```json
   {"items":[
   {"n":0,"verdict":"ok","problem":"","fix":""},
   {"n":1,"verdict":"wrong","problem":"\"knihu\" is accusative here, not genitive.","fix":""},
   {"n":2,"verdict":"minor","problem":"The translation is word for word.","fix":"I have been living here for two years."}
   ]}
   ```
3. `offline lint audit <route> <job...>`.

## The verdict

- `wrong`: a learner would learn something false or be marked wrong unfairly.
  - Sentence: a mistake in the Slovak (grammar, agreement, case government, verb form, word order, spelling, diacritics); a translation that says something else; a taught form that is not a form of that lemma, does not have that grammar in this sentence, or is used in the meaning of another word with the same spelling.
  - Exercise: any of the above; an answer that is not the stated case, number and gender of the base form in this sentence; a trigger that does not govern the answer here; an option marked wrong that is also right; another form of the base form that fits the blank as well as the answer while neither the sentence nor the translation decides (the learner sees the translation).
  - Dictionary entry: a gloss that is not a meaning of this lemma in this part of speech; a first gloss that hides the main meaning behind a rare one.
- `minor`: nothing false, but the item should be better. Slovak that is correct but stiff or odd; a loose or unnatural translation; a gloss that is vague, cut off, repeated or too long for a card; a common meaning that is missing.
- `ok`: everything else. A simple, ordinary item is what a learner needs. Do not report matters of taste.

`problem` says in one or two short English sentences what is wrong; it is empty for `ok` and never empty otherwise. `fix` is the corrected Slovak sentence or translation, or the glosses the entry should have, separated by `; `. Leave `fix` empty for `ok` and when the item should be removed.

## How to read

- Read every item word by word. Check each ending against its preposition, verb and noun, and look doubtful forms up with `offline word <form>` and `offline forms <lemma>`. Never trust your memory of an ending.
- For an exercise, imagine the blank empty and the base form beside it, then ask what a good learner would type.
- For a dictionary entry, think of the word in three everyday sentences and ask whether the glosses cover them, in this part of speech. A word such as `a`, `ako`, `čo` is a different entry as a conjunction, a particle and a pronoun.
- A sentence from `tatoeba` or `ud` was written by people and can be colloquial; that alone is not a problem. A mistake is.
- The morphology has a few entries that standard Slovak does not use. Report an item that teaches such a form.
