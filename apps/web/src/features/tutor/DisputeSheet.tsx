// "This looks wrong" on a correction: files a dispute (the server suspends the card and reports it).
import { useState } from 'react';
import { api } from '../../lib/api';
import { Button, Input, Sheet, useToast } from '../../ui';
import type { ChatError } from './chatState';
import { m } from './messages';

export function DisputeSheet({
  error,
  onClose,
  onDisputed,
}: {
  error: ChatError | null;
  onClose: () => void;
  onDisputed: (errorId: string) => void;
}) {
  const toast = useToast();
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (!error) return;
    setSending(true);
    try {
      const text = comment.trim();
      await api.tutor.disputeError({
        params: { id: error.id },
        body: text ? { comment: text } : {},
      });
      onDisputed(error.id);
      toast({ title: m.t('dispute.done'), tone: 'success' });
      setComment('');
      onClose();
    } catch {
      toast({ title: m.t('dispute.failed'), tone: 'error' });
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet
      open={error !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={m.t('dispute.title')}
      description={m.t('dispute.description')}
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" block onClick={onClose}>
            {m.t('dispute.cancel')}
          </Button>
          <Button variant="danger" block loading={sending} onClick={submit}>
            {m.t('dispute.submit')}
          </Button>
        </div>
      }
    >
      {error && (
        <div className="flex flex-col gap-3">
          <p className="text-base">
            {m.t('marks.corrected', { given: error.given, expected: error.expected ?? '' })}
          </p>
          <Input
            label={m.t('dispute.comment')}
            value={comment}
            maxLength={1000}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>
      )}
    </Sheet>
  );
}
