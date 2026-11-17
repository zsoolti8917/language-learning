// Logic of the declension module. Owner: B5. It takes ports and a transaction and knows
// nothing about HTTP.
// F5 stand in: answers with the contract examples.
import type { ResponseOf } from '@app/contracts';
import { contractExample } from '../../platform/stub';

export function declensionCourse(): ResponseOf<'declension.course'> {
  return contractExample('declension.course');
}

export function declensionLesson(): ResponseOf<'declension.lesson'> {
  return contractExample('declension.lesson');
}

export function declensionSaveProgress(): ResponseOf<'declension.saveProgress'> {
  return contractExample('declension.saveProgress');
}

export function declensionCreateSession(): ResponseOf<'declension.createSession'> {
  return contractExample('declension.createSession');
}

export function declensionSubmitAttempts(): ResponseOf<'declension.submitAttempts'> {
  return contractExample('declension.submitAttempts');
}

export function declensionPattern(): ResponseOf<'declension.pattern'> {
  return contractExample('declension.pattern');
}
