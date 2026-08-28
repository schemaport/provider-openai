import type { ProviderDocReference } from '@schemaport/core';

/**
 * Official OpenAI documentation the compatibility rules in this package were
 * derived from. Every rule cites one of these URLs.
 *
 * Reviewed on the date exported as `RULES_REVIEWED_AT`.
 */
export const RULES_REVIEWED_AT = '2026-08-29';

/** Function calling guide: tool shape, strict mode, optional-field encoding. */
export const DOC_FUNCTION_CALLING = 'https://developers.openai.com/api/docs/guides/function-calling';

/** Structured outputs guide: the supported JSON Schema subset and its limits. */
export const DOC_STRUCTURED_OUTPUTS =
  'https://developers.openai.com/api/docs/guides/structured-outputs';

/** Responses API reference: the `FunctionTool` request shape. */
export const DOC_RESPONSES_CREATE =
  'https://developers.openai.com/api/docs/api-reference/responses/create';

/**
 * Chat Completions API reference. The only official page that states the
 * function-name character set and length limit.
 */
export const DOC_CHAT_CREATE = 'https://developers.openai.com/api/docs/api-reference/chat/create';

/** Model page for the default probe model. */
export const DOC_MODEL_DEFAULT = 'https://developers.openai.com/api/docs/models/gpt-5.6-luna';

/** Deprecation schedule, used to pick a probe model that is not being retired. */
export const DOC_DEPRECATIONS = 'https://developers.openai.com/api/docs/deprecations';

export const OPENAI_DOCS: readonly ProviderDocReference[] = Object.freeze([
  { title: 'Function calling', url: DOC_FUNCTION_CALLING },
  { title: 'Structured model outputs — supported schemas', url: DOC_STRUCTURED_OUTPUTS },
  { title: 'API reference — POST /v1/responses', url: DOC_RESPONSES_CREATE },
  { title: 'API reference — POST /v1/chat/completions (function name rules)', url: DOC_CHAT_CREATE },
  { title: 'Models — gpt-5.6-luna', url: DOC_MODEL_DEFAULT },
  { title: 'Deprecations', url: DOC_DEPRECATIONS },
]);
