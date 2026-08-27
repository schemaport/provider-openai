/**
 * `@schemaport/provider-openai`
 *
 * OpenAI compatibility checks, compilation and live probing for SchemaPort.
 *
 * Default target surface: the **Responses API** `FunctionTool`
 * (`POST /v1/responses`, `tools[]`), compiled with `strict: true`. Pass
 * `{ apiSurface: 'chat-completions' }` to `compile()` or `probe()` for the
 * `POST /v1/chat/completions` envelope instead. The schema rules are the same
 * either way — see `docs/openai-support.md`.
 */
import type {
  CanonicalTool,
  CompileResult,
  Diagnostic,
  ProbeResult,
  SchemaPortProvider,
} from '@schemaport/core';
import { checkOpenAI } from './check.js';
import { compileOpenAI } from './compile.js';
import { OPENAI_DOCS, RULES_REVIEWED_AT } from './docs.js';
import { probeOpenAI, OPENAI_API_KEY_ENV } from './probe.js';
import type { OpenAIProbeOptions } from './probe.js';
import { PROVIDER_ID } from './rules.js';
import type { OpenAICompileOptions } from './surface.js';

/**
 * `SchemaPortProvider`, widened only in the options each method accepts.
 *
 * `OpenAICompileOptions` and `OpenAIProbeOptions` add one optional field each
 * to core's types, so a method taking them still accepts a plain
 * `CompileOptions` / `ProbeOptions`. `openaiProvider` is therefore assignable
 * to `SchemaPortProvider` — the annotation below is what proves it at build
 * time — and `@schemaport/core` needs no change.
 */
export interface OpenAIProvider extends SchemaPortProvider {
  compile(tool: CanonicalTool, options?: OpenAICompileOptions): CompileResult;
  probe(tool: CanonicalTool, options?: OpenAIProbeOptions): Promise<ProbeResult>;
}

export const openaiProvider: OpenAIProvider = {
  id: PROVIDER_ID,
  displayName: 'OpenAI',
  rulesReviewedAt: RULES_REVIEWED_AT,
  docs: OPENAI_DOCS,
  apiKeyEnvVar: OPENAI_API_KEY_ENV,

  check(tool: CanonicalTool): Diagnostic[] {
    return checkOpenAI(tool);
  },

  compile(tool: CanonicalTool, options?: OpenAICompileOptions): CompileResult {
    return compileOpenAI(tool, options);
  },

  probe(tool: CanonicalTool, options?: OpenAIProbeOptions): Promise<ProbeResult> {
    return probeOpenAI(tool, options);
  },
};

/** Compile-time proof that the widened provider still satisfies core's contract. */
const _assignableToCore: SchemaPortProvider = openaiProvider;
void _assignableToCore;

export default openaiProvider;

export { checkOpenAI } from './check.js';
export { compileOpenAI } from './compile.js';
export {
  CHAT_COMPLETIONS_WRAPPER_CODE,
  DEFAULT_API_SURFACE,
  isOpenAIApiSurface,
  OPENAI_API_SURFACES,
  resolveApiSurface,
  wrapForSurface,
} from './surface.js';
export type {
  OpenAIApiSurface,
  OpenAIChatCompletionsTool,
  OpenAICompileOptions,
  OpenAICompiledTool,
  OpenAIFunctionTool,
} from './surface.js';
export {
  DEFAULT_PROBE_MODEL,
  OPENAI_API_KEY_ENV,
  OPENAI_MODEL_ENV,
  PROBE_MAX_OUTPUT_TOKENS,
  probeOpenAI,
} from './probe.js';
export type {
  OpenAIChatCompletionsProbeClient,
  OpenAIProbeClient,
  OpenAIProbeOptions,
  OpenAIResponsesProbeClient,
} from './probe.js';
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
