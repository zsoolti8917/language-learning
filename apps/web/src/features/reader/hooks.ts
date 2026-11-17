// Queries of the reader: one text with polling while it is processed, and the import.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { api, apiKey } from '../../lib/api';
import { newId } from '../../lib/ids';
import { pollDelay } from './analysis';
import { loadText, textKey } from './data';

/**
 * One text, from the server or (offline) the local database. While the text is processing,
 * it is polled again after 1 s, 1.5 s, 2.25 s and so on, up to every 10 s.
 */
export function useText(id: string) {
  return useQuery({
    queryKey: textKey(id),
    queryFn: ({ signal }) => loadText(id, signal),
    refetchInterval: (query) =>
      query.state.data?.text.status === 'processing'
        ? pollDelay(Math.max(0, query.state.dataUpdateCount - 1))
        : false,
    // The fallback to the stored copy needs the query function to run while offline too.
    networkMode: 'always',
    retry: false,
  });
}

/** Sends a text to `POST /texts` under a new id and returns that id. */
export async function createText(body: string, title: string): Promise<string> {
  const id = newId();
  const trimmed = title.trim();
  await api.texts.create({ body: { id, body, ...(trimmed ? { title: trimmed } : {}) } });
  return id;
}

/** After a failed analysis: drop the failed text, send the body again, open the new one. */
export function useReimport() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return useCallback(
    async (failed: { id: string; body: string; title: string }) => {
      const id = await createText(failed.body, failed.title);
      api.texts.delete({ params: { id: failed.id } }).catch(() => {});
      void queryClient.invalidateQueries({ queryKey: apiKey('texts.list').slice(0, 2) });
      await navigate({ to: '/read/$textId', params: { textId: id }, replace: true });
      return id;
    },
    [navigate, queryClient],
  );
}
