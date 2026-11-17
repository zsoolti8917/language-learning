// Logic of the notes module. Owner: B1. It takes ports and a transaction and knows
// nothing about HTTP.
// F5 stand in: answers with the contract examples.
import type { ResponseOf } from '@app/contracts';
import { contractExample } from '../../platform/stub';

export function notesList(): ResponseOf<'notes.list'> {
  return contractExample('notes.list');
}

export function notesGet(): ResponseOf<'notes.get'> {
  return contractExample('notes.get');
}

export function notesCreate(): ResponseOf<'notes.create'> {
  return contractExample('notes.create');
}

export function notesUpdate(): ResponseOf<'notes.update'> {
  return contractExample('notes.update');
}

export async function notesDelete(): Promise<undefined> {
  return undefined;
}
