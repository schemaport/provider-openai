import type { CanonicalTool, Diagnostic, JsonSchema } from '@schemaport/core';
import {
  asSchema,
  compilable,
  compilableLossy,
  diagnostic,
  isPlainObject,
  joinPath,
  notCompilable,
  schemaTypes,
} from '@schemaport/core';
import {
  ANNOTATION_KEYWORDS,
  classifyKeyword,
  SUPPORTED_FORMATS,
  UNDOCUMENTED_CONSTRAINT_KEYWORDS,
  UNSUPPORTED_CONSTRAINT_KEYWORDS,
} from './keywords.js';
import {
  DOC_CHAT_CREATE,
  DOC_FUNCTION_CALLING,
  DOC_RESPONSES_CREATE,
  DOC_STRUCTURED_OUTPUTS,
} from './docs.js';

export const PROVIDER_ID = 'openai';

/* -------------------------------------------------------------------------- */
/* Documented limits                                                           */
/* -------------------------------------------------------------------------- */

/** "a maximum length of 64" — Chat Completions API reference, `function.name`. */
export const MAX_TOOL_NAME_LENGTH = 64;

/** "Must be a-z, A-Z, 0-9, or contain underscores and dashes" — same source. */
export const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

/** "a maximum of 5000 total object properties" — structured outputs guide. */
export const MAX_TOTAL_PROPERTIES = 5000;

/** "up to 10 levels of nesting" — structured outputs guide. */
export const MAX_NESTING_DEPTH = 10;

/** "up to 1000 enum values across all properties" — structured outputs guide. */
export const MAX_TOTAL_ENUM_VALUES = 1000;

/**
 * "for a single enum property with more than 250 values, the total string
 * length of all enum values cannot exceed 15,000 characters".
 */
export const LARGE_ENUM_VALUE_COUNT = 250;
export const LARGE_ENUM_MAX_STRING_LENGTH = 15_000;

/**
 * "a limit of 120,000 characters across all property names, definition names,
 * enum values and const values".
 */
export const MAX_TOTAL_STRING_LENGTH = 120_000;

/* -------------------------------------------------------------------------- */
/* Diagnostic helper                                                           */
/* -------------------------------------------------------------------------- */

interface Init {
  toolName: string;
  severity: Diagnostic['severity'];
  code: string;
  message: string;
  path: string;
  compile: Diagnostic['compile'];
  docsUrl: string;
}

function make(init: Init): Diagnostic {
  return diagnostic({
    providerId: PROVIDER_ID,
    toolName: init.toolName,
    severity: init.severity,
    code: init.code,
    message: init.message,
    path: init.path,
    compile: init.compile,
    docsUrl: init.docsUrl,
  });
}

/* -------------------------------------------------------------------------- */
/* Tool-level rules                                                            */
/* -------------------------------------------------------------------------- */

/**
 * OpenAI restricts function names to `a-z A-Z 0-9 _ -`, maximum 64 characters.
 *
 * Compile does not rename tools: the name is the identifier the caller's own
 * dispatch code matches on, so renaming it silently would break the caller.
 */
export function checkToolName(tool: CanonicalTool): Diagnostic[] {
  const out: Diagnostic[] = [];
  if (!TOOL_NAME_PATTERN.test(tool.name)) {
    out.push(
      make({
        toolName: tool.name,
        severity: 'error',
        code: 'openai/tool-name-invalid-characters',
        message:
          `Tool name \`${tool.name}\` contains characters OpenAI does not allow. ` +
          'Function names must use only letters, digits, underscores and dashes.',
        path: 'name',
        compile: notCompilable('Refused: renaming the tool would change the identifier callers dispatch on.'),
        docsUrl: DOC_CHAT_CREATE,
      }),
    );
  }
  if (tool.name.length > MAX_TOOL_NAME_LENGTH) {
    out.push(
      make({
        toolName: tool.name,
        severity: 'error',
        code: 'openai/tool-name-too-long',
        message:
          `Tool name is ${tool.name.length} characters; OpenAI allows at most ${MAX_TOOL_NAME_LENGTH}.`,
        path: 'name',
        compile: notCompilable('Refused: truncating the tool name would change the identifier callers dispatch on.'),
        docsUrl: DOC_CHAT_CREATE,
      }),
    );
  }
  return out;
}

/** A missing description makes the model's tool-selection decision harder. */
export function checkToolDescription(tool: CanonicalTool): Diagnostic[] {
  if (tool.description !== undefined && tool.description.trim().length > 0) return [];
  return [
    make({
      toolName: tool.name,
      severity: 'info',
      code: 'openai/missing-tool-description',
      message:
        'Tool has no description. OpenAI uses the description to decide whether to call the function.',
      path: 'description',
      compile: compilable('Emits the tool without a `description` field.'),
      docsUrl: DOC_RESPONSES_CREATE,
    }),
  ];
}

/** "The root level object of a schema must be an object" and cannot use `anyOf`. */
export function checkRootSchema(tool: CanonicalTool): Diagnostic[] {
  const out: Diagnostic[] = [];
  const root = tool.inputSchema;
  const types = schemaTypes(root);
  if (types.length !== 1 || types[0] !== 'object') {
    out.push(
      make({
        toolName: tool.name,
        severity: 'error',
        code: 'openai/root-schema-not-object',
        message:
          'The root of a tool parameter schema must be `{"type": "object"}` for OpenAI. ' +
          `Found ${types.length === 0 ? 'no declared type' : `\`${types.join(' | ')}\``}.`,
        path: 'inputSchema',
        compile: notCompilable('Refused: SchemaPort will not invent an object wrapper around the root schema.'),
        docsUrl: DOC_STRUCTURED_OUTPUTS,
      }),
    );
  }
  if (Array.isArray(root['anyOf'])) {
    out.push(
      make({
        toolName: tool.name,
        severity: 'error',
        code: 'openai/root-schema-anyof',
        message: 'OpenAI does not allow `anyOf` at the root of a tool parameter schema.',
        path: joinPath('inputSchema', 'anyOf'),
        compile: notCompilable('Refused: collapsing a root union would change which arguments are accepted.'),
        docsUrl: DOC_STRUCTURED_OUTPUTS,
      }),
    );
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Object rules                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Whether compile treats this subschema as an object that strict mode requires
 * to be closed and fully required.
 *
 * `type: 'object'` is the obvious case; a schema that only carries
 * `properties`, `required` or `additionalProperties` is an object in practice
 * and is treated as one, so those keywords are never dropped unnoticed.
 */
export function isObjectSchema(schema: JsonSchema): boolean {
  return (
    schemaTypes(schema).includes('object') ||
    isPlainObject(schema.properties) ||
    Array.isArray(schema.required) ||
    schema.additionalProperties !== undefined
  );
}

/**
 * Strict mode requires every property to appear in `required`. Compile makes
 * the property required and unions its type with `null`, which is the encoding
 * OpenAI documents for optional fields.
 *
 * This is reported as a **warning**, not an error: compile always fixes it, but
 * it changes what the model emits at runtime — `{"amount": null}` instead of
 * omitting `amount` — and the caller needs to see that on a successful compile.
 */
export function checkOptionalProperties(
  toolName: string,
  schema: JsonSchema,
  path: string,
): Diagnostic[] {
  const properties = schema.properties;
  if (!isPlainObject(properties)) return [];
  const required = Array.isArray(schema.required) ? schema.required : [];
  const out: Diagnostic[] = [];
  for (const name of Object.keys(properties)) {
    if (required.includes(name)) continue;
    out.push(
      make({
        toolName,
        severity: 'warning',
        code: 'openai/strict-optional-property',
        message:
          `Optional property \`${name}\` cannot stay optional in OpenAI strict mode. ` +
          'It is emitted as required and nullable, so the model may send ' +
          `\`${name}: null\` where the canonical schema expected the key to be omitted.`,
        path: joinPath(path, 'properties', name),
        compile: compilable(`Emits \`${name}\` as required with \`null\` added to its type.`),
        docsUrl: DOC_FUNCTION_CALLING,
      }),
    );
  }
  return out;
}

/**
 * Strict mode requires `additionalProperties: false` on every object.
 *
 * Three cases, three codes:
 *  - absent  — compile adds it; nothing the canonical schema promised is lost.
 *  - `true`  — the schema explicitly allowed extra keys; closing it is still not
 *              lossy (the compiled schema accepts *fewer* values) but it is a
 *              real behaviour change, so it survives as a warning.
 *  - schema  — an open typed map. Strict mode has no way to express it, so the
 *              map is erased: lossy.
 */
export function checkAdditionalProperties(
  toolName: string,
  schema: JsonSchema,
  path: string,
): Diagnostic[] {
  if (!isObjectSchema(schema)) return [];
  const value = schema.additionalProperties;
  const at = joinPath(path, 'additionalProperties');

  if (value === undefined) {
    return [
      make({
        toolName,
        severity: 'error',
        code: 'openai/object-missing-additional-properties',
        message:
          'OpenAI strict mode requires `additionalProperties: false` on every object schema.',
        path: at,
        compile: compilable('Adds `additionalProperties: false`.'),
        docsUrl: DOC_STRUCTURED_OUTPUTS,
      }),
    ];
  }

  if (value === true) {
    return [
      make({
        toolName,
        severity: 'warning',
        code: 'openai/additional-properties-true',
        message:
          'This object explicitly allows extra properties, which OpenAI strict mode forbids. ' +
          'The compiled schema is closed, so the model can no longer send undeclared keys.',
        path: at,
        compile: compilable('Replaces `additionalProperties: true` with `false`.'),
        docsUrl: DOC_STRUCTURED_OUTPUTS,
      }),
    ];
  }

  if (asSchema(value) !== undefined) {
    return [
      make({
        toolName,
        severity: 'error',
        code: 'openai/additional-properties-schema',
        message:
          'OpenAI strict mode cannot express an open map with a typed value schema; ' +
          '`additionalProperties` must be `false`. The map and its value type are dropped.',
        path: at,
        compile: compilableLossy('Replaces the value schema with `additionalProperties: false`, dropping the map.'),
        docsUrl: DOC_STRUCTURED_OUTPUTS,
      }),
    ];
  }

  return [];
}

/* -------------------------------------------------------------------------- */
/* Keyword rules                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Report every keyword on this schema that compile will not emit verbatim.
 *
 * `$defs`/`$ref` are supported (including recursive references), so they are
 * left alone.
 */
export function checkKeywords(toolName: string, schema: JsonSchema, path: string): Diagnostic[] {
  const out: Diagnostic[] = [];

  for (const keyword of Object.keys(schema)) {
    const at = joinPath(path, keyword);
    switch (classifyKeyword(keyword)) {
      case 'supported':
        break;
      case 'annotation':
        out.push(
          make({
            toolName,
            severity: 'info',
            code: 'openai/annotation-keyword-dropped',
            message:
              `\`${keyword}\` is not part of OpenAI's supported schema subset and is dropped. ` +
              'It does not constrain which arguments are accepted.',
            path: at,
            compile: compilable(`Drops \`${keyword}\`.`),
            docsUrl: DOC_STRUCTURED_OUTPUTS,
          }),
        );
        break;
      case 'unsupported-constraint':
        out.push(
          make({
            toolName,
            severity: 'error',
            code: 'openai/unsupported-keyword',
            message:
              `OpenAI's structured outputs guide names \`${keyword}\` as unsupported. ` +
              'Dropping it means the compiled schema accepts arguments the canonical schema rejects.',
            path: at,
            compile: compilableLossy(`Drops \`${keyword}\`; the constraint is no longer enforced.`),
            docsUrl: DOC_STRUCTURED_OUTPUTS,
          }),
        );
        break;
      case 'undocumented-constraint':
        out.push(
          make({
            toolName,
            severity: 'error',
            code: 'openai/undocumented-constraint-keyword',
            message:
              `\`${keyword}\` is absent from OpenAI's list of supported schema properties, but is ` +
              'not named as unsupported either, and SchemaPort could not confirm from official ' +
              'documentation whether OpenAI enforces it, ignores it or rejects it. It is dropped ' +
              'rather than emitted unverified, which means the compiled schema accepts arguments ' +
              'the canonical schema rejects.',
            path: at,
            compile: compilableLossy(
              `Drops \`${keyword}\`; SchemaPort cannot promise OpenAI would have enforced it.`,
            ),
            docsUrl: DOC_STRUCTURED_OUTPUTS,
          }),
        );
        break;
      case 'unknown':
        out.push(
          make({
            toolName,
            severity: 'error',
            code: 'openai/unknown-keyword',
            message:
              `\`${keyword}\` is not documented by OpenAI as supported and SchemaPort cannot ` +
              'verify whether it constrains arguments, so it is dropped and treated as lossy.',
            path: at,
            compile: compilableLossy(`Drops the undocumented keyword \`${keyword}\`.`),
            docsUrl: DOC_STRUCTURED_OUTPUTS,
          }),
        );
        break;
      case 'rewritten':
        out.push(...checkRewrittenKeyword(toolName, schema, path, keyword));
        break;
    }
  }

  out.push(...checkFormat(toolName, schema, path));
  return out;
}

function checkRewrittenKeyword(
  toolName: string,
  schema: JsonSchema,
  path: string,
  keyword: string,
): Diagnostic[] {
  const at = joinPath(path, keyword);
  switch (keyword) {
    case 'const':
      return [
        make({
          toolName,
          severity: 'info',
          code: 'openai/const-converted-to-enum',
          message:
            '`const` is not in OpenAI\'s supported subset. It is emitted as a single-value ' +
            '`enum`, which accepts exactly the same value.',
          path: at,
          compile: compilable('Emits `enum: [<const value>]`.'),
          docsUrl: DOC_STRUCTURED_OUTPUTS,
        }),
      ];
    case 'oneOf':
      return [
        make({
          toolName,
          severity: 'error',
          code: 'openai/one-of-converted-to-any-of',
          message:
            'OpenAI supports `anyOf` but not `oneOf`. Emitting the branches as `anyOf` accepts ' +
            'values that match more than one branch, which `oneOf` rejects.',
          path: at,
          compile: compilableLossy('Emits the `oneOf` branches as `anyOf`; exclusivity is not enforced.'),
          docsUrl: DOC_STRUCTURED_OUTPUTS,
        }),
      ];
    case 'definitions':
      if (isPlainObject(schema['$defs'])) {
        return [
          make({
            toolName,
            severity: 'error',
            code: 'openai/unsupported-keyword',
            message:
              'Both `definitions` and `$defs` are present. OpenAI documents `$defs` only, and ' +
              'SchemaPort will not merge the two, so `definitions` is dropped.',
            path: at,
            compile: compilableLossy('Drops `definitions`; any `#/definitions/...` reference will dangle.'),
            docsUrl: DOC_STRUCTURED_OUTPUTS,
          }),
        ];
      }
      return [
        make({
          toolName,
          severity: 'warning',
          code: 'openai/legacy-definitions-keyword',
          message:
            'OpenAI documents `$defs` for reusable subschemas, not the draft-07 `definitions` ' +
            'keyword. The definitions are renamed and `#/definitions/...` references rewritten.',
          path: at,
          compile: compilable('Renames `definitions` to `$defs` and rewrites `$ref` pointers.'),
          docsUrl: DOC_STRUCTURED_OUTPUTS,
        }),
      ];
    case 'nullable':
      if (schema['nullable'] !== true) {
        return [
          make({
            toolName,
            severity: 'info',
            code: 'openai/annotation-keyword-dropped',
            message:
              '`nullable: false` is an OpenAPI 3.0 keyword OpenAI does not accept. It is dropped; ' +
              'the type union already excludes `null`.',
            path: at,
            compile: compilable('Drops `nullable`.'),
            docsUrl: DOC_STRUCTURED_OUTPUTS,
          }),
        ];
      }
      return [
        make({
          toolName,
          severity: 'warning',
          code: 'openai/nullable-keyword-converted',
          message:
            '`nullable: true` is an OpenAPI 3.0 keyword OpenAI does not accept. It is expressed ' +
            'as a JSON Schema type union that includes `"null"`.',
          path: at,
          compile: compilable('Adds `"null"` to `type` and drops `nullable`.'),
          docsUrl: DOC_STRUCTURED_OUTPUTS,
        }),
      ];
    case 'default':
      return [
        make({
          toolName,
          severity: 'warning',
          code: 'openai/default-keyword-dropped',
          message:
            '`default` is not in OpenAI\'s supported schema subset and is dropped. The model no ' +
            'longer sees the default value, so it will choose one itself for this property.',
          path: at,
          compile: compilable('Drops `default`.'),
          docsUrl: DOC_STRUCTURED_OUTPUTS,
        }),
      ];
    default:
      return [];
  }
}

/** OpenAI enumerates the `format` values it supports; anything else is dropped. */
export function checkFormat(toolName: string, schema: JsonSchema, path: string): Diagnostic[] {
  const format = schema.format;
  if (typeof format !== 'string' || SUPPORTED_FORMATS.includes(format)) return [];
  return [
    make({
      toolName,
      severity: 'error',
      code: 'openai/unsupported-string-format',
      message:
        `OpenAI does not support \`format: "${format}"\`. Supported values are ` +
        `${SUPPORTED_FORMATS.join(', ')}. Dropping it means the compiled schema accepts strings ` +
        'the canonical schema rejects.',
      path: joinPath(path, 'format'),
      compile: compilableLossy(`Drops \`format: "${format}"\`.`),
      docsUrl: DOC_STRUCTURED_OUTPUTS,
    }),
  ];
}

/* -------------------------------------------------------------------------- */
/* Budget rules                                                                */
/* -------------------------------------------------------------------------- */

export interface SchemaBudget {
  totalProperties: number;
  maxDepth: number;
  totalEnumValues: number;
  totalStringLength: number;
  /** Paths of enum properties that exceed the large-enum string budget. */
  oversizedEnumPaths: string[];
}

/**
 * Measure the schema against OpenAI's documented size limits.
 *
 * Depth counts schema nesting levels with the root at 1, descending through
 * `properties`, `items`, `anyOf`, `oneOf`, `prefixItems`, `$defs`/`definitions`
 * and a schema-valued `additionalProperties`.
 */
export function measureSchema(root: JsonSchema, rootPath: string): SchemaBudget {
  const budget: SchemaBudget = {
    totalProperties: 0,
    maxDepth: 0,
    totalEnumValues: 0,
    totalStringLength: 0,
    oversizedEnumPaths: [],
  };

  const visit = (schema: JsonSchema, path: string, depth: number): void => {
    budget.maxDepth = Math.max(budget.maxDepth, depth);

    if (Array.isArray(schema.enum)) {
      budget.totalEnumValues += schema.enum.length;
      const stringLength = schema.enum.reduce<number>(
        (sum, value) => sum + (typeof value === 'string' ? value.length : 0),
        0,
      );
      budget.totalStringLength += stringLength;
      if (schema.enum.length > LARGE_ENUM_VALUE_COUNT && stringLength > LARGE_ENUM_MAX_STRING_LENGTH) {
        budget.oversizedEnumPaths.push(joinPath(path, 'enum'));
      }
    }
    if (typeof schema.const === 'string') budget.totalStringLength += schema.const.length;

    for (const keyword of ['properties', '$defs', 'definitions'] as const) {
      const map = schema[keyword];
      if (!isPlainObject(map)) continue;
      for (const [key, value] of Object.entries(map)) {
        if (keyword === 'properties') budget.totalProperties += 1;
        budget.totalStringLength += key.length;
        const child = asSchema(value);
        if (child) visit(child, joinPath(path, keyword, key), depth + 1);
      }
    }

    for (const keyword of ['anyOf', 'oneOf', 'allOf', 'prefixItems'] as const) {
      const list = schema[keyword];
      if (!Array.isArray(list)) continue;
      list.forEach((value, index) => {
        const child = asSchema(value);
        if (child) visit(child, joinPath(path, keyword, index), depth + 1);
      });
    }

    for (const keyword of ['items', 'additionalProperties', 'not'] as const) {
      const child = asSchema(schema[keyword]);
      if (child) visit(child, joinPath(path, keyword), depth + 1);
    }
  };

  visit(root, rootPath, 1);
  return budget;
}

export function checkBudget(tool: CanonicalTool): Diagnostic[] {
  const budget = measureSchema(tool.inputSchema, 'inputSchema');
  const out: Diagnostic[] = [];
  const refuse = (code: string, message: string, path: string): void => {
    out.push(
      make({
        toolName: tool.name,
        severity: 'error',
        code,
        message,
        path,
        compile: notCompilable('Refused: SchemaPort will not delete parts of the schema to fit a size limit.'),
        docsUrl: DOC_STRUCTURED_OUTPUTS,
      }),
    );
  };

  if (budget.totalProperties > MAX_TOTAL_PROPERTIES) {
    refuse(
      'openai/too-many-properties',
      `Schema declares ${budget.totalProperties} properties; OpenAI allows at most ${MAX_TOTAL_PROPERTIES}.`,
      'inputSchema',
    );
  }
  if (budget.maxDepth > MAX_NESTING_DEPTH) {
    refuse(
      'openai/schema-too-deep',
      `Schema nests ${budget.maxDepth} levels deep; OpenAI allows at most ${MAX_NESTING_DEPTH}.`,
      'inputSchema',
    );
  }
  if (budget.totalEnumValues > MAX_TOTAL_ENUM_VALUES) {
    refuse(
      'openai/too-many-enum-values',
      `Schema declares ${budget.totalEnumValues} enum values; OpenAI allows at most ${MAX_TOTAL_ENUM_VALUES} across all properties.`,
      'inputSchema',
    );
  }
  for (const path of budget.oversizedEnumPaths) {
    refuse(
      'openai/large-enum-too-long',
      `An enum with more than ${LARGE_ENUM_VALUE_COUNT} values may not exceed ${LARGE_ENUM_MAX_STRING_LENGTH} characters of total string length.`,
      path,
    );
  }
  if (budget.totalStringLength > MAX_TOTAL_STRING_LENGTH) {
    refuse(
      'openai/schema-too-large',
      `Property names, definition names and enum values total ${budget.totalStringLength} characters; OpenAI allows at most ${MAX_TOTAL_STRING_LENGTH}.`,
      'inputSchema',
    );
  }
  return out;
}

/** Re-exported so docs and tests can enumerate what compile drops, by evidence tier. */
export const DROPPED_KEYWORDS = Object.freeze({
  /** Named as unsupported by OpenAI. */
  documentedUnsupported: UNSUPPORTED_CONSTRAINT_KEYWORDS,
  /** Absent from OpenAI's supported list; support status unconfirmed. */
  undocumented: UNDOCUMENTED_CONSTRAINT_KEYWORDS,
  /** Non-constraining, safe to drop. */
  annotations: ANNOTATION_KEYWORDS,
});
