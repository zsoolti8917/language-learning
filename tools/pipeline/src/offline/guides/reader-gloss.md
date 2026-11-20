# Meanings of words in the library texts (`analysis`, route `reader.gloss`)

A lemma of a library text that the dictionary has no English meaning for is asked here, as the app asks it for a word a learner taps. The meanings are kept with the other generated glosses and shown in the reader and on word cards.

## Steps

1. `offline show analysis reader.gloss` prints the requests: one line per lemma with its id, part of speech, gender or aspect.
2. Write the answer file of each request:
   ```json
   {"glosses":[
   {"lemmaId":1234,"glosses":["bakery"]},
   {"lemmaId":5678,"glosses":["to lock","to lock up"]}
   ]}
   ```
   Every lemma of the request gets exactly one entry with one to three glosses.
3. `offline lint analysis reader.gloss`.

## What a good gloss is

- The meaning a learner needs first, as a dictionary gives it: a noun without an article (`bakery`), a verb with `to` (`to lock`), an adjective or adverb as one word where English has one.
- One gloss when the word has one meaning. A second or third only for a meaning that is clearly different and common, most common first. No explanations in brackets, no grammar notes, no Slovak.
- At most 80 characters each, lower case except for names and words English writes with a capital.
- A perfective and an imperfective verb of a pair get the same English verb.
- To see how the word is used, find it in the texts: `grep -rn "<form>" content/authored/library/`. Gloss the meaning it has there first.
- A name of a person or a place is glossed by its English form (`Bratislava`, `Danube`), a first name by itself.
