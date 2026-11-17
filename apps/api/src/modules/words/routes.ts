// HTTP handlers of the words module. Owner: B6.
// F5 stand in: every handler answers with the contract example until B6 builds it.
import { route } from '../../platform/route';
import * as service from './service';

export const routes = [
  route('words.bands', () => service.wordsBands()),
  route('words.list', () => service.wordsList()),
  route('words.triage', () => service.wordsTriage()),
  route('lemmas.get', () => service.lemmasGet()),
  route('lemmas.setStatus', () => service.lemmasSetStatus()),
];
