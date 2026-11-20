# Glosses (`dict`, route `content.glosses`)

Short English glosses for Slovak headwords that the dictionary source lacks. Each gloss appears on a flash card and in the reader's word sheet.

## Steps

1. `offline show dict content.glosses <job...>` prints for each word its key (`lemma|part of speech|gender|number`), its aspect and its most used forms.
2. Write the answer file of each request:
   ```json
   {"items":[
   {"key":"rúra|noun|f|1","glosses":["pipe","oven"]},
   {"key":"pridávať|verb||1","glosses":["to add"]}
   ]}
   ```
3. `offline lint dict content.glosses <job...>`; mend what it names.

## Rules

- One to three glosses per word. The most common everyday meaning first. A second or third gloss only for a clearly different common meaning, never a synonym of the first.
- Each gloss has one to six English words, at most 60 characters, lower case except proper nouns and "I". No Slovak, no grammar labels, no explanations, no full stop.
- Verbs start with "to" ("to do"). For a perfective verb (aspect `pf`) gloss the completed action ("to finish", "to buy"). A negated verb such as `nemať` is "to not have". Reflexive verbs are listed without `sa` or `si`: when the most used meaning is the reflexive one, gloss that meaning (`báť` is "to be afraid").
- Nouns take no article. Adjectives are given as adjectives, adverbs as adverbs.
- Pronouns, prepositions, conjunctions and particles get their usual English equivalents ("this, that", "on, onto", "because").
- The key tells homographs apart: `tak|adv` is "so, like this", `tak|conj` is "so, then", `tak|part` is "well, so". Gloss the word in the given part of speech, and use the gender, the aspect and the most used forms to find which word is meant.
- A rare form, a name or an abbreviation gets what it most likely means in everyday Slovak; a best short guess is better than leaving it out.
- British or American spelling: American.

Think of what the learner needs on a flash card: the gloss that makes the word click, not a dictionary entry.
