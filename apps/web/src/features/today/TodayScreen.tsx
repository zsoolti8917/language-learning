// `/`: the plan for the day (`GET /today`). Reviews due with a start button, the text to
// continue, the next lesson, weak cases, a tutor suggestion and word progress. A learner
// without a placement result sees the first run card that leads to the placement check.
import type { BucketMastery, Profile, Today } from '@app/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { apiQuery, isApiError } from '../../lib/api';
import { useOnline } from '../../lib/pwa';
import { t } from '../../messages';
import { Button, Card, CaseBadge, EmptyState, ProgressRing, Skeleton } from '../../ui';
import { useProfile } from '../account/profile';
import { AppNotices } from './AppNotices';
import { m } from './messages';
import { useProfileTheme } from './theme';

const percent = (share: number) => Math.round(share * 100);

function formatDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return new Intl.DateTimeFormat('en', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(d);
}

export function TodayScreen() {
  const profile = useProfile();
  const today = useQuery(apiQuery('profile.today'));
  const online = useOnline();
  useProfileTheme(profile.data);

  const name = profile.data?.displayName;
  return (
    <section className="flex flex-col gap-4 px-gutter py-6">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-fg">{t('screens.today')}</h1>
          <p className="text-base text-fg-muted">
            {name ? m.t('today.greeting', { name }) : m.t('today.greetingAnon')}
            {today.data ? ` · ${formatDay(today.data.date)}` : ''}
          </p>
        </div>
        <Link
          to="/settings"
          aria-label={m.t('today.settings')}
          className="grid size-tap shrink-0 place-items-center rounded-control text-fg-muted hover:bg-surface-2"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-6"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
        </Link>
      </header>

      <AppNotices />

      {today.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-4">
          <Skeleton height="7rem" />
          <Skeleton height="5rem" />
          <Skeleton height="5rem" />
        </div>
      ) : today.isError ? (
        <EmptyState
          title={
            (isApiError(today.error) && today.error.isNetwork) || !online
              ? m.t('today.offlineEmpty')
              : m.t('today.loadFailed')
          }
          action={<Button onClick={() => void today.refetch()}>{m.t('today.retry')}</Button>}
        />
      ) : (
        <Plan today={today.data} profile={profile.data} />
      )}
    </section>
  );
}

function Plan({ today, profile }: { today: Today; profile: Profile | undefined }) {
  const firstRun = profile ? !profile.placementDoneAt : false;
  const { due, new: fresh, learning } = today.review;
  const reviewsLeft = due + fresh + learning;
  return (
    <div className="flex flex-col gap-4" data-today="">
      {firstRun && (
        <Card title={m.t('today.firstRunTitle')} subtitle={m.t('today.firstRunBody')}>
          <Button asChild block size="lg">
            <Link to="/placement">{m.t('today.firstRunAction')}</Link>
          </Button>
        </Card>
      )}
      {!firstRun && reviewsLeft === 0 && (
        <EmptyState icon="✓" title={m.t('today.doneTitle')} description={m.t('today.doneBody')} />
      )}

      <Card title={m.t('today.reviewsTitle')}>
        {reviewsLeft > 0 ? (
          <div className="flex flex-col gap-3">
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-base text-fg" data-review-counts="">
              <li className="font-semibold">{m.t('today.reviewsDue', { count: due })}</li>
              <li>{m.t('today.reviewsNew', { count: fresh })}</li>
              <li>{m.t('today.reviewsLearning', { count: learning })}</li>
            </ul>
            <Button asChild block size="lg">
              <Link to="/review">{m.t('today.reviewsStart')}</Link>
            </Button>
          </div>
        ) : (
          <p className="text-base text-fg-muted">{m.t('today.reviewsNone')}</p>
        )}
      </Card>

      {today.continueText ? (
        <Card
          title={m.t('today.readTitle')}
          subtitle={
            today.continueText.coverage != null
              ? m.t('today.readCoverage', { percent: percent(today.continueText.coverage) })
              : undefined
          }
        >
          <p lang="sk" className="mb-3 text-reading font-medium text-fg">
            {today.continueText.title}
          </p>
          <Button asChild variant="secondary" block>
            <Link to="/read/$textId" params={{ textId: today.continueText.id }}>
              {m.t('today.readAction')}
            </Link>
          </Button>
        </Card>
      ) : (
        <Card title={m.t('today.readTitle')} subtitle={m.t('today.readEmpty')}>
          <Button asChild variant="secondary" block>
            <Link to="/read">{m.t('today.readLibrary')}</Link>
          </Button>
        </Card>
      )}

      {today.nextLesson && (
        <Card title={m.t('today.lessonTitle')}>
          <p className="text-base font-medium text-fg">{today.nextLesson.titleEn}</p>
          <p lang="sk" className="mb-3 text-sm text-fg-muted">
            {today.nextLesson.titleSk}
          </p>
          <Button asChild variant="secondary" block>
            <Link to="/cases/lesson/$lessonId" params={{ lessonId: today.nextLesson.id }}>
              {today.nextLesson.status === 'in_progress'
                ? m.t('today.lessonContinue')
                : m.t('today.lessonAction')}
            </Link>
          </Button>
        </Card>
      )}

      {today.weakBuckets.length > 0 && (
        <Card title={m.t('today.weakTitle')} subtitle={m.t('today.weakBody')}>
          <ul className="mb-3 flex flex-col gap-2">
            {today.weakBuckets.map((b) => (
              <WeakBucket key={`${b.case}-${b.number}-${b.gender}`} bucket={b} />
            ))}
          </ul>
          <Button asChild variant="secondary" block>
            <Link to="/cases/train">{m.t('today.weakAction')}</Link>
          </Button>
        </Card>
      )}

      {today.tutorSuggestion && (
        <Card
          title={m.t('today.tutorTitle')}
          subtitle={
            today.tutorSuggestion.mode === 'case_coach'
              ? m.t('today.tutorCaseCoach')
              : m.t('today.tutorScenario')
          }
        >
          <p lang="sk" className="text-base font-medium text-fg">
            {today.tutorSuggestion.titleSk}
          </p>
          <p className="mb-3 text-sm text-fg-muted">{today.tutorSuggestion.titleEn}</p>
          <Button asChild variant="secondary" block>
            <Link to="/tutor">{m.t('today.tutorAction')}</Link>
          </Button>
        </Card>
      )}

      <Card title={m.t('today.wordsTitle')}>
        <div className="flex items-center gap-4">
          <ProgressRing
            value={today.words.known}
            max={Math.max(1, today.words.total)}
            label={m.t('today.wordsRing')}
            valueText={m.t('today.wordsProgress', {
              known: today.words.known,
              total: today.words.total,
              learning: today.words.learning,
            })}
          >
            {`${percent(today.words.total ? today.words.known / today.words.total : 0)}%`}
          </ProgressRing>
          <div className="min-w-0">
            <p className="text-base font-medium text-fg">
              {m.t('today.wordsBand', { from: today.words.fromRank, to: today.words.toRank })}
            </p>
            <p className="text-sm text-fg-muted">
              {m.t('today.wordsProgress', {
                known: today.words.known,
                total: today.words.total,
                learning: today.words.learning,
              })}
            </p>
          </div>
        </div>
        <Button asChild variant="secondary" block className="mt-3">
          <Link to="/words">{m.t('today.wordsAction')}</Link>
        </Button>
      </Card>
    </div>
  );
}

function WeakBucket({ bucket }: { bucket: BucketMastery }) {
  return (
    <li className="flex items-center justify-between gap-2">
      <CaseBadge
        case={bucket.case}
        label={m.t(`cases.${bucket.case}`)}
        suffix={`${m.t(`numbers.${bucket.number}`)} ${m.t(`genders.${bucket.gender}`)}`}
      />
      <span className="text-sm text-fg-muted">
        {m.t('today.weakMastery', { percent: percent(bucket.mastery) })}
      </span>
    </li>
  );
}
