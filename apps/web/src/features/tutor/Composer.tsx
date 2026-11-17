// The message field: Slovak input with the accent bar (with capitals) and the character limit.
import { LIMITS } from '@app/contracts';
import { useRef, useState } from 'react';
import { AccentBar, AnswerInput, Button } from '../../ui';
import { m } from './messages';

/** The counter shows once fewer than this many characters are left. */
export const COUNTER_FROM = 100;

export function Composer({
  off,
  canSend,
  onSend,
}: {
  /** Switched off entirely: offline, budget used up. The text typed so far stays. */
  off: boolean;
  /** False while a turn is running or waits for a retry. */
  canSend: boolean;
  onSend: (text: string) => void;
}) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const max = LIMITS.tutorMessageChars;
  const left = max - value.length;
  const ready = !off && canSend && value.trim().length > 0 && left >= 0;

  const submit = () => {
    if (!ready) return;
    onSend(value);
    setValue('');
  };

  return (
    <form
      className="flex flex-col gap-1 border-t border-border bg-bg px-gutter pt-2 pb-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex items-start gap-2">
        <AnswerInput
          className="min-w-0 flex-1 gap-0"
          label={m.t('composer.label')}
          hideLabel
          value={value}
          onValueChange={(v) => setValue(v.slice(0, max))}
          onSubmit={submit}
          inputRef={inputRef}
          accentBar={false}
          disabled={off}
          maxLength={max}
          placeholder={m.t('composer.placeholder')}
          enterKeyHint="send"
          feedback={left < COUNTER_FROM ? m.t('composer.remaining', { count: left }) : undefined}
        />
        <Button type="submit" disabled={!ready}>
          {m.t('composer.send')}
        </Button>
      </div>
      <AccentBar
        target={inputRef}
        allowUppercase
        label={m.t('composer.accentBar')}
        shiftLabel={m.t('composer.shift')}
        disabled={off}
      />
    </form>
  );
}
