// The word page: glosses, the table of forms in case colours, examples, the status control
// and a link to the note (M5).
import type { LemmaDetail, LemmaSentence, LemmaStatus } from '@app/contracts';
import { LEMMA_STATUSES } from '@app/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useEffect } from 'react';
import { apiKey, apiQuery, isApiError } from '../../lib/api';
import { outbox, setLemmaStatuses } from '../../lib/db';
import { t } from '../../messages';
import { Button, CaseBadge, cn, EmptyState, useToast } from '../../ui';
import { m } from './messages';
import { buildParadigm, type ParadigmCell } from './paradigm';
import { ErrorState, LoadingState } from './states';

export function LemmaScreen() {
  const { lemmaId } = useParams({ strict: false });
  const id = String(lemmaId ?? '');
  const valid = /^[1-9]\d*$/.test(id);
  const query = useQuery({ ...apiQuery('lemmas.get', { params: { id } }), enabled: valid });

  // Keep the local status table in step with the server's answer (reader, sorting).
  const detail = query.data;
  useEffect(() => {
    if (detail) {
      void setLemmaStatuses([{ lemmaId: detail.lemma.id, status: detail.status }]).catch(() => {});
    }
  }, [detail]);

  const notFound = !valid || (isApiError(query.error) && query.error.status === 404);

  return (
    <section className="px-gutter py-6">
      <h1 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
        {t('screens.lemma')}
      </h1>
      <div className="mt-2">
        {notFound ? (
          <EmptyState title={m.t('lemma.notFound')} description={m.t('lemma.notFoundHint')} />
        ) : query.isPending ? (
          <LoadingState rows={3} />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <LemmaView detail={query.data} queryId={id} />
        )}
      </div>
    </section>
  );
}

function LemmaView({ detail, queryId }: { detail: LemmaDetail; queryId: string }) {
  const { lemma, senses } = detail;
  const facts = [
    m.t(`pos.${lemma.pos}`),
    lemma.gender ? m.t(`gender.${lemma.gender}`) : null,
    lemma.freqRank ? m.t('lemma.rank', { rank: lemma.freqRank }) : null,
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <header>
        <p lang="sk" className="text-4xl font-bold text-fg" data-testid="lemma-title">
          {lemma.lemma}
        </p>
        <p className="mt-1 text-base text-fg-muted">{facts.join(' · ')}</p>
      </header>

      <section aria-labelledby="lemma-meanings">
        <h2 id="lemma-meanings" className="text-lg font-semibold text-fg">
          {m.t('lemma.meanings')}
        </h2>
        {senses.length === 0 ? (
          <p className="mt-1 text-base text-fg-muted">{m.t('lemma.noMeanings')}</p>
        ) : (
          <ol className="mt-2 space-y-1">
            {senses.map((s) => {
              const machine = s.source === 'generated' || s.source === 'runtime';
              return (
                <li key={s.ord} className="text-base text-fg" data-sense={s.ord}>
                  <span>{s.glossEn}</span>
                  {s.note && <span className="text-fg-muted"> ({s.note})</span>}
                  {machine && (
                    <span
                      className="ml-2 rounded-full border border-border-strong px-2 py-0.5 text-xs text-fg-muted"
                      title={m.t('lemma.machineHint')}
                      data-machine=""
                    >
                      ⚙ {m.t('lemma.machine')}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <StatusControl detail={detail} queryId={queryId} />

      <FormsTable detail={detail} />

      <section aria-labelledby="lemma-examples">
        <h2 id="lemma-examples" className="text-lg font-semibold text-fg">
          {m.t('lemma.examples')}
        </h2>
        {detail.sentences.length === 0 ? (
          <p className="mt-1 text-base text-fg-muted">{m.t('lemma.noExamples')}</p>
        ) : (
          <ul className="mt-2 space-y-3">
            {detail.sentences.map((s) => (
              <li key={s.id}>
                <Example sentence={s} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Example({ sentence: s }: { sentence: LemmaSentence }) {
  const { start, end } = s.span;
  const ok = start >= 0 && end <= s.textSk.length && start < end;
  return (
    <div className="rounded-card border border-border bg-surface p-3">
      <p lang="sk" className="text-reading text-fg">
        {ok ? (
          <>
            {s.textSk.slice(0, start)}
            <mark className="rounded bg-primary-soft px-0.5 font-semibold text-fg">
              {s.textSk.slice(start, end)}
            </mark>
            {s.textSk.slice(end)}
          </>
        ) : (
          s.textSk
        )}
      </p>
      {s.textEn && <p className="mt-1 text-sm text-fg-muted">{s.textEn}</p>}
    </div>
  );
}

function FormsTable({ detail }: { detail: LemmaDetail }) {
  const table = buildParadigm(detail.forms, detail.lemma.topForms);
  const hasTop = table.rows.some((r) => r.cells.some((c) => c.forms.some((f) => f.top)));
  return (
    <section aria-labelledby="lemma-forms">
      <h2 id="lemma-forms" className="text-lg font-semibold text-fg">
        {m.t('lemma.forms')}
      </h2>
      {table.rows.length > 0 && (
        <div className="mt-2 overflow-hidden rounded-card border border-border">
          <table className="w-full table-fixed border-collapse text-left">
            <caption className="sr-only">
              {m.t('lemma.formsLabel', { lemma: detail.lemma.lemma })}
            </caption>
            <thead className="bg-surface-2 text-sm text-fg-muted">
              <tr>
                <th scope="col" className="w-[42%] px-2 py-2 font-semibold">
                  {m.t('lemma.caseHeader')}
                </th>
                {table.kind === 'number' ? (
                  <>
                    <th scope="col" className="px-2 py-2 font-semibold">
                      {m.t('lemma.singular')}
                    </th>
                    <th scope="col" className="px-2 py-2 font-semibold">
                      {m.t('lemma.plural')}
                    </th>
                  </>
                ) : (
                  <th scope="col" className="px-2 py-2 font-semibold">
                    {m.t('lemma.form')}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row.case} data-case-row={row.case} className="border-t border-border">
                  <th scope="row" className="px-2 py-2 font-normal">
                    <CaseBadge case={row.case} label={m.t(`cases.${row.case}`)} />
                  </th>
                  {row.cells.map((cell, i) => (
                    <FormCell key={i} cell={cell} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {hasTop && <p className="mt-2 text-sm text-fg-muted">{m.t('lemma.topLegend')}</p>}
      {table.vocative.length > 0 && (
        <p className="mt-1 text-base text-fg">
          <span lang="sk">{m.t('lemma.vocative', { forms: table.vocative.join(', ') })}</span>
        </p>
      )}
      {table.other.length > 0 && (
        <div className="mt-2">
          <h3 className="text-base font-semibold text-fg">{m.t('lemma.otherForms')}</h3>
          <p lang="sk" className="mt-1 text-base text-fg">
            {table.other.join(', ')}
          </p>
        </div>
      )}
      {table.rows.length === 0 && table.other.length === 0 && (
        <p className="mt-1 text-base text-fg-muted">{m.t('lemma.noForms')}</p>
      )}
    </section>
  );
}

function FormCell({ cell }: { cell: ParadigmCell }) {
  return (
    <td lang="sk" className="break-words px-2 py-2 align-middle text-base text-fg">
      {cell.forms.length === 0
        ? '–'
        : cell.forms.map((f, i) => (
            <span key={f.form}>
              {i > 0 && ', '}
              {f.top ? (
                <strong
                  className="rounded bg-primary-soft px-1 font-bold underline decoration-2 underline-offset-4"
                  data-top=""
                >
                  {f.form}
                  <span className="sr-only"> ({m.t('lemma.top')})</span>
                </strong>
              ) : (
                f.form
              )}
            </span>
          ))}
    </td>
  );
}

function StatusControl({ detail, queryId }: { detail: LemmaDetail; queryId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const lemmaId = detail.lemma.id;

  const choose = async (status: LemmaStatus) => {
    if (status === detail.status) return;
    // Shown at once; the outbox sends it (also later, when offline) and its answer
    // replaces the local status.
    queryClient.setQueryData(apiKey('lemmas.get', { params: { id: queryId } }), (old) =>
      old ? { ...old, status } : old,
    );
    await setLemmaStatuses([{ lemmaId, status }]).catch(() => {});
    await outbox.enqueue('lemmas.setStatus', { params: { id: String(lemmaId) }, body: { status } });
    void queryClient.invalidateQueries({ queryKey: ['api', 'words.list'] });
    void queryClient.invalidateQueries({ queryKey: ['api', 'words.bands'] });
    toast({ title: m.t('lemma.statusSaved', { status: m.t(`status.${status}`) }) });
  };

  return (
    <section aria-labelledby="lemma-status">
      <h2 id="lemma-status" className="text-lg font-semibold text-fg">
        {m.t('lemma.status')}
      </h2>
      <fieldset className="mt-2 grid grid-cols-2 gap-2">
        <legend className="sr-only">
          {m.t('lemma.statusLabel', { lemma: detail.lemma.lemma })}
        </legend>
        {LEMMA_STATUSES.map((s) => {
          const active = s === detail.status;
          return (
            <Button
              key={s}
              variant={active ? 'primary' : 'secondary'}
              aria-pressed={active}
              className={cn(active && 'ring-2 ring-primary ring-offset-1')}
              onClick={() => void choose(s)}
            >
              {active && <span aria-hidden="true">✓</span>}
              {m.t(`status.${s}`)}
            </Button>
          );
        })}
      </fieldset>
      <p className="mt-3 text-base">
        {detail.noteId ? (
          <Link
            to="/deck/$noteId"
            params={{ noteId: detail.noteId }}
            className="inline-flex min-h-tap items-center font-medium text-primary underline"
          >
            {m.t('lemma.note')} ›
          </Link>
        ) : (
          <span className="text-fg-muted">{m.t('lemma.noNote')}</span>
        )}
      </p>
    </section>
  );
}
