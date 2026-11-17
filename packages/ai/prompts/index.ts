// Prompt folders, one per live route. Each route owner fills its own folder; B8's registry
// reads this map.
import type { AiRoute } from '@app/contracts';
import type { PromptFolder } from '../src/prompt';
import { prompt as readerDisambiguate } from './reader.disambiguate';
import { prompt as readerGloss } from './reader.gloss';
import { prompt as readerTranslate } from './reader.translate';
import { prompt as tutorAnalyze } from './tutor.analyze';
import { prompt as tutorReply } from './tutor.reply';
import { prompt as tutorSummary } from './tutor.summary';

export const PROMPTS: Readonly<Record<AiRoute, PromptFolder>> = {
  'tutor.analyze': tutorAnalyze,
  'tutor.reply': tutorReply,
  'tutor.summary': tutorSummary,
  'reader.disambiguate': readerDisambiguate,
  'reader.gloss': readerGloss,
  'reader.translate': readerTranslate,
};
