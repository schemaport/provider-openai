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
export const MAX_NESTING_DEPTH = 11;

/**
 * Depth at which SchemaPort starts warning that a schema is close to
 * `MAX_NESTING_DEPTH`.
 *
 * **Not an OpenAI limit.** OpenAI documents only the hard ceiling; this is
 * SchemaPort's own early-warning margin. It is two levels wide — the last two
 * usable depths, 9 and 10 of 10 — so a schema is flagged before the next
 * nested property pushes it over and OpenAI starts rejecting the tool.
 */
export const NESTING_DEPTH_WARNING_THRESHOLD = MAX_NESTING_DEPTH - 1;

/**
 * Fraction of a size limit at which SchemaPort warns that headroom is running
 * out.
 *
 * The depth limit gets an absolute threshold because it is a small integer:
 * one level from eleven is a meaningful amount of room. The count limits are in
 * the thousands, where "one away" is not actionable and a proportion is.
 *
 * 90% is a judgement, not a documented figure. It is high enough that an
 * ordinary schema never trips it and low enough to leave time to act.
 */
export const SIZE_WARNING_FRACTION = 0.9;

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
 * This produces **two** diagnostics per optional property, because there are
 * two independent facts to report:
 *
 *  - `openai/strict-optional-property` (**error**) — the canonical schema *as
 *    written* is not acceptable to OpenAI strict mode. `check` must say so, or
 *    a CI run gated on errors would pass a schema that cannot be sent.
 *    `finalizeCompile` drops it from a successful compile result, which is
 *    right: there the `converted-optional-property-to-nullable` transformation
 *    is the record of what happened.
 *  - `openai/nullable-instead-of-omitted` (**warning**) — after compilation the
 *    model may send `null` where the canonical schema expected the key to be
 *    omitted. That is a runtime behaviour change and it must survive into the
 *    compile result and the manifest.
 *
 * The warning is emitted only for properties the conversion actually touches.
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
    const at = joinPath(path, 'properties', name);
    out.push(
      make({
        toolName,
        severity: 'error',
        code: 'openai/strict-optional-property',
        message: `Optional property \`${name}\` is not allowed in OpenAI strict mode; every property must be listed in \`required\`.`,
        path: at,
        compile: compilable(`Emits \`${name}\` as required and nullable.`),
        docsUrl: DOC_FUNCTION_CALLING,
      }),
      make({
        toolName,
        severity: 'warning',
        code: 'openai/nullable-instead-of-omitted',
        message:
          `After compilation the model may send \`${name}: null\` instead of omitting the ` +
          `property. Treat \`null\` as "not supplied" in the handler for \`${toolName}\`.`,
        path: at,
        compile: compilable(`Adds \`"null"\` to the type of \`${name}\`; the key is always present.`),
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
    // Two facts again: OpenAI rejects `true` outright, and closing the object
    // changes what the model may emit. See `checkOptionalProperties`.
    return [
      make({
        toolName,
        severity: 'error',
        code: 'openai/additional-properties-true',
        message:
          'This object sets `additionalProperties: true`, which OpenAI strict mode forbids; ' +
          'it must be `false`.',
        path: at,
        compile: compilable('Replaces `additionalProperties: true` with `false`.'),
        docsUrl: DOC_STRUCTURED_OUTPUTS,
      }),
      make({
        toolName,
        severity: 'warning',
        code: 'openai/extra-properties-no-longer-accepted',
        message:
          'After compilation this object is closed, so the model can no longer send the ' +
          'undeclared keys the canonical schema explicitly allowed.',
        path: at,
        compile: compilable('Emits `additionalProperties: false`; undeclared keys are rejected.'),
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
            code: 'openai/conflicting-definitions-keywords',
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

/**
 * Compare the measured schema against OpenAI's documented size limits.
 *
 * Every limit that is *exceeded* is an error whose compile ability is
 * `notCompilable`: trimming a schema to fit would mean deleting parts of the
 * caller's contract, which SchemaPort will not do.
 *
 * Nesting depth is the one limit with a second, softer finding underneath it.
 * A schema at depth 9 or 10 is accepted by OpenAI today and compiles
 * unchanged, but the next nested property added to it will not be — so
 * `openai/schema-nesting-near-limit` reports the approach as a **warning**
 * with a plain `compilable` ability. It is emitted only below the ceiling;
 * over it, `openai/schema-too-deep` fires alone.
 */
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

  /**
   * Warn when a budget is within {@link SIZE_WARNING_FRACTION} of its limit.
   *
   * Only reached from the `else` branch of each limit check: once a schema is
   * over a limit the refusal is the whole story, and a second finding about
   * the same number would be noise.
   */
  const nearLimit = (code: string, used: number, limit: number, stated: string): void => {
    if (used <= limit * SIZE_WARNING_FRACTION) return;
    const headroom = limit - used;
    out.push(
      make({
        toolName: tool.name,
        severity: 'warning',
        code,
        message:
          `${stated} ` +
          (headroom === 0
            ? 'There is no headroom left: any addition will make OpenAI reject the tool.'
            : `That leaves room for ${headroom} more; beyond that OpenAI will reject the tool.`),
        path: 'inputSchema',
        compile: compilable(
          'Compiles unchanged. The schema is within the limit; this is advance warning only.',
        ),
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
  } else {
    nearLimit(
      'openai/property-count-near-limit',
      budget.totalProperties,
      MAX_TOTAL_PROPERTIES,
      `Schema declares ${budget.totalProperties} properties; OpenAI allows at most ${MAX_TOTAL_PROPERTIES}.`,
    );
  }
  if (budget.maxDepth > MAX_NESTING_DEPTH) {
    refuse(
      'openai/schema-too-deep',
      `Schema nests ${budget.maxDepth} levels deep; OpenAI allows at most ${MAX_NESTING_DEPTH}.`,
      'inputSchema',
    );
  } else if (budget.maxDepth >= NESTING_DEPTH_WARNING_THRESHOLD) {
    // Deliberately `else if`: over the limit, `openai/schema-too-deep` is the
    // whole story and a second finding about the same depth would be noise.
    const headroom = MAX_NESTING_DEPTH - budget.maxDepth;
    out.push(
      make({
        toolName: tool.name,
        severity: 'warning',
        code: 'openai/schema-nesting-near-limit',
        message:
          `Schema nests ${budget.maxDepth} levels deep; OpenAI allows at most ${MAX_NESTING_DEPTH}. ` +
          (headroom === 0
            ? 'There is no headroom left: adding one more level of nesting anywhere in this ' +
              'schema will make OpenAI reject the tool.'
            : `There is room for ${headroom} more level${headroom === 1 ? '' : 's'} of nesting; ` +
              'beyond that OpenAI will reject the tool.'),
        path: 'inputSchema',
        compile: compilable(
          'Compiles unchanged. The schema is within the depth limit; this is advance warning only.',
        ),
        docsUrl: DOC_STRUCTURED_OUTPUTS,
      }),
    );
  }
  if (budget.totalEnumValues > MAX_TOTAL_ENUM_VALUES) {
    refuse(
      'openai/too-many-enum-values',
      `Schema declares ${budget.totalEnumValues} enum values; OpenAI allows at most ${MAX_TOTAL_ENUM_VALUES} across all properties.`,
      'inputSchema',
    );
  } else {
    nearLimit(
      'openai/enum-values-near-limit',
      budget.totalEnumValues,
      MAX_TOTAL_ENUM_VALUES,
      `Schema declares ${budget.totalEnumValues} enum values; OpenAI allows at most ${MAX_TOTAL_ENUM_VALUES} across all properties.`,
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
  } else {
    nearLimit(
      'openai/schema-size-near-limit',
      budget.totalStringLength,
      MAX_TOTAL_STRING_LENGTH,
      `Property names, definition names and enum values total ${budget.totalStringLength} characters; OpenAI allows at most ${MAX_TOTAL_STRING_LENGTH}.`,
    );
  }
  return out;
}


/* -------------------------------------------------------------------------- */
/* Boolean and non-schema subschemas                                           */
/* -------------------------------------------------------------------------- */

/** Slots whose values are schemas. `additionalProperties` is deliberately absent:
 *  a boolean is its normal form there, and `checkAdditionalProperties` owns it. */
const SCHEMA_MAP_SLOTS = ['properties', '$defs', 'definitions'] as const;
const SCHEMA_LIST_SLOTS = ['anyOf', 'oneOf', 'allOf', 'prefixItems'] as const;
const SCHEMA_SINGLE_SLOTS = ['items', 'not'] as const;

/** Slots compile drops wholesale, so their interior never reaches the output. */
const DROPPED_SLOTS: readonly string[] = ['allOf', 'not', 'prefixItems'];

function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * JSON Schema allows `true` or `false` in place of a subschema. OpenAI's
 * supported subset does not, so compile has to materialise something concrete.
 *
 * `false` means "accept nothing". The closest OpenAI can express is `{}`, which
 * accepts *everything* — the widest possible weakening of a constraint. That is
 * an error backed by a `lossy: true` transformation, so `finalizeCompile`
 * refuses it unless the caller passes `allowLossy`.
 *
 * `true` also compiles to `{}`, but the two accept exactly the same values, so
 * it costs nothing and is only worth an `info`.
 *
 * Any other non-schema value (a string, a number, `null`) is not valid JSON
 * Schema at all; it is treated like `false` — replaced with `{}` and reported
 * lossy — rather than being silently normalised away.
 *
 * **Defence in depth.** `validateCanonicalTool` in `@schemaport/core` rejects
 * boolean subschemas outright, so the CLI never reaches this code. The adapter
 * is a public API that can be called directly, and SchemaPort's promise never
 * to weaken a schema silently has to hold there too.
 */
export function checkSubschemaSlots(tool: CanonicalTool): Diagnostic[] {
  const out: Diagnostic[] = [];

  const inspect = (value: unknown, path: string, dropped: boolean): void => {
    const child = asSchema(value);
    if (child) {
      descend(child, path, dropped);
      return;
    }

    if (value === true) {
      out.push(
        make({
          toolName: tool.name,
          severity: 'info',
          code: 'openai/boolean-subschema',
          message:
            'OpenAI does not accept `true` in place of a subschema. It is emitted as `{}`, ' +
            'which accepts exactly the same values.',
          path,
          compile: compilable('Emits `{}` in place of `true`.'),
          docsUrl: DOC_STRUCTURED_OUTPUTS,
        }),
      );
      return;
    }

    const isFalse = value === false;
    out.push(
      make({
        toolName: tool.name,
        severity: 'error',
        code: isFalse ? 'openai/boolean-subschema' : 'openai/non-schema-subschema',
        message: isFalse
          ? 'A `false` subschema accepts nothing, and OpenAI has no way to express that. ' +
            'Compiling it produces `{}`, which accepts ANY value — the widest possible ' +
            'weakening of this constraint.'
          : `A subschema slot holds a non-schema value of type ${describeValue(value)}. ` +
            'Compiling it produces `{}`, which accepts ANY value.',
        path,
        compile: compilableLossy(
          dropped
            ? 'Refused unless --allow-lossy: the enclosing keyword is dropped, so nothing constrains this value.'
            : 'Emits `{}`, which accepts any value.',
        ),
        docsUrl: DOC_STRUCTURED_OUTPUTS,
      }),
    );
  };

  const descend = (schema: JsonSchema, path: string, dropped: boolean): void => {
    for (const keyword of SCHEMA_MAP_SLOTS) {
      const map = schema[keyword];
      if (!isPlainObject(map)) continue;
      for (const [key, value] of Object.entries(map)) {
        inspect(value, joinPath(path, keyword, key), dropped);
      }
    }
    for (const keyword of SCHEMA_LIST_SLOTS) {
      const list = schema[keyword];
      if (!Array.isArray(list)) continue;
      const nowDropped = dropped || DROPPED_SLOTS.includes(keyword);
      list.forEach((value, index) => {
        inspect(value, joinPath(path, keyword, index), nowDropped);
      });
    }
    for (const keyword of SCHEMA_SINGLE_SLOTS) {
      if (!Object.prototype.hasOwnProperty.call(schema, keyword)) continue;
      inspect(schema[keyword], joinPath(path, keyword), dropped || DROPPED_SLOTS.includes(keyword));
    }
  };

  descend(tool.inputSchema, 'inputSchema', false);
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
