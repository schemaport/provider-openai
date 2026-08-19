import type {
  CanonicalTool,
  CompileOptions,
  CompileResult,
  JsonSchema,
  Transformation,
} from '@schemaport/core';
import {
  asSchema,
  finalizeCompile,
  isPlainObject,
  joinPath,
  transformation,
} from '@schemaport/core';
import { checkOpenAI } from './check.js';
import { classifyKeyword, OUTPUT_KEY_ORDER, SUPPORTED_FORMATS } from './keywords.js';
import { isObjectSchema, PROVIDER_ID } from './rules.js';

/**
 * The OpenAI-native tool definition SchemaPort emits.
 *
 * This is the Responses API `FunctionTool` shape, field for field, as declared
 * by `openai@7.5.0` in `resources/responses/responses.d.ts`:
 *
 * ```ts
 * interface FunctionTool {
 *   name: string;
 *   parameters: { [key: string]: unknown } | null;
 *   strict: boolean | null;
 *   type: 'function';
 *   description?: string | null;
 * }
 * ```
 */
export interface OpenAIFunctionTool {
  type: 'function';
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
  strict: true;
}

interface Context {
  transformations: Transformation[];
  /** True when the root uses draft-07 `definitions` and `$ref`s must be rewritten. */
  rewriteDefinitionRefs: boolean;
}

function record(
  ctx: Context,
  code: string,
  path: string,
  detail: string,
  lossy: boolean,
): void {
  ctx.transformations.push(transformation(code, path, detail, lossy));
}

/* -------------------------------------------------------------------------- */
/* Nullability                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Express "this value may be absent" the way OpenAI strict mode requires:
 * by adding `"null"` to the type union.
 *
 * Returns the schema unchanged when it is already nullable or already untyped
 * (an untyped schema accepts `null` already).
 */
function withNull(out: Record<string, unknown>): Record<string, unknown> {
  const type = out['type'];

  if (typeof type === 'string') {
    return type === 'null' ? out : { ...out, type: [type, 'null'] };
  }

  if (Array.isArray(type)) {
    return type.includes('null') ? out : { ...out, type: [...type, 'null'] };
  }

  const anyOf = out['anyOf'];
  if (Array.isArray(anyOf)) {
    const alreadyNullable = anyOf.some(
      (branch) => isPlainObject(branch) && branch['type'] === 'null',
    );
    return alreadyNullable ? out : { ...out, anyOf: [...anyOf, { type: 'null' }] };
  }

  if (typeof out['$ref'] === 'string') {
    // `$ref` siblings are not reliably honoured, so wrap the reference instead.
    return { anyOf: [{ $ref: out['$ref'] }, { type: 'null' }] };
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Schema transformation                                                       */
/* -------------------------------------------------------------------------- */

function transformSchema(schema: JsonSchema, path: string, ctx: Context): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [keyword, value] of Object.entries(schema)) {
    const at = joinPath(path, keyword);

    switch (classifyKeyword(keyword)) {
      case 'supported':
        copySupported(out, keyword, value, path, ctx);
        break;

      case 'annotation':
        record(ctx, 'dropped-annotation-keyword', at, `Dropped \`${keyword}\`.`, false);
        break;

      case 'unsupported-constraint':
        record(
          ctx,
          'dropped-unsupported-keyword',
          at,
          `Dropped \`${keyword}\`; OpenAI names it as unsupported, so the constraint is no longer enforced.`,
          true,
        );
        break;

      case 'undocumented-constraint':
        record(
          ctx,
          'dropped-undocumented-constraint-keyword',
          at,
          `Dropped \`${keyword}\`; OpenAI does not list it as supported and SchemaPort could not confirm it is enforced.`,
          true,
        );
        break;

      case 'unknown':
        record(
          ctx,
          'dropped-unknown-keyword',
          at,
          `Dropped \`${keyword}\`; OpenAI does not document it and SchemaPort cannot verify it is safe.`,
          true,
        );
        break;

      case 'rewritten':
        rewriteKeyword(out, schema, keyword, value, path, ctx);
        break;
    }
  }

  if (isObjectSchema(schema)) closeObject(out, schema, path, ctx);

  return order(out);
}

function copySupported(
  out: Record<string, unknown>,
  keyword: string,
  value: unknown,
  path: string,
  ctx: Context,
): void {
  switch (keyword) {
    case 'properties':
    case '$defs': {
      if (!isPlainObject(value)) return;
      const map: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value)) {
        const sub = asSchema(child);
        map[key] = sub ? transformSchema(sub, joinPath(path, keyword, key), ctx) : {};
      }
      out[keyword] = map;
      return;
    }
    case 'items': {
      const sub = asSchema(value);
      if (sub) out['items'] = transformSchema(sub, joinPath(path, 'items'), ctx);
      return;
    }
    case 'anyOf': {
      if (!Array.isArray(value)) return;
      out['anyOf'] = value.map((branch, index) => {
        const sub = asSchema(branch);
        return sub ? transformSchema(sub, joinPath(path, 'anyOf', index), ctx) : {};
      });
      return;
    }
    case 'format': {
      if (typeof value === 'string' && !SUPPORTED_FORMATS.includes(value)) {
        record(
          ctx,
          'dropped-unsupported-format',
          joinPath(path, 'format'),
          `Dropped \`format: "${value}"\`; OpenAI supports only ${SUPPORTED_FORMATS.join(', ')}.`,
          true,
        );
        return;
      }
      out['format'] = value;
      return;
    }
    case '$ref': {
      if (typeof value === 'string' && ctx.rewriteDefinitionRefs && value.startsWith('#/definitions/')) {
        const rewritten = `#/$defs/${value.slice('#/definitions/'.length)}`;
        record(
          ctx,
          'rewrote-definitions-reference',
          joinPath(path, '$ref'),
          `Repointed \`${value}\` at \`${rewritten}\`.`,
          false,
        );
        out['$ref'] = rewritten;
        return;
      }
      out['$ref'] = value;
      return;
    }
    case 'additionalProperties':
    case 'required':
      // Both are rewritten by `closeObject`; skip the verbatim copy.
      return;
    default:
      out[keyword] = value;
  }
}

function rewriteKeyword(
  out: Record<string, unknown>,
  schema: JsonSchema,
  keyword: string,
  value: unknown,
  path: string,
  ctx: Context,
): void {
  const at = joinPath(path, keyword);

  switch (keyword) {
    case 'const':
      record(ctx, 'converted-const-to-enum', at, 'Emitted `const` as a single-value `enum`.', false);
      out['enum'] = [value];
      return;

    case 'oneOf': {
      if (!Array.isArray(value)) return;
      record(
        ctx,
        'converted-one-of-to-any-of',
        at,
        'Emitted `oneOf` branches as `anyOf`; values matching more than one branch are now accepted.',
        true,
      );
      out['anyOf'] = value.map((branch, index) => {
        const sub = asSchema(branch);
        return sub ? transformSchema(sub, joinPath(path, 'oneOf', index), ctx) : {};
      });
      return;
    }

    case 'definitions': {
      if (!isPlainObject(value)) return;
      if (isPlainObject(schema['$defs'])) {
        record(
          ctx,
          'dropped-unsupported-keyword',
          at,
          'Dropped `definitions`; `$defs` is already present and SchemaPort will not merge the two.',
          true,
        );
        return;
      }
      record(ctx, 'renamed-definitions-to-defs', at, 'Renamed `definitions` to `$defs`.', false);
      const map: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value)) {
        const sub = asSchema(child);
        map[key] = sub ? transformSchema(sub, joinPath(path, 'definitions', key), ctx) : {};
      }
      out['$defs'] = map;
      return;
    }

    case 'nullable': {
      if (value !== true) {
        record(ctx, 'dropped-annotation-keyword', at, 'Dropped `nullable: false`.', false);
        return;
      }
      record(
        ctx,
        'converted-nullable-to-type-union',
        at,
        'Replaced `nullable: true` with `"null"` in the type union.',
        false,
      );
      // Applied after the whole schema is built, via the marker below.
      out[NULLABLE_MARKER] = true;
      return;
    }

    case 'default':
      record(
        ctx,
        'dropped-default-keyword',
        at,
        'Dropped `default`; OpenAI does not support it, so the model chooses a value itself.',
        false,
      );
      return;

    default:
      return;
  }
}

/** Internal marker key removed by `order()`. */
const NULLABLE_MARKER = '__schemaportNullable';

/**
 * Apply strict mode's two object requirements: everything in `required`, and
 * `additionalProperties: false`.
 */
function closeObject(
  out: Record<string, unknown>,
  schema: JsonSchema,
  path: string,
  ctx: Context,
): void {
  const properties = isPlainObject(schema.properties) ? schema.properties : {};
  const canonicalRequired = Array.isArray(schema.required) ? schema.required : [];

  if (!isPlainObject(out['properties'])) out['properties'] = {};
  const compiled = out['properties'] as Record<string, unknown>;

  for (const name of Object.keys(properties)) {
    if (canonicalRequired.includes(name)) continue;
    const value = compiled[name];
    if (!isPlainObject(value)) continue;
    record(
      ctx,
      'converted-optional-property-to-nullable',
      joinPath(path, 'properties', name),
      `Made \`${name}\` required and added \`"null"\` to its type; strict mode has no optional properties.`,
      false,
    );
    compiled[name] = order(withNull(value));
  }

  out['required'] = Object.keys(properties);

  const additional = schema.additionalProperties;
  if (additional === undefined) {
    record(
      ctx,
      'added-additional-properties-false',
      joinPath(path, 'additionalProperties'),
      'Added `additionalProperties: false`, which strict mode requires on every object.',
      false,
    );
  } else if (additional === true) {
    record(
      ctx,
      'closed-open-object',
      joinPath(path, 'additionalProperties'),
      'Replaced `additionalProperties: true` with `false`; undeclared keys are no longer accepted.',
      false,
    );
  } else if (asSchema(additional) !== undefined) {
    record(
      ctx,
      'dropped-additional-properties-schema',
      joinPath(path, 'additionalProperties'),
      'Replaced the `additionalProperties` value schema with `false`; the open typed map is gone.',
      true,
    );
  }
  out['additionalProperties'] = false;
}

/** Emit keys in a fixed order so repeated compiles are byte-identical. */
function order(out: Record<string, unknown>): Record<string, unknown> {
  const source = out[NULLABLE_MARKER] === true ? withNull(stripMarker(out)) : stripMarker(out);
  const ordered: Record<string, unknown> = {};
  for (const key of OUTPUT_KEY_ORDER) {
    if (Object.prototype.hasOwnProperty.call(source, key)) ordered[key] = source[key];
  }
  return ordered;
}

function stripMarker(out: Record<string, unknown>): Record<string, unknown> {
  if (!(NULLABLE_MARKER in out)) return out;
  const copy = { ...out };
  delete copy[NULLABLE_MARKER];
  return copy;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Compile a canonical tool into an OpenAI Responses API `FunctionTool`.
 *
 * `strict: true` is always emitted. OpenAI's own guidance is "we recommend
 * always enabling strict mode"; without it, function calling is best-effort and
 * SchemaPort could not tell the caller which constraints are actually enforced.
 * The cost is that keywords outside OpenAI's supported subset must be dropped,
 * and every such drop is recorded as a lossy transformation.
 */
export function compileOpenAI(tool: CanonicalTool, options?: CompileOptions): CompileResult {
  const ctx: Context = {
    transformations: [],
    rewriteDefinitionRefs:
      isPlainObject(tool.inputSchema.definitions) && !isPlainObject(tool.inputSchema.$defs),
  };

  record(
    ctx,
    'renamed-input-schema-to-parameters',
    'inputSchema',
    'Emitted `inputSchema` as the OpenAI `parameters` field.',
    false,
  );
  record(
    ctx,
    'enabled-strict-mode',
    'inputSchema',
    'Emitted `strict: true` so OpenAI enforces the schema instead of best-effort matching.',
    false,
  );

  const parameters = transformSchema(tool.inputSchema, 'inputSchema', ctx);

  const output: OpenAIFunctionTool = {
    type: 'function',
    name: tool.name,
    ...(tool.description !== undefined ? { description: tool.description } : {}),
    parameters,
    strict: true,
  };

  return finalizeCompile({
    providerId: PROVIDER_ID,
    tool,
    output,
    transformations: ctx.transformations,
    diagnostics: checkOpenAI(tool),
    options,
  });
}
