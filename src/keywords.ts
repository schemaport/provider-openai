/**
 * The JSON Schema subset OpenAI documents for `strict: true` function tools.
 *
 * Everything here comes from the "Supported schemas" section of the structured
 * outputs guide (see `src/docs.ts`). SchemaPort compiles with an *allowlist*:
 * a keyword is only emitted when OpenAI documents it as supported. Anything
 * else is dropped and recorded, so an undocumented keyword can never silently
 * ride along into a request and produce a 400.
 */

/** Keywords copied through to the compiled schema unchanged. */
export const SUPPORTED_KEYWORDS: readonly string[] = Object.freeze([
  // structure
  'type',
  'description',
  'enum',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'anyOf',
  '$ref',
  '$defs',
  // strings
  'pattern',
  'format',
  // numbers
  'multipleOf',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  // arrays
  'minItems',
  'maxItems',
]);

/**
 * `format` values OpenAI documents as supported. Any other value is dropped,
 * because an unrecognised `format` is both unenforced and a rejection risk.
 */
export const SUPPORTED_FORMATS: readonly string[] = Object.freeze([
  'date-time',
  'time',
  'date',
  'duration',
  'email',
  'hostname',
  'ipv4',
  'ipv6',
  'uuid',
]);

/**
 * TIER 1 — keywords the structured outputs guide **names** as unsupported,
 * verbatim: "Composition: `allOf`, `not`, `dependentRequired`,
 * `dependentSchemas`, `if`, `then`, `else`".
 *
 * Dropping one widens the accepted value set, so it is always `lossy: true`.
 */
export const UNSUPPORTED_CONSTRAINT_KEYWORDS: readonly string[] = Object.freeze([
  'allOf',
  'not',
  'dependentRequired',
  'dependentSchemas',
  'if',
  'then',
  'else',
]);

/**
 * TIER 2 — constraining keywords that are merely **absent** from the guide's
 * "Supported properties" lists, rather than named as unsupported.
 *
 * The evidence here is weaker than tier 1 and SchemaPort says so in the
 * diagnostic it emits. The guide lists `pattern` and `format` as the supported
 * string properties, `multipleOf`/`minimum`/`maximum`/`exclusiveMinimum`/
 * `exclusiveMaximum` for numbers and `minItems`/`maxItems` for arrays — and
 * nothing else. It also has a paragraph saying fine-tuned models
 * *additionally* do not support `minLength`, `maxLength`, `pattern`, `format`,
 * `patternProperties`, `minItems`, `maxItems` and the numeric bounds, which
 * reads as though non-fine-tuned models *do* support `minLength`/`maxLength`.
 * The two statements contradict each other and OpenAI does not resolve it.
 *
 * SchemaPort takes the conservative branch: a keyword outside the supported
 * list is not emitted, and its removal is recorded as `lossy: true`, so a
 * caller is never told a constraint is enforced when it may not be.
 */
export const UNDOCUMENTED_CONSTRAINT_KEYWORDS: readonly string[] = Object.freeze([
  'minLength',
  'maxLength',
  'minProperties',
  'maxProperties',
  'patternProperties',
  'propertyNames',
  'uniqueItems',
  'prefixItems',
  'contains',
  'minContains',
  'maxContains',
  'unevaluatedProperties',
  'unevaluatedItems',
]);

/**
 * Keywords that annotate but do not constrain. Dropping one cannot widen the
 * accepted value set, so it is `lossy: false`.
 */
export const ANNOTATION_KEYWORDS: readonly string[] = Object.freeze([
  'title',
  'examples',
  '$comment',
  '$schema',
  '$id',
  '$anchor',
  'deprecated',
  'readOnly',
  'writeOnly',
]);

/**
 * Keywords compile rewrites into a supported equivalent rather than dropping.
 * Handled individually in `compile.ts`; listed here so `classifyKeyword` does
 * not report them as unknown.
 */
export const REWRITTEN_KEYWORDS: readonly string[] = Object.freeze([
  'const', // -> enum: [value]
  'oneOf', // -> anyOf
  'definitions', // -> $defs
  'nullable', // -> type union with 'null'
  'default', // dropped, warned about separately
]);

export type KeywordClass =
  | 'supported'
  | 'rewritten'
  | 'annotation'
  | 'unsupported-constraint'
  | 'undocumented-constraint'
  | 'unknown';

/**
 * Classify a schema keyword.
 *
 * Unknown keywords are deliberately *not* treated as harmless annotations:
 * SchemaPort cannot tell whether a keyword it has never seen constrains the
 * accepted values, so dropping one is reported as lossy.
 */
export function classifyKeyword(keyword: string): KeywordClass {
  if (SUPPORTED_KEYWORDS.includes(keyword)) return 'supported';
  if (REWRITTEN_KEYWORDS.includes(keyword)) return 'rewritten';
  if (ANNOTATION_KEYWORDS.includes(keyword)) return 'annotation';
  if (UNSUPPORTED_CONSTRAINT_KEYWORDS.includes(keyword)) return 'unsupported-constraint';
  if (UNDOCUMENTED_CONSTRAINT_KEYWORDS.includes(keyword)) return 'undocumented-constraint';
  return 'unknown';
}

/**
 * Order compiled schema keys are written in.
 *
 * Fixing the order makes compiled output byte-identical across runs regardless
 * of the key order in the canonical source file.
 */
export const OUTPUT_KEY_ORDER: readonly string[] = Object.freeze([
  '$ref',
  'type',
  'description',
  'enum',
  'pattern',
  'format',
  'multipleOf',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minItems',
  'maxItems',
  'items',
  'properties',
  'required',
  'additionalProperties',
  'anyOf',
  '$defs',
]);
