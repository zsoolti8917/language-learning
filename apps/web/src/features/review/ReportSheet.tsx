import type { CreateReport } from '@app/contracts';
import { useState } from 'react';
import { newId } from '../../lib/ids';
import { Button, Input, Sheet, useToast } from '../../ui';
import { m } from './messages';
import type { ReviewDeps } from './store';

/**
 * What a report on a review card points at. The contract has no report kind for a note or a
 * card, and a `ReviewItem` carries no sentence or exercise id, so the card's note and variant
 * go in `targetRef` under the kind `sentence` (recorded in docs/handoff/M2.md).
 */
export function reportTarget(card: {
  noteId: string;
  variant: number;
}): Pick<CreateReport, 'targetKind' | 'targetRef'> {
  return { targetKind: 'sentence', targetRef: `note:${card.noteId}/${card.variant}` };
}

/** The report button of a card and its sheet. The report waits in the outbox when offline. */
export function ReportSheet({
  card,
  outbox,
}: {
  card: { noteId: string; variant: number };
  outbox: ReviewDeps['outbox'];
}) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const toast = useToast();

  async function send() {
    setSending(true);
    try {
      const text = comment.trim();
      await outbox.enqueue('reports.create', {
        body: { id: newId(), ...reportTarget(card), ...(text ? { comment: text } : {}) },
      });
      toast({ title: m.messages.report.sent, tone: 'success' });
      setComment('');
      setOpen(false);
    } finally {
      setSending(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={m.messages.report.title}
      description={m.messages.report.description}
      trigger={
        <Button variant="ghost" className="text-sm text-fg-muted">
          {m.messages.report.button}
        </Button>
      }
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" block onClick={() => setOpen(false)}>
            {m.messages.report.cancel}
          </Button>
          <Button block loading={sending} onClick={() => void send()}>
            {m.messages.report.send}
          </Button>
        </div>
      }
    >
      <Input
        label={m.messages.report.comment}
        value={comment}
        maxLength={1000}
        onChange={(e) => setComment(e.target.value)}
      />
    </Sheet>
  );
}
