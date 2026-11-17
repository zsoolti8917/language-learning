// Logic of the reader module. Owner: B4. It takes ports and a transaction and knows
// nothing about HTTP.
// F5 stand in: answers with the contract examples.
import type { ResponseOf } from '@app/contracts';
import { contractExample } from '../../platform/stub';

export function textsCreate(): ResponseOf<'texts.create'> {
  return contractExample('texts.create');
}

export function textsList(): ResponseOf<'texts.list'> {
  return contractExample('texts.list');
}

export function textsGet(): ResponseOf<'texts.get'> {
  return contractExample('texts.get');
}

export function textsUpdate(): ResponseOf<'texts.update'> {
  return contractExample('texts.update');
}

export async function textsDelete(): Promise<undefined> {
  return undefined;
}

export function textsTranslateSentence(): ResponseOf<'texts.translateSentence'> {
  return contractExample('texts.translateSentence');
}

export function libraryList(): ResponseOf<'library.list'> {
  return contractExample('library.list');
}

export function libraryAdd(): ResponseOf<'library.add'> {
  return contractExample('library.add');
}
