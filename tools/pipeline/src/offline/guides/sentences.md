# Example sentences (`sentences`, route `content.sentences`)

One Slovak example sentence with its English translation for a word in a given form. The sentence appears on a flash card that teaches that word.

## Steps

1. `offline show sentences content.sentences <job...>` prints the items: number `n`, lemma, part of speech, the exact form, its tag, the tag in words and the English meaning.
2. Write the answer file of each request:
   ```json
   {"items":[
   {"n":0,"sk":"Včera som si kúpil novú knihu.","en":"I bought a new book yesterday."},
   {"n":1,"sk":"Deti sa hrajú na dvore.","en":"The children are playing in the yard."}
   ]}
   ```
3. `offline lint sentences content.sentences <job...>`; mend every `ERROR`, read every `hint`. Repeat until no `ERROR` is left.

## Rules the pipeline checks

- The sentence contains the given form exactly as written, once, used as the given lemma with the given grammar. Words around it must not force another reading: `ženy` asked as nominative plural cannot stand after `bez`.
- 4 to 12 words. It starts with a capital letter and ends with `.`, `?`, `!` or `…`. Only these marks inside: `, . ? ! … : ; - –`. No quotation marks, no brackets, no digits.
- Every word is a form the morphology knows, of a lemma among the 3,000 most common. `lint` names each word that is not; `offline word <form>` tells before you write.
- No names of people or places at all. A capitalised word inside a sentence is read as a name, and names are not in the vocabulary.
- Comparatives and superlatives of adjectives (`lepší`, `väčší`, `najlepší`) are missing from the morphology. Adverbs such as `viac`, `menej`, `skôr` and `neskôr` are fine.
- A negated verb is a word of its own (`nemať`, `nebyť`); a rare one may be outside the vocabulary.

## What makes a good sentence

- Correct, natural Slovak that a native speaker would say, in an everyday situation. One clause is best. Present or past tense. Simple words: the learners are at A1 to B1.
- The sentence shows what the word means and how it is used. A learner should feel the meaning from the context. "To je dobré." teaches nothing about `dobrý`.
- The meaning column picks the sense. When a lemma is asked several times, each sentence shows a different situation, and never the same sentence frame twice.
- Vary your sentences: different subjects, verbs, tenses and openings. Do not start every sentence with the form itself.
- Clitics stand in second position (`som`, `si`, `sa`, `mi`, `ti`, `ho`, `ju`, `by`): "Včera som sa ho pýtal", not "Včera pýtal som sa ho".
- Check agreement (adjective, noun and verb in gender, number and case), the case after each preposition and verb, and aspect.
- The English is a natural translation that keeps meaning and tense.

## When no sentence works

After real attempts, write `"sk":"SKIP","en":"SKIP"` for that item. This must stay rare: almost every form has a natural sentence within the vocabulary.

## Typical causes of an ERROR

- `rare word`: replace it with a common word. Do not argue with the list.
- `unknown word`: a typing error, a missing diacritic, a name, or a comparative.
- `"x" is in the sentence, but not as ...`: the words before the form (a preposition, an adjective that does not agree) leave only another case. Rebuild the phrase so the asked case is the natural one.
