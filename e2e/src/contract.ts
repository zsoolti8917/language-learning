// Response validation during the flows: every API answer the browser (or a test) receives is
// checked against its contract schema, so any drift between the API and the contracts fails
// the test that saw it.
import {
  API_BASE,
  type EndpointDef,
  ErrorResponseSchema,
  endpointList,
  TutorStreamEventSchema,
} from '@app/contracts';

interface Matcher {
  def: EndpointDef;
  re: RegExp;
}

const MATCHERS: Matcher[] = endpointList.map((def) => ({
  def,
  re: new RegExp(`^${def.path.replace(/:[A-Za-z]+/g, '[^/]+')}$`),
}));

/** The endpoint of a method and a path below `/api/v1`; undefined when none matches. */
export function endpointOf(method: string, pathname: string): EndpointDef | undefined {
  if (!pathname.startsWith(`${API_BASE}/`)) return undefined;
  const path = pathname.slice(API_BASE.length);
  return MATCHERS.find((m) => m.def.method === method.toUpperCase() && m.re.test(path))?.def;
}

/** Parses an event stream body into its events. */
export function parseEventStream(text: string): { event: string; data: unknown }[] {
  const out: { event: string; data: unknown }[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (data.length === 0) continue;
    out.push({ event, data: JSON.parse(data.join('\n')) });
  }
  return out;
}

function issuesOf(error: unknown): string {
  const issues = (error as { issues?: { path: PropertyKey[]; message: string }[] }).issues;
  if (!issues) return String(error);
  return issues
    .slice(0, 5)
    .map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

/**
 * Checks one response. Returns a description of every way it breaks the contract (empty when
 * it keeps it). Errors must have the error shape; successes the endpoint's status and schema.
 */
export function checkResponse(
  method: string,
  pathname: string,
  status: number,
  contentType: string,
  body: string,
): string[] {
  const def = endpointOf(method, pathname);
  const where = `${method} ${pathname} (${status})`;
  if (!def) return [`${where}: no endpoint in the contracts`];
  if (status >= 400) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return [`${where}: error body is not JSON`];
    }
    const r = ErrorResponseSchema.safeParse(parsed);
    return r.success ? [] : [`${where}: error body outside the contract: ${issuesOf(r.error)}`];
  }
  const problems: string[] = [];
  // A repeated create answers 200 with the stored row (API conventions, "Repeats are harmless").
  const repeat = (def.status === 201 || def.status === 202) && status === 200;
  if (status !== def.status && !repeat)
    problems.push(`${where}: status ${status}, the contract says ${def.status}`);
  if (def.stream) {
    if (!contentType.includes('text/event-stream'))
      return [...problems, `${where}: not an event stream (${contentType})`];
    for (const ev of parseEventStream(body)) {
      const r = TutorStreamEventSchema.safeParse({ event: ev.event, data: ev.data });
      if (!r.success)
        problems.push(`${where}: event "${ev.event}" outside the contract: ${issuesOf(r.error)}`);
    }
    return problems;
  }
  if (!def.response) {
    if (body.length > 0) problems.push(`${where}: expected no body`);
    return problems;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [...problems, `${where}: body is not JSON`];
  }
  const r = def.response.safeParse(parsed);
  if (!r.success) problems.push(`${where} ${def.name}: outside the contract: ${issuesOf(r.error)}`);
  return problems;
}
