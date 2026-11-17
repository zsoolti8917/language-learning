// The learner's day: it starts at `dayStartHour` in the learner's time zone (default 04:00
// Europe/Bratislava). Daily caps and the model budget count from there.

/** The offset of `tz` from UTC at instant `t`, in milliseconds (positive east of UTC). */
function offsetMs(t: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(t));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return wall - Math.floor(t / 1000) * 1000;
}

/** The UTC instant of a wall clock time in `tz`. */
function fromWall(y: number, m: number, d: number, h: number, tz: string): number {
  const guess = Date.UTC(y, m, d, h);
  let t = guess - offsetMs(guess, tz);
  // A second pass settles a change of offset (summer time) between guess and result.
  t = guess - offsetMs(t, tz);
  return t;
}

/** True when `tz` is a time zone name the runtime knows. */
export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The start of the learner day that contains `now`, and the start of the next one. */
export function learnerDay(
  now: Date,
  timezone: string,
  dayStartHour: number,
): { start: Date; end: Date } {
  const tz = isTimeZone(timezone) ? timezone : 'UTC';
  const t = now.getTime();
  const wall = new Date(t + offsetMs(t, tz));
  let y = wall.getUTCFullYear();
  let m = wall.getUTCMonth();
  let d = wall.getUTCDate();
  if (wall.getUTCHours() < dayStartHour) {
    const prev = new Date(Date.UTC(y, m, d - 1));
    y = prev.getUTCFullYear();
    m = prev.getUTCMonth();
    d = prev.getUTCDate();
  }
  return {
    start: new Date(fromWall(y, m, d, dayStartHour, tz)),
    end: new Date(fromWall(y, m, d + 1, dayStartHour, tz)),
  };
}
