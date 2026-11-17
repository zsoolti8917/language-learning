import { v7 } from 'uuid';

/**
 * A new client made id (UUID v7, time ordered). Every write that creates something carries
 * one, so repeating the write is harmless.
 */
export function newId(): string {
  return v7();
}
