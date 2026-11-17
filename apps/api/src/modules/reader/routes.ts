// HTTP handlers of the reader module. Owner: B4.
// F5 stand in: every handler answers with the contract example until B4 builds it.
import { route } from '../../platform/route';
import * as service from './service';

export const routes = [
  route('texts.create', () => service.textsCreate()),
  route('texts.list', () => service.textsList()),
  route('texts.get', () => service.textsGet()),
  route('texts.update', () => service.textsUpdate()),
  route('texts.delete', () => service.textsDelete()),
  route('texts.translateSentence', () => service.textsTranslateSentence()),
  route('library.list', () => service.libraryList()),
  route('library.add', () => service.libraryAdd()),
];
