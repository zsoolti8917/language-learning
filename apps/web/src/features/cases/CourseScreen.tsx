// The course map: nine lessons with their status, the mastery grid, the trainer and the
// pattern tables.
import type { CourseLesson } from '@app/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { apiQuery } from '../../lib/api';
import { t } from '../../messages';
import { buttonClasses, Card, CaseBadge, EmptyState } from '../../ui';
import { ADJECTIVE_PATTERNS, NOUN_PATTERNS, PATTERN_MODEL } from './grammar';
import { MasteryGrid } from './MasteryGrid';
import { m } from './messages';
import { QueryState } from './QueryState';

function LessonRow({ lesson }: { lesson: CourseLesson }) {
  const status =
    lesson.status === 'completed' && lesson.score
      ? `${m.t('lessonStatus.completed')} · ${m.t('course.score', lesson.score)}`
      : m.t(`lessonStatus.${lesson.status}`);
  return (
    <li>
      <Card asChild compact>
        <Link
          to="/cases/lesson/$lessonId"
          params={{ lessonId: lesson.id }}
          data-lesson={lesson.id}
          data-status={lesson.status}
        >
          <span className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-sm text-fg-muted">
                {m.t('course.lessonOrd', { ord: lesson.ord })}
              </span>
              <span className="block text-base font-semibold text-fg">{lesson.titleEn}</span>
              <span className="block text-sm text-fg-muted" lang="sk">
                {lesson.titleSk}
              </span>
            </span>
            {lesson.case && (
              <CaseBadge
                case={lesson.case}
                variant="short"
                label={m.t(`caseTitle.${lesson.case}`)}
                className="shrink-0"
              />
            )}
          </span>
          <span className="mt-2 block text-sm font-medium text-fg" data-testid="lesson-status">
            {status}
          </span>
        </Link>
      </Card>
    </li>
  );
}

export function CourseScreen() {
  const course = useQuery(apiQuery('declension.course'));
  return (
    <section className="space-y-6 px-gutter py-6">
      <h1 className="text-2xl font-semibold text-fg">{t('screens.course')}</h1>

      <Card title={m.t('course.train')} subtitle={m.t('course.trainHint')}>
        <Link to="/cases/train" className={buttonClasses({ block: true })}>
          {m.t('course.train')}
        </Link>
      </Card>

      <QueryState query={course}>
        {(data) => (
          <div className="space-y-6">
            <section aria-labelledby="cases-lessons" className="space-y-3">
              <h2 id="cases-lessons" className="text-lg font-semibold text-fg">
                {m.t('course.lessons')}
              </h2>
              {data.lessons.length === 0 ? (
                <EmptyState title={m.t('course.noLessons')} />
              ) : (
                <ol className="space-y-2">
                  {[...data.lessons]
                    .sort((a, b) => a.ord - b.ord)
                    .map((l) => (
                      <LessonRow key={l.id} lesson={l} />
                    ))}
                </ol>
              )}
            </section>
            <section aria-labelledby="cases-mastery" className="space-y-2">
              <h2 id="cases-mastery" className="text-lg font-semibold text-fg">
                {m.t('course.mastery')}
              </h2>
              <MasteryGrid mastery={data.mastery} />
            </section>
          </div>
        )}
      </QueryState>

      <section aria-labelledby="cases-patterns" className="space-y-3">
        <h2 id="cases-patterns" className="text-lg font-semibold text-fg">
          {m.t('course.patterns')}
        </h2>
        <ul className="flex flex-wrap gap-2">
          {[...NOUN_PATTERNS, ...ADJECTIVE_PATTERNS].map((id) => (
            <li key={id}>
              <Link
                to="/cases/pattern/$patternId"
                params={{ patternId: id }}
                lang="sk"
                className={buttonClasses({ variant: 'secondary' })}
              >
                {PATTERN_MODEL[id]}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
