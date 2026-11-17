// /read/import: paste a text, send it, wait while it is analysed, then open it.
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { api, isApiError } from '../../lib/api';
import { useOnline } from '../../lib/pwa';
import { Button, cn, fieldClasses, Input } from '../../ui';
import { TEXT_IMPORT_MAX_CHARS } from './analysis';
import { createText, useText } from './hooks';
import { m } from './messages';
import { TextFailed, TextProcessing } from './TextStatusViews';

type Phase = { kind: 'form' } | { kind: 'processing'; id: string };

function errorText(e: unknown): string {
  if (isApiError(e)) {
    if (e.isNetwork) return m.t('import.offline');
    if (e.code === 'rate_limited') {
      const minutes = Math.max(1, Math.ceil((e.retryAfterSeconds ?? 60) / 60));
      return m.t('import.rateLimited', { minutes });
    }
  }
  return m.t('import.error');
}

export function ImportScreen() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const online = useOnline();
  const queryClient = useQueryClient();
  const bodyId = useId();

  const count = body.length;
  const over = count - TEXT_IMPORT_MAX_CHARS;
  const empty = body.trim().length === 0;
  const fieldError =
    over > 0 ? m.t('import.tooLong', { over }) : touched && empty ? m.t('import.empty') : null;

  const send = async () => {
    const failedId = phase.kind === 'processing' ? phase.id : null;
    setError(null);
    setSending(true);
    try {
      const id = await createText(body, title);
      // A retry after a failed analysis replaces the failed text.
      if (failedId) api.texts.delete({ params: { id: failedId } }).catch(() => {});
      void queryClient.invalidateQueries({ queryKey: ['api', 'texts.list'] });
      setPhase({ kind: 'processing', id });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSending(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (empty || over > 0 || sending) return;
    void send();
  };

  return (
    <section className="px-gutter py-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold text-fg">{m.t('import.title')}</h1>
        <Link to="/read" className="min-h-tap content-center text-base text-primary underline">
          {m.t('import.back')}
        </Link>
      </div>

      {phase.kind === 'processing' ? (
        <Processing
          id={phase.id}
          onRetry={send}
          retrying={sending}
          retryError={error}
          onEdit={() => {
            setError(null);
            setPhase({ kind: 'form' });
          }}
        />
      ) : (
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          <Input
            label={m.t('import.titleLabel')}
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            autoComplete="off"
          />
          <div className="flex flex-col gap-1">
            <label htmlFor={bodyId} className="text-sm font-medium text-fg">
              {m.t('import.bodyLabel')}
            </label>
            <textarea
              id={bodyId}
              lang="sk"
              rows={10}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={`${bodyId}-hint ${bodyId}-count${fieldError ? ` ${bodyId}-error` : ''}`}
              className={cn(fieldClasses, 'min-h-48 resize-y', fieldError && 'border-wrong')}
            />
            <div className="flex justify-between gap-2 text-sm text-fg-muted">
              <p id={`${bodyId}-hint`}>
                {m.t('import.bodyHint', { max: TEXT_IMPORT_MAX_CHARS.toLocaleString('en') })}
              </p>
              <p
                id={`${bodyId}-count`}
                data-testid="char-counter"
                className={cn('shrink-0 tabular-nums', over > 0 && 'font-semibold text-wrong')}
              >
                {m.t('import.counter', {
                  count: count.toLocaleString('en'),
                  max: TEXT_IMPORT_MAX_CHARS.toLocaleString('en'),
                })}
              </p>
            </div>
            {fieldError && (
              <p id={`${bodyId}-error`} className="text-sm font-medium text-wrong">
                {fieldError}
              </p>
            )}
          </div>
          {!online && (
            <p role="status" className="text-sm text-fg-muted">
              {m.t('import.offline')}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm font-medium text-wrong">
              {error}
            </p>
          )}
          <Button type="submit" block loading={sending} disabled={over > 0 || !online}>
            {sending ? m.t('import.sending') : m.t('import.submit')}
          </Button>
        </form>
      )}
    </section>
  );
}

function Processing({
  id,
  onRetry,
  retrying,
  retryError,
  onEdit,
}: {
  id: string;
  onRetry: () => void;
  retrying: boolean;
  retryError: string | null;
  onEdit: () => void;
}) {
  const navigate = useNavigate();
  const query = useText(id);
  const status = query.data?.text.status;

  useEffect(() => {
    if (status === 'ready') {
      void navigate({ to: '/read/$textId', params: { textId: id }, replace: true });
    }
  }, [status, id, navigate]);

  if (query.isError || status === 'failed') {
    return (
      <TextFailed
        error={retryError ?? (status === 'failed' ? query.data?.text.error : null)}
        onRetry={() => (status === 'failed' ? onRetry() : void query.refetch())}
        retrying={retrying || query.isFetching}
        extra={
          <Button variant="ghost" onClick={onEdit}>
            {m.t('import.edit')}
          </Button>
        }
      />
    );
  }
  return <TextProcessing />;
}
