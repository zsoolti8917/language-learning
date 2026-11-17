// A note of the deck (M2): /deck/$noteId. Its sentences, schedule and last reviews, and the
// actions suspend, edit and delete.
import type { NoteContent, NoteDetail, UpdateNote } from '@app/contracts';
import { readTag } from '@app/ling';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { api, apiKey, apiQuery, isApiError } from '../../lib/api';
import { db } from '../../lib/db';
import { useOnline } from '../../lib/pwa';
import { Button, Card, CaseBadge, EmptyState, Sheet, Skeleton, useToast } from '../../ui';
import { formatDate, type NoteSentence, noteGloss, noteLabel, noteSentences } from './format';
import { m } from './messages';
import { NoteEditSheet } from './NoteEditSheet';

function Sentence({ s }: { s: NoteSentence }) {
  const reading = s.tag ? readTag(s.tag) : null;
  return (
    <li className="space-y-1">
      <p lang="sk" className="text-reading text-fg">
        {s.sentenceSk.slice(0, s.blank.start)}
        <span className="rounded-control bg-primary-soft px-1 font-semibold">
          {s.sentenceSk.slice(s.blank.start, s.blank.end)}
        </span>
        {s.sentenceSk.slice(s.blank.end)}
      </p>
      <p className="text-base text-fg-muted">{s.sentenceEn}</p>
      {reading?.case && (
        <CaseBadge
          case={reading.case}
          label={m.messages.caseTitles[reading.case]}
          {...(reading.number ? { suffix: m.messages.numbers[reading.number] } : {})}
        />
      )}
    </li>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="text-right font-medium text-fg">{value}</dd>
    </div>
  );
}

function Schedule({ detail }: { detail: NoteDetail }) {
  const c = detail.card;
  if (!c) return <p className="text-fg-muted">{m.messages.note.noCard}</p>;
  return (
    <dl className="divide-y divide-border text-base">
      <Row label={m.messages.note.state} value={m.messages.cardStates[c.state]} />
      <Row
        label={m.messages.note.dueAt}
        value={c.dueAt ? formatDate(c.dueAt) : m.messages.note.notScheduled}
      />
      {c.stability !== null && (
        <Row
          label={m.messages.note.stability}
          value={m.t('note.stabilityDays', { days: Math.round(c.stability * 10) / 10 })}
        />
      )}
      {c.difficulty !== null && (
        <Row label={m.messages.note.difficulty} value={Math.round(c.difficulty * 10) / 10} />
      )}
      <Row label={m.messages.note.reps} value={c.reps} />
      <Row label={m.messages.note.lapses} value={c.lapses} />
      {c.lastReviewAt && (
        <Row label={m.messages.note.lastReview} value={formatDate(c.lastReviewAt)} />
      )}
    </dl>
  );
}

function Reviews({ detail }: { detail: NoteDetail }) {
  if (detail.reviews.length === 0)
    return <p className="text-fg-muted">{m.messages.note.noReviews}</p>;
  return (
    <ul className="divide-y divide-border">
      {detail.reviews.map((r) => (
        <li key={r.id} className="space-y-0.5 py-2">
          <p className="flex justify-between gap-3">
            <span className="font-medium text-fg">{m.messages.grades[r.grade]}</span>
            <span className="text-sm text-fg-muted">{formatDate(r.answeredAt)}</span>
          </p>
          <p className="text-sm text-fg-muted">
            {r.typed !== null && (
              <span lang="sk">{m.t('note.typed', { typed: r.typed || '—' })} · </span>
            )}
            {r.expected !== null && r.expected !== r.typed && (
              <span lang="sk">{m.t('note.expected', { expected: r.expected })} · </span>
            )}
            {m.t('note.rated', { rating: m.messages.rating[`r${r.rating}`] })}
            {r.overridden && ` (${m.messages.note.changed})`}
          </p>
        </li>
      ))}
    </ul>
  );
}

/** Removes a note's cards from the local review queue (suspended or deleted). */
async function dropFromQueue(noteId: string) {
  await db.reviewQueue.where('noteId').equals(noteId).delete();
}

export function NoteScreen() {
  const noteId = String(useParams({ strict: false }).noteId ?? '');
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const online = useOnline();
  const [busy, setBusy] = useState<'suspend' | 'delete' | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const input = { params: { id: noteId } };
  const query = useQuery({ ...apiQuery('notes.get', input), retry: false });

  async function update(body: UpdateNote) {
    try {
      const detail = await api.notes.update({ params: { id: noteId }, body });
      queryClient.setQueryData(apiKey('notes.get', input), detail);
      await queryClient.invalidateQueries({ queryKey: ['api', 'notes.list'] });
      if (detail.note.suspended) await dropFromQueue(noteId);
      toast({ title: m.messages.note.saved, tone: 'success' });
    } catch (e) {
      toast({ title: m.messages.note.failed, tone: 'error' });
      throw e;
    }
  }

  async function remove() {
    setBusy('delete');
    try {
      await api.notes.delete({ params: { id: noteId } });
      await dropFromQueue(noteId);
      await queryClient.invalidateQueries({ queryKey: ['api', 'notes.list'] });
      toast({ title: m.messages.note.deleted, tone: 'success' });
      setConfirmOpen(false);
      await navigate({ to: '/deck' });
      // Dropped only after leaving: while this screen is mounted its query would fetch again.
      queryClient.removeQueries({ queryKey: apiKey('notes.get', input) });
    } catch {
      toast({ title: m.messages.note.failed, tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function toggleSuspend(suspended: boolean) {
    setBusy('suspend');
    try {
      await update({ suspended });
    } catch {
      // Toast shown in update.
    } finally {
      setBusy(null);
    }
  }

  const back = (
    <Link
      to="/deck"
      className="inline-flex min-h-tap items-center font-medium text-primary underline"
    >
      {m.messages.deck.back}
    </Link>
  );

  let body: React.ReactNode;
  if (query.isPending) {
    body = (
      <div
        className="space-y-3"
        aria-busy="true"
        aria-label={m.messages.note.loading}
        role="status"
      >
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-28" />
        <Skeleton className="h-40" />
      </div>
    );
  } else if (query.isError) {
    const e = query.error;
    if (isApiError(e) && e.status === 404) {
      body = <EmptyState title={m.messages.note.notFound} action={back} />;
    } else if (!online || (isApiError(e) && e.isNetwork)) {
      body = (
        <EmptyState
          title={m.messages.deck.offlineTitle}
          description={m.messages.deck.offlineText}
        />
      );
    } else {
      body = (
        <EmptyState
          title={m.messages.deck.errorTitle}
          description={m.messages.review.errorText}
          action={<Button onClick={() => void query.refetch()}>{m.messages.review.retry}</Button>}
        />
      );
    }
  } else {
    const { note } = query.data;
    const content = note.content;
    const gloss = noteGloss(content);
    body = (
      <div className="space-y-4">
        <div>
          <p lang="sk" className="text-2xl font-semibold text-fg" data-testid="note-label">
            {noteLabel(content)}
          </p>
          {gloss && <p className="text-lg text-fg">{gloss}</p>}
          <p className="text-sm text-fg-muted">
            {m.messages.kinds[note.kind]} ·{' '}
            {m.t('note.source', { source: m.messages.sources[note.source] })}
          </p>
          {note.suspended && (
            <p className="mt-2 text-base font-medium text-fg">{m.messages.note.suspendedNote}</p>
          )}
        </div>
        <Card title={m.messages.note.sentences}>
          <ul className="space-y-4">
            {noteSentences(content).map((s) => (
              <Sentence key={`${s.sentenceSk}-${s.blank.start}`} s={s} />
            ))}
          </ul>
          {content.kind === 'case_sentence' && (
            <p className="mt-3 text-base text-fg-muted">
              {m.t('note.answers', { answers: content.answers.join(', ') })}
            </p>
          )}
        </Card>
        <Card title={m.messages.note.schedule}>
          <Schedule detail={query.data} />
        </Card>
        <Card title={m.messages.note.reviews}>
          <Reviews detail={query.data} />
        </Card>
        <div className="grid grid-cols-3 gap-2">
          <Button
            variant="secondary"
            loading={busy === 'suspend'}
            onClick={() => void toggleSuspend(!note.suspended)}
          >
            {note.suspended ? m.messages.note.unsuspend : m.messages.note.suspend}
          </Button>
          <NoteEditSheet content={content} onSave={(c: NoteContent) => update({ content: c })} />
          <Sheet
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title={m.messages.note.deleteTitle}
            description={m.messages.note.deleteText}
            trigger={<Button variant="danger">{m.messages.note.delete}</Button>}
            footer={
              <div className="flex gap-2">
                <Button variant="secondary" block onClick={() => setConfirmOpen(false)}>
                  {m.messages.note.cancel}
                </Button>
                <Button
                  variant="danger"
                  block
                  loading={busy === 'delete'}
                  onClick={() => void remove()}
                >
                  {m.messages.note.deleteConfirm}
                </Button>
              </div>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <section className="space-y-4 px-gutter py-6">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold text-fg">{m.messages.note.title}</h1>
        {back}
      </div>
      {body}
    </section>
  );
}
