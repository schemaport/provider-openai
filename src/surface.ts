/**
 * The two OpenAI request shapes SchemaPort can emit a function tool into.
 *
 * **The schema rules do not differ between them.** Strict mode, the supported
 * keyword subset, the size limits, the optional-property encoding and every
 * transformation applied to `parameters` are properties of OpenAI's structured
 * outputs implementation, not of the endpoint you post to. `parameters` is
 * compiled exactly once, by `transformSchema` in `compile.ts`, and only the
 * envelope around it is chosen here. Nothing in `rules.ts`, `check.ts` or
 * `keywords.ts` knows this module exists, and nothing in it should.
 */
import type { CompileOptions } from '@schemaport/core';

/**
 * Which OpenAI request body the compiled tool is destined for.
 *
 * - `responses` — `POST /v1/responses`, `tools[]`. The default.
 * - `chat-completions` — `POST /v1/chat/completions`, `tools[]`.
 */
export type OpenAIApiSurface = 'responses' | 'chat-completions';

/** The surface used when the caller does not name one. */
export const DEFAULT_API_SURFACE: OpenAIApiSurface = 'responses';

/** Both surfaces, for tests and for callers enumerating the option. */
export const OPENAI_API_SURFACES: readonly OpenAIApiSurface[] = Object.freeze([
  'responses',
  'chat-completions',
]);

/**
 * `CompileOptions` plus the OpenAI-specific choice of output target.
 *
 * The extra field is optional, so an `OpenAICompileOptions` is still a valid
 * `CompileOptions` and `openaiProvider` stays assignable to core's
 * `SchemaPortProvider` without any change to `@schemaport/core`.
 */
export interface OpenAICompileOptions extends CompileOptions {
  /** Defaults to `'responses'`. */
  apiSurface?: OpenAIApiSurface;
}

/**
 * The Responses API `FunctionTool` shape, field for field, as declared by
 * `openai@7.5.0` in `resources/responses/responses.d.ts`:
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

/**
 * The Chat Completions tool shape, as declared by `openai@7.5.0` in
 * `resources/chat/completions/completions.d.ts` and `resources/shared.d.ts`:
 *
 * ```ts
 * interface ChatCompletionFunctionTool {
 *   function: Shared.FunctionDefinition;
 *   type: 'function';
 * }
 *
 * interface FunctionDefinition {
 *   name: string;
 *   description?: string;
 *   parameters?: FunctionParameters;   // { [key: string]: unknown }
 *   strict?: boolean | null;
 * }
 * ```
 *
 * Note where `strict` lives. On the Responses tool it is a sibling of `name`
 * and `parameters`; here it is **inside** `function`, alongside them. A tool
 * compiled for one surface and posted to the other therefore does not merely
 * fail validation — on Chat Completions a top-level `strict` is not the strict
 * flag at all, so the schema would silently go unenforced. That is why this
 * package makes you name the surface rather than emitting one shape and
 * hoping.
 */
export interface OpenAIChatCompletionsTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
    strict: true;
  };
}

/** Whichever of the two shapes `compile()` was asked for. */
export type OpenAICompiledTool = OpenAIFunctionTool | OpenAIChatCompletionsTool;

/** The compiled pieces, before an envelope is put around them. */
export interface ToolEnvelopeInput {
  name: string;
  description?: string | undefined;
  parameters: Record<string, unknown>;
}

/**
 * Transformation code recorded when, and only when, the Chat Completions
 * envelope is used.
 *
 * The Responses envelope records nothing here on purpose. `compile()` already
 * emits `renamed-input-schema-to-parameters` and `enabled-strict-mode` for it,
 * which between them describe that envelope completely, and those two codes
 * have been in the manifest since 0.1.0. Adding a third entry for the default
 * surface would change every existing manifest byte-for-byte to say something
 * they already said. So the manifest identifies the surface by presence: this
 * code appears exactly when Chat Completions was the target, and its absence
 * means the Responses tool was emitted.
 */
export const CHAT_COMPLETIONS_WRAPPER_CODE = 'nested-under-function-key';

export const CHAT_COMPLETIONS_WRAPPER_DETAIL =
  'Nested `name`, `description`, `parameters` and `strict` under the `function` key that the Chat Completions `tools[]` entry requires. The schema itself is unchanged.';

/**
 * Put the requested envelope around an already-compiled tool.
 *
 * This is the only place the two surfaces diverge. `parameters` is passed
 * through by reference and never inspected, so the two shapes are guaranteed to
 * carry the identical schema.
 */
export function wrapForSurface(
  surface: OpenAIApiSurface,
  { name, description, parameters }: ToolEnvelopeInput,
): OpenAICompiledTool {
  if (surface === 'chat-completions') {
    return {
      type: 'function',
      function: {
        name,
        ...(description !== undefined ? { description } : {}),
        parameters,
        strict: true,
      },
    };
  }

  return {
    type: 'function',
    name,
    ...(description !== undefined ? { description } : {}),
    parameters,
    strict: true,
  };
}

/** Read the surface out of caller options, defaulting to `responses`. */
export function resolveApiSurface(options?: OpenAICompileOptions): OpenAIApiSurface {
  return options?.apiSurface ?? DEFAULT_API_SURFACE;
}
