import type { CanonicalTool, JsonSchema } from '@schemaport/core';

/**
 * Canonical fixtures for OpenAI rules the shared `@schemaport/core` fixtures do
 * not exercise. Shared fixtures (`refundOrderTool`, `nestedTool`, ...) are
 * imported directly from core wherever they fit.
 */

const objectOf = (properties: Record<string, JsonSchema>, required: string[]): JsonSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

/** Compiles with no diagnostics at all: closed, fully required, no extras. */
export const cleanTool: CanonicalTool = {
  name: 'close_ticket',
  description: 'Closes a ticket',
  inputSchema: objectOf({ ticketId: { type: 'string' } }, ['ticketId']),
};

/** Tool name with characters OpenAI rejects. */
export const badNameTool: CanonicalTool = {
  name: 'refund.order!',
  description: 'Refunds an order',
  inputSchema: objectOf({ orderId: { type: 'string' } }, ['orderId']),
};

/** Tool name longer than 64 characters. */
export const longNameTool: CanonicalTool = {
  name: `a${'b'.repeat(70)}`,
  description: 'Long name',
  inputSchema: objectOf({ x: { type: 'string' } }, ['x']),
};

/** Root schema is not an object. */
export const scalarRootTool: CanonicalTool = {
  name: 'echo',
  description: 'Echoes a string',
  inputSchema: { type: 'string' },
};

/** Root schema uses `anyOf`, which OpenAI forbids at the root. */
export const unionRootTool: CanonicalTool = {
  name: 'either',
  description: 'Takes one of two shapes',
  inputSchema: {
    type: 'object',
    anyOf: [objectOf({ a: { type: 'string' } }, ['a']), objectOf({ b: { type: 'string' } }, ['b'])],
    properties: { a: { type: 'string' } },
    required: ['a'],
    additionalProperties: false,
  },
};

/** Object that explicitly allows extra keys. */
export const openObjectTool: CanonicalTool = {
  name: 'store_blob',
  description: 'Stores a blob with metadata',
  inputSchema: {
    type: 'object',
    properties: { meta: { type: 'object', properties: {}, additionalProperties: true } },
    required: ['meta'],
    additionalProperties: false,
  },
};

/** Uses documented-unsupported composition and string-length keywords. */
export const unsupportedKeywordTool: CanonicalTool = {
  name: 'set_code',
  description: 'Sets a code',
  inputSchema: {
    type: 'object',
    properties: {
      code: { type: 'string', minLength: 3, maxLength: 8 },
      shape: { allOf: [{ type: 'object', properties: {}, additionalProperties: false }] },
    },
    required: ['code', 'shape'],
    additionalProperties: false,
  },
};

/** Carries a keyword OpenAI does not document at all. */
export const unknownKeywordTool: CanonicalTool = {
  name: 'weird',
  description: 'Uses a vendor extension',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string', 'x-internal-tag': 'pii' } },
    required: ['id'],
    additionalProperties: false,
  },
};

/** Pure annotations, plus a `default`. */
export const annotatedTool: CanonicalTool = {
  name: 'annotate',
  description: 'Has annotations',
  inputSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    title: 'Annotate input',
    properties: {
      mode: { type: 'string', title: 'Mode', default: 'fast', examples: ['fast', 'slow'] },
    },
    required: ['mode'],
    additionalProperties: false,
  },
};

/** `const` and `oneOf`, both rewritten by compile. */
export const rewriteTool: CanonicalTool = {
  name: 'rewrite_me',
  description: 'Uses const and oneOf',
  inputSchema: {
    type: 'object',
    properties: {
      kind: { const: 'refund' },
      value: { oneOf: [{ type: 'string' }, { type: 'number' }] },
    },
    required: ['kind', 'value'],
    additionalProperties: false,
  },
};

/** Draft-07 `definitions` plus `#/definitions/...` references. */
export const definitionsTool: CanonicalTool = {
  name: 'draft07',
  description: 'Uses draft-07 definitions',
  inputSchema: {
    type: 'object',
    definitions: {
      Money: objectOf({ cents: { type: 'integer' } }, ['cents']),
    },
    properties: { total: { $ref: '#/definitions/Money' } },
    required: ['total'],
    additionalProperties: false,
  },
};

/** OpenAPI 3.0 `nullable`. */
export const nullableTool: CanonicalTool = {
  name: 'openapi_nullable',
  description: 'Uses OpenAPI nullable',
  inputSchema: {
    type: 'object',
    properties: { note: { type: 'string', nullable: true } },
    required: ['note'],
    additionalProperties: false,
  },
};

/** A `format` value outside OpenAI's supported list. */
export const badFormatTool: CanonicalTool = {
  name: 'fetch_page',
  description: 'Fetches a page',
  inputSchema: objectOf({ url: { type: 'string', format: 'uri' } }, ['url']),
};

/** An open typed map, which strict mode cannot express. */
export const typedMapTool: CanonicalTool = {
  name: 'typed_map',
  description: 'Takes a string map',
  inputSchema: {
    type: 'object',
    properties: { tags: { type: 'object', additionalProperties: { type: 'string' } } },
    required: ['tags'],
    additionalProperties: false,
  },
};

/**
 * A tool whose schema measures exactly `depth` nesting levels, counting the
 * root as level 1 and the innermost scalar leaf as the last level.
 */
export function deeplyNestedTool(depth: number): CanonicalTool {
  let schema: JsonSchema = objectOf({ leaf: { type: 'string' } }, ['leaf']);
  for (let i = 0; i < depth - 2; i += 1) {
    schema = objectOf({ next: schema }, ['next']);
  }
  return { name: 'deep', description: 'Deeply nested', inputSchema: schema };
}

/** More enum values than OpenAI's documented total. */
export function bigEnumTool(count: number, valueLength = 1): CanonicalTool {
  const values = Array.from({ length: count }, (_, i) => `v${String(i)}`.padEnd(valueLength, 'x'));
  return {
    name: 'big_enum',
    description: 'Enormous enum',
    inputSchema: objectOf({ choice: { type: 'string', enum: values } }, ['choice']),
  };
}

/** More properties than OpenAI's documented total. */
export function manyPropertiesTool(count: number): CanonicalTool {
  const properties: Record<string, JsonSchema> = {};
  for (let i = 0; i < count; i += 1) properties[`p${String(i)}`] = { type: 'string' };
  return {
    name: 'wide',
    description: 'Very wide object',
    inputSchema: objectOf(properties, Object.keys(properties)),
  };
}
