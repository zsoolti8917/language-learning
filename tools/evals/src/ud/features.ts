// UD features as the app names them: case, number, gender and part of speech.
import type { Case, Gender, GrammaticalNumber, Pos } from '@app/contracts';
import type { UdToken } from './conllu';

const CASE: Record<string, Case> = {
  Nom: 'nom',
  Gen: 'gen',
  Dat: 'dat',
  Acc: 'acc',
  Voc: 'voc',
  Loc: 'loc',
  Ins: 'ins',
};

export function caseOf(t: UdToken): Case | undefined {
  const c = t.feats.Case;
  return c ? CASE[c] : undefined;
}

export function numberOf(t: UdToken): GrammaticalNumber | undefined {
  if (t.feats.Number === 'Sing') return 'sg';
  if (t.feats.Number === 'Plur') return 'pl';
  return undefined;
}

export function genderOf(t: UdToken): Gender | undefined {
  switch (t.feats.Gender) {
    case 'Masc':
      return t.feats.Animacy === 'Inan' ? 'm_inan' : 'm_anim';
    case 'Fem':
      return 'f';
    case 'Neut':
      return 'n';
    default:
      return undefined;
  }
}

/** The parts of speech of the app a UD word may have (the analyzer's lemma must be one). */
export function posesOf(t: UdToken): readonly Pos[] {
  switch (t.upos) {
    case 'NOUN':
    case 'PROPN':
      return ['noun'];
    case 'ADJ':
      return ['adj', 'num', 'pron'];
    case 'DET':
      return ['pron', 'adj', 'num'];
    case 'PRON':
      return ['pron'];
    case 'NUM':
      return ['num', 'adj'];
    case 'VERB':
    case 'AUX':
      return ['verb'];
    case 'ADP':
      return ['prep'];
    case 'ADV':
      return ['adv'];
    case 'CCONJ':
    case 'SCONJ':
      return ['conj'];
    case 'PART':
      return ['part'];
    case 'INTJ':
      return ['intj'];
    default:
      return ['other'];
  }
}

/** Parts of speech whose words carry a case in the app's tags. */
export const CASE_BEARING_UPOS: ReadonlySet<string> = new Set([
  'NOUN',
  'PROPN',
  'ADJ',
  'DET',
  'PRON',
  'NUM',
]);
