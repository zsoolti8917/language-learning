# Readings of the library texts (`analysis`, route `reader.disambiguate`)

The reader shows every word of a library text with its dictionary form, its meaning and, for a declined word, its case, number and gender. A dictionary lookup and grammar rules have decided most words. You decide the rest: for each word of a request you pick the one reading that is right in its sentence. The learner studies declension from these labels, so a wrong case is the worst mistake you can make here.

## Steps

1. `offline show analysis reader.disambiguate <job...>` prints the requests of a text (`lib-004`). A line `[3] Sentence.` is a context; the lines under it are its words: the number `w` of the word, the word, and its readings as `index: lemma part-of-speech case number gender` (a verb shows its tag instead).
2. Write the answer file of each request, one pick per word, in the order of the request:
   ```json
   {"picks":[{"w":0,"c":0},{"w":1,"c":2},{"w":2,"c":0}]}
   ```
   `w` is the number of the word, `c` the index of the reading you choose. Every word gets exactly one pick, and `c` must be an index the word lists.
3. `offline lint analysis reader.disambiguate <job...>`.

## How to decide

Read the whole sentence first and name the part each word plays in it. Then pick.

- **Subject** and what `byť` says of it are nominative: `Byt nie je veľký.` `Je to dobré miesto.` An adjective that stands alone after `byť` agrees with the subject, also when the subject is only understood from the sentence before.
- **Direct object** is accusative, also after a negated verb. A masculine animate noun has the same form in the accusative and the genitive singular: decide by the verb or the preposition.
- **After a preposition** the case is the one the preposition governs in this meaning: `do, od, z, bez, u, okolo, vedľa, počas, podľa, blízko` genitive; `k, proti, vďaka` dative; `cez, pre` accusative; `o, po, pri` locative (`o` and `po` with the accusative in a few fixed uses: `o päť minút`, `ísť po chlieb`); `s` instrumental; `v, na` locative for a place where something is and accusative for a direction or a day (`na stene` but `na stôl`; `v sobotu`); `za, pred, nad, pod, medzi` instrumental for a place and accusative for a direction or a price (`za byt platím`).
- **After a number or a quantity word**: `dva, tri, štyri` agree with the noun in case; `päť` and up, `veľa, málo, niekoľko, pár, koľko, trochu` take the genitive (plural of a countable noun, singular of a mass noun), and the quantity word itself has the case of the whole phrase (`mám veľa času`: `veľa` accusative, `času` genitive).
- **Time**: `každý deň, minulý mesiac, celý týždeň, túto sobotu` are accusative; `jedného dňa, minulého roku` genitive.
- **Verbs that govern another case**: `pomáhať, veriť, rozumieť, ďakovať, páčiť sa, volať (komu)` dative; `báť sa, pýtať sa, týkať sa, dotknúť sa` genitive; `stať sa, zaoberať sa, cestovať (vlakom)` instrumental.
- **Agreement**: an adjective, a pronoun or a numeral before a noun takes the case, number and gender of that noun. Pick the masculine animate reading with a person or an animal and the inanimate reading with a thing.
- **Vocative** only when the sentence speaks to someone by that word. In these texts that is rare.
- **The same form of several lemmas**: choose by meaning. `je` is `byť` unless somebody eats. `mám` is `mať`. `si` is `byť` only in "you are"; with a reflexive verb it is `si other`. `sa` with a verb is `sa other`. `a`, `i`, `ale`, `že`, `keď`, `alebo`, `lebo` that join words or clauses are `conj`. `aj` is `part` when it means "also" or "even" and `conj` when it joins two things. `to` is the pronoun `ten` when it stands for a thing or a fact. `čo`, `ktorý`, `kto` take the case of their part in their own clause (`všetko, čo potrebujem`: accusative). `ako` is `conj` in a comparison and before a clause and `adv` in a question about manner. A reading in capitals (`SA`, `A`, `Mi`) is an abbreviation and is almost never right; a letter as a noun (`a noun`) never.
- **`jeho`, `jej`, `ich`**: as "his, her, their" before a noun the lemma is `jeho`, `jej`, `ich`, with the case, number and gender of that noun; as an object ("him, her, them") the lemma is `on`, `ona`, `ono`.
- **An adjective as a noun** (`malé noun`, `druhá noun`, `známy noun`): only when the word names a thing or a person itself and describes no noun, said or understood.
- **Names**: a capitalised lemma (`Jana`, `Bratislava`) when the word is that name.

## Verb tags

The letters are: the form (`I` infinitive, `K` present, `B` future of `byť`, `L` past, `M` imperative, `H` transgressive), the aspect (`e` imperfective, `d` perfective, `j` both), the number (`s`, `p`), the person (`a` first, `b` second, `c` third), for the past the gender (`m` masculine animate, `i` masculine inanimate, `f`, `n`; in the plural `h` for the first and second person and `o` when the gender cannot be told), and `+` or `-` for a negated verb.

- The person of a past form comes from the auxiliary: `som, sme` first, `si, ste` second, no auxiliary third. `Minulý mesiac som začala` is `Ldsaf+`.
- The gender of a past form is the gender of the subject. In the third person plural pick `m` when the subject is or includes a man or a male animal, `f`, `i` or `n` when every subject noun has that gender, and `o` when no subject says it.
- A polite `vy` to one person is the plural form.

## When the sentence does not decide

Pick the reading that is most common in everyday Slovak. Do not leave a word out. If you believe that no listed reading is right, pick the closest one and name the word in your report.

Check your picks once more against the list above before you lint: go through the sentence and say for each noun why it has its case.
