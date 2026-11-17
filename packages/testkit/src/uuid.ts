// UUID version 7, as the client makes them for learner rows. Time ordered.
import { randomBytes } from 'node:crypto';

let lastMs = 0;
let seq = 0;

export function uuidv7(now: number = Date.now()): string {
  // A counter in the random part keeps ids made in the same millisecond ordered.
  if (now === lastMs) seq = (seq + 1) & 0xfff;
  else {
    lastMs = now;
    seq = 0;
  }
  const b = randomBytes(16);
  b.writeUIntBE(now, 0, 6);
  b[6] = 0x70 | (seq >> 8);
  b[7] = seq & 0xff;
  b[8] = 0x80 | ((b[8] ?? 0) & 0x3f);
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
