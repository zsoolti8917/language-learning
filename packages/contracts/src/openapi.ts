// Builds an OpenAPI 3.1 document from the endpoint table with zod's own JSON Schema
// conversion. Pure: `scripts/openapi.ts` writes the result to docs/openapi.json.
// Not exported from the package index, so clients do not bundle it.
import { z } from 'zod';
import * as common from './common';
import { API_BASE, type EndpointDef, endpointList } from './endpoints';
import * as entities from './entities';
import * as enums from './enums';
import { ERROR_STATUS } from './enums';
import { examples } from './fixtures';

export const OPENAPI_VERSION = '3.1.0';
export const API_VERSION = '1.0.0';

type JsonSchema = Record<string, unknown>;
type JsonObject = Record<string, unknown>;

const REF = (id: string) => `#/components/schemas/${id}`;

function stripMeta(schema: JsonSchema): JsonSchema {
  const { $schema: _s, $id: _i, ...rest } = schema;
  return rest;
}

/** Component name for an unnamed schema of an endpoint: 'notes.create' + 'Body' → 'NotesCreateBody'. */
function generatedId(name: string, part: string): string {
  return (
    name
      .split('.')
      .map((s) => s[0]?.toUpperCase() + s.slice(1))
      .join('') + part
  );
}

/**
 * Every named schema of `entities`, `common` and `enums` becomes a component, plus whatever an
 * endpoint uses inline.
 */
function buildRegistry() {
  const registry = z.registry<{ id: string }>();
  const add = (schema: z.ZodType, id: string) => {
    if (!registry.has(schema)) registry.add(schema, { id });
  };
  for (const mod of [entities, common, enums]) {
    for (const [key, value] of Object.entries(mod)) {
      if (key.endsWith('Schema') && value instanceof z.ZodType) add(value, key.slice(0, -6));
    }
  }
  for (const e of endpointList) {
    if (e.body) add(e.body, generatedId(e.name, 'Body'));
    if (e.response) add(e.response, generatedId(e.name, 'Response'));
    if (e.stream) add(e.stream, generatedId(e.name, 'Event'));
  }
  return registry;
}

/** Path and query parameters, one per field of the object schema. */
function parameters(schema: EndpointDef['params'], where: 'path' | 'query'): JsonObject[] {
  if (!schema) return [];
  const json = z.toJSONSchema(schema, { io: 'input', metadata: z.registry() }) as {
    properties?: Record<string, JsonSchema>;
    required?: string[];
  };
  return Object.entries(json.properties ?? {}).map(([name, s]) => ({
    name,
    in: where,
    required: where === 'path' || (json.required ?? []).includes(name),
    schema: s,
  }));
}

function operation(e: EndpointDef, registry: ReturnType<typeof buildRegistry>): JsonObject {
  const idOf = (s: z.ZodType) => {
    const meta = registry.get(s);
    if (!meta) throw new Error(`schema of ${e.name} is not registered`);
    return { $ref: REF(meta.id) };
  };
  const ex = examples[e.name as keyof typeof examples].ok[0] as {
    request: { body?: unknown };
    response: { body?: unknown };
    stream?: unknown[];
  };

  const op: JsonObject = {
    operationId: e.name,
    tags: [e.module],
    summary: e.summary,
  };
  const params = [...parameters(e.params, 'path'), ...parameters(e.query, 'query')];
  if (params.length) op.parameters = params;
  if (!e.auth) op.security = [];
  if (e.body) {
    op.requestBody = {
      required: true,
      content: { 'application/json': { schema: idOf(e.body), example: ex.request.body } },
    };
  }

  const responses: JsonObject = {};
  if (e.stream) {
    responses[String(e.status)] = {
      description:
        'A stream of server sent events: one `analysis`, many `delta`, one `done`. An `error` event can replace any of them and ends the stream. Each event is `event: <event>` and `data: <JSON of data>`.',
      content: { 'text/event-stream': { schema: idOf(e.stream), example: ex.stream } },
    };
  } else if (e.response) {
    responses[String(e.status)] = {
      description: e.summary,
      content: { 'application/json': { schema: idOf(e.response), example: ex.response.body } },
    };
  } else {
    responses[String(e.status)] = { description: 'No content' };
  }
  const error = (description: string) => ({
    description,
    content: { 'application/json': { schema: { $ref: REF('ErrorResponse') } } },
  });
  if (e.params || e.query || e.body) responses['400'] = error('validation_failed');
  if (e.auth) responses['401'] = error('unauthorized');
  if (e.params) responses['404'] = error('not_found');
  responses.default = error(
    `Any other error. Codes and statuses: ${Object.entries(ERROR_STATUS)
      .map(([c, s]) => `${c} ${s}`)
      .join(', ')}.`,
  );
  op.responses = responses;
  return op;
}

/** The whole OpenAPI document. Deterministic, so the committed file can be compared. */
export function buildOpenApi(): JsonObject {
  const registry = buildRegistry();
  const { schemas } = z.toJSONSchema(registry, {
    target: 'draft-2020-12',
    io: 'input',
    uri: REF,
    unrepresentable: 'throw',
  }) as { schemas: Record<string, JsonSchema> };
  if ('__shared' in schemas)
    throw new Error('unexpected shared definitions in the registry output');

  const components: Record<string, JsonSchema> = {};
  for (const id of Object.keys(schemas).sort())
    components[id] = stripMeta(schemas[id] as JsonSchema);

  const paths: Record<string, JsonObject> = {};
  for (const e of endpointList) {
    const path = e.path.replace(/:([A-Za-z]+)/g, '{$1}');
    paths[path] ??= {};
    (paths[path] as JsonObject)[e.method.toLowerCase()] = operation(e, registry);
  }

  return {
    openapi: OPENAPI_VERSION,
    info: {
      title: 'Slovak learning app API',
      version: API_VERSION,
      description:
        'Generated from packages/contracts by `pnpm openapi`. Do not edit by hand. JSON uses camelCase; timestamps are ISO 8601 in UTC.',
    },
    servers: [{ url: API_BASE }],
    security: [{ bearer: [] }],
    tags: [...new Set(endpointList.map((e) => e.module))].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
      schemas: components,
    },
  };
}

/** The file content of docs/openapi.json. */
export function renderOpenApi(): string {
  return `${JSON.stringify(buildOpenApi(), null, 2)}\n`;
}
