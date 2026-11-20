# Translations (`sentences`, route `content.translate`)

English translations of Slovak sentences from a treebank of web and news texts. Each sentence is shown on its own, without context, as an example in the learner's dictionary.

## Steps

1. `offline show sentences content.translate <job...>` prints each sentence with its number `n`.
2. Write the answer file of each request:
   ```json
   {"items":[
   {"n":0,"en":"He came home late yesterday."},
   {"n":1,"en":"Where do you work?"}
   ]}
   ```
3. `offline lint sentences content.translate <job...>`.

## Rules

- Natural English that keeps the meaning, the tense and the sentence type (statement, question, exclamation). Not word for word, and nothing added or explained.
- At most 300 characters. Every `n` exactly once.
- Slovak leaves out subject pronouns; choose the English subject the verb form demands, and "he" where the gender of a past tense form is masculine, "she" where it is feminine.
- A sentence that is a fragment stays a fragment in English.
