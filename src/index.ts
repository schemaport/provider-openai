/**
 * `@schemaport/provider-openai`
 *
 * OpenAI compatibility checks, compilation and live probing for SchemaPort.
 *
 * Target surface: the **Responses API** `FunctionTool`
 * (`POST /v1/responses`, `tools[]`), compiled with `strict: true`. See
 * `docs/openai-support.md` for why, and for every rule and transformation.
 */
import type {
  CanonicalTool,
  CompileOptions,
  CompileResult,
  Diagnostic,
  ProbeOptions,
  ProbeResult,
  SchemaPortProvider,
} from '@schemaport/core';
import { checkOpenAI } from './check.js';
import { compileOpenAI } from './compile.js';
import { OPENAI_DOCS, RULES_REVIEWED_AT } from './docs.js';
import { probeOpenAI, OPENAI_API_KEY_ENV } from './probe.js';
import { PROVIDER_ID } from './rules.js';

export const openaiProvider: SchemaPortProvider = {
  id: PROVIDER_ID,
  displayName: 'OpenAI',
  rulesReviewedAt: RULES_REVIEWED_AT,
  docs: OPENAI_DOCS,
  apiKeyEnvVar: OPENAI_API_KEY_ENV,

  check(tool: CanonicalTool): Diagnostic[] {
    return checkOpenAI(tool);
  },

  compile(tool: CanonicalTool, options?: CompileOptions): CompileResult {
    return compileOpenAI(tool, options);
  },

  probe(tool: CanonicalTool, options?: ProbeOptions): Promise<ProbeResult> {
    return probeOpenAI(tool, options);
  },
};

export default openaiProvider;

export { checkOpenAI } from './check.js';
export { compileOpenAI } from './compile.js';
export type { OpenAIFunctionTool } from './compile.js';
export {
  DEFAULT_PROBE_MODEL,
  OPENAI_API_KEY_ENV,
  OPENAI_MODEL_ENV,
  PROBE_MAX_OUTPUT_TOKENS,
  probeOpenAI,
} from './probe.js';
export type { OpenAIProbeClient } from './probe.js';
export { OPENAI_DOCS, RULES_REVIEWED_AT } from './docs.js';
export {
  ANNOTATION_KEYWORDS,
  SUPPORTED_FORMATS,
  SUPPORTED_KEYWORDS,
  UNDOCUMENTED_CONSTRAINT_KEYWORDS,
  UNSUPPORTED_CONSTRAINT_KEYWORDS,
  classifyKeyword,
} from './keywords.js';
export type { KeywordClass } from './keywords.js';
export {
  DROPPED_KEYWORDS,
  MAX_NESTING_DEPTH,
  MAX_TOOL_NAME_LENGTH,
  MAX_TOTAL_ENUM_VALUES,
  MAX_TOTAL_PROPERTIES,
  MAX_TOTAL_STRING_LENGTH,
  NESTING_DEPTH_WARNING_THRESHOLD,
} from './rules.js';
