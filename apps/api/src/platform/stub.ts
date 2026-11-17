// Stand in answers: the first success example of an endpoint from `contracts`. F5's module
// stubs answer with them until each module's owner writes the real handler.
import {
  defaultExample,
  type EndpointDef,
  type EndpointName,
  endpoints,
  type ResponseOf,
  TUTOR_STREAM_EXAMPLE,
} from '@app/contracts';
import { sseResponse } from './sse';

/** The example body of an endpoint, parsed with its response schema. */
export function contractExample<N extends EndpointName>(name: N): ResponseOf<N> {
  const ep = endpoints[name] as EndpointDef;
  const body = defaultExample(name).response.body;
  if (!ep.response) throw new Error(`${name} has no JSON response`);
  return ep.response.parse(body) as ResponseOf<N>;
}

/** The example event stream of `POST /tutor/conversations/:id/messages`. */
export function exampleTutorStream(): Response {
  return sseResponse(async (send) => {
    for (const e of TUTOR_STREAM_EXAMPLE) send(e);
  });
}
