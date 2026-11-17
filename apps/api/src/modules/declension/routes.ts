// HTTP handlers of the declension module. Owner: B5.
// F5 stand in: every handler answers with the contract example until B5 builds it.
import { route } from '../../platform/route';
import * as service from './service';

export const routes = [
  route('declension.course', () => service.declensionCourse()),
  route('declension.lesson', () => service.declensionLesson()),
  route('declension.saveProgress', () => service.declensionSaveProgress()),
  route('declension.createSession', () => service.declensionCreateSession()),
  route('declension.submitAttempts', () => service.declensionSubmitAttempts()),
  route('declension.pattern', () => service.declensionPattern()),
];
