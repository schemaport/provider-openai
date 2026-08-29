import type { CanonicalTool, ProbeOptions, ProbeResult } from '@schemaport/core';
import type { OpenAIApiSurface } from './surface.js';
import { resolveApiSurface } from './surface.js';
import {
  classifyProviderError,
  probeAccepted,
  probeCompileRefused,
  probeError,
  probeMissingCredentials,
  probePrompt,
  probeRejected,
  resolveApiKey,
  resolveProbeModel,
} from '@schemaport/core';
import OpenAI from 'openai';
import { compileOpenAI } from './compile.js';
import { PROVIDER_ID } from './rules.js';

/** Environment variable holding the API key. */
export const OPENAI_API_KEY_ENV = 'OPENAI_API_KEY';

/** Environment variable that overrides the probe model. */
export const OPENAI_MODEL_ENV = 'SCHEMAPORT_OPENAI_MODEL';

/** Environment variable that overrides the probe timeout in milliseconds. */
export const OPENAI_TIMEOUT_ENV = 'SCHEMAPORT_OPENAI_TIMEOUT_MS';

/** Environment variable that overrides the probe output-token ceiling. */
export const OPENAI_MAX_OUTPUT_TOKENS_ENV = 'SCHEMAPORT_OPENAI_MAX_OUTPUT_TOKENS';

/**
 * Default probe model.
 *
 * `gpt-5.6-terra` is the balanced default for live compatibility probes. It
 * supports function calling and structured outputs while providing more
 * reasoning headroom than the lowest-cost model.
 *
 * Override with `SCHEMAPORT_OPENAI_MODEL` or `options.model`.
 */
export const DEFAULT_PROBE_MODEL = 'gpt-5.6-terra';

/**
 * Output cap for the probe request. Large enough that a reasoning model can
 * still emit one forced tool call, small enough that a probe stays cheap.
 */
export const PROBE_MAX_OUTPUT_TOKENS = 2560;

function resolveProbeMaxOutputTokens(): number {
  const raw = process.env[OPENAI_MAX_OUTPUT_TOKENS_ENV];
  if (raw === undefined || !/^\d+$/.test(raw)) return PROBE_MAX_OUTPUT_TOKENS;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 16_384
    ? parsed
    : PROBE_MAX_OUTPUT_TOKENS;
}

/** Default per-request timeout for live probes. */
export const DEFAULT_PROBE_TIMEOUT_MS = 30_000;

function resolveProbeTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs !== undefined) return timeoutMs;
  const raw = process.env[OPENAI_TIMEOUT_ENV];
  if (raw === undefined || !/^\d+$/.test(raw)) return DEFAULT_PROBE_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PROBE_TIMEOUT_MS;
}

/** One `create` method, on either endpoint. */
type CreateMethod = (
  body: Record<string, unknown>,
  options?: { timeout?: number },
) => Promise<unknown> | PromiseLike<unknown>;

/** The slice of the OpenAI SDK the Responses probe uses. */
export interface OpenAIResponsesProbeClient {
  responses: { create: CreateMethod };
}

/** The slice of the OpenAI SDK the Chat Completions probe uses. */
export interface OpenAIChatCompletionsProbeClient {
  chat: { completions: { create: CreateMethod } };
}

/**
 * The slice of the OpenAI SDK the probe uses.
 *
 * Declared structurally so `options.client` can be a test double without
 * constructing a real client or touching the network. A real `OpenAI` instance
 * satisfies both members of the union, so no branch is needed when this package
 * constructs the client itself — only the request and the extraction differ.
 */
export type OpenAIProbeClient = OpenAIResponsesProbeClient | OpenAIChatCompletionsProbeClient;

/** Both extractors report the same three outcomes to `probeOpenAI`. */
interface ExtractedArguments {
  parsed?: unknown;
  note?: string;
}

const UNPARSABLE_NOTE = 'The model returned a tool call whose arguments were not valid JSON.';

function parseArguments(raw: unknown): ExtractedArguments | undefined {
  if (typeof raw !== 'string') return undefined;
  try {
    return { parsed: JSON.parse(raw) };
  } catch {
    return { note: UNPARSABLE_NOTE };
  }
}

interface ResponseOutputItem {
  type?: unknown;
  name?: unknown;
  arguments?: unknown;
}

/**
 * Pull the arguments of the forced tool call out of a Responses API result.
 *
 * `output[]` carries `{ type: 'function_call', name, arguments }` items
 * directly (`openai@7.5.0`, `resources/responses/responses.d.ts`).
 */
function extractResponsesToolCall(response: unknown, toolName: string): ExtractedArguments {
  if (typeof response !== 'object' || response === null) return {};
  const output = (response as { output?: unknown }).output;
  if (!Array.isArray(output)) return {};

  for (const item of output as ResponseOutputItem[]) {
    if (item === null || typeof item !== 'object') continue;
    if (item.type !== 'function_call' || item.name !== toolName) continue;
    const parsed = parseArguments(item.arguments);
    if (parsed !== undefined) return parsed;
  }
  return {};
}

interface ChatToolCall {
  type?: unknown;
  function?: { name?: unknown; arguments?: unknown };
}

/**
 * Pull the arguments of the forced tool call out of a Chat Completions result.
 *
 * The call sits one level deeper and behind `choices[]`:
 * `ChatCompletion.choices[].message.tool_calls?: ChatCompletionMessageToolCall[]`,
 * each `{ id, type: 'function', function: { name, arguments } }`
 * (`openai@7.5.0`, `resources/chat/completions/completions.d.ts`). `tool_calls`
 * is optional, so a prose answer is an empty result rather than a throw —
 * exactly as on the Responses path.
 */
function extractChatToolCall(response: unknown, toolName: string): ExtractedArguments {
  if (typeof response !== 'object' || response === null) return {};
  const choices = (response as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return {};

  for (const choice of choices) {
    if (typeof choice !== 'object' || choice === null) continue;
    const message = (choice as { message?: unknown }).message;
    if (typeof message !== 'object' || message === null) continue;
    const toolCalls = (message as { tool_calls?: unknown }).tool_calls;
    if (!Array.isArray(toolCalls)) continue;

    for (const call of toolCalls as ChatToolCall[]) {
      if (call === null || typeof call !== 'object') continue;
      if (call.type !== 'function') continue;
      if (call.function?.name !== toolName) continue;
      const parsed = parseArguments(call.function.arguments);
      if (parsed !== undefined) return parsed;
    }
  }
  return {};
}

/**
 * Build the one request body for the chosen surface.
 *
 * Both send the same compiled tool, the same `probePrompt` text and a forced
 * tool choice; the field names around them are what the SDK types dictate.
 * `tool_choice` is flat on Responses (`{ type, name }`) and nested on Chat
 * Completions (`ChatCompletionNamedToolChoice` = `{ type, function: { name } }`),
 * and the output cap is `max_output_tokens` versus `max_completion_tokens` —
 * Chat Completions' `max_tokens` is marked `@deprecated` in the SDK types and
 * is not used.
 */
function probeRequestBody(
  surface: OpenAIApiSurface,
  model: string,
  toolName: string,
  prompt: string,
  compiledTool: unknown,
): Record<string, unknown> {
  const maximumOutputTokens = resolveProbeMaxOutputTokens();
  if (surface === 'chat-completions') {
    return {
      model,
      messages: [{ role: 'user', content: prompt }],
      tools: [compiledTool],
      tool_choice: { type: 'function', function: { name: toolName } },
      max_completion_tokens: maximumOutputTokens,
    };
  }

  return {
    model,
    input: prompt,
    tools: [compiledTool],
    tool_choice: { type: 'function', name: toolName },
    max_output_tokens: maximumOutputTokens,
  };
}

/** Pick the `create` method matching the surface, out of a structural client. */
function createFor(surface: OpenAIApiSurface, client: OpenAIProbeClient): CreateMethod | undefined {
  if (surface === 'chat-completions') {
    return 'chat' in client ? client.chat.completions.create.bind(client.chat.completions) : undefined;
  }
  return 'responses' in client ? client.responses.create.bind(client.responses) : undefined;
}

/** `ProbeOptions` plus the OpenAI-specific choice of surface to probe. */
export interface OpenAIProbeOptions extends ProbeOptions {
  /** Which surface to compile for and send to. Defaults to `'responses'`. */
  apiSurface?: OpenAIApiSurface;
}

/** A serializable object-form request accepted by the package-level `probe` entrypoint. */
export interface ProbeRequest {
  tool: CanonicalTool;
  options?: OpenAIProbeOptions;
}

/**
 * Ask OpenAI whether it accepts the compiled tool definition.
 *
 * Sends exactly one request — `POST /v1/responses` or, when
 * `options.apiSurface` is `'chat-completions'`, `POST /v1/chat/completions` —
 * carrying the compiled tool, one short instruction from `probePrompt`,
 * `tool_choice` pinned to this tool and a small output cap. The developer's
 * function is never executed and no real data is sent.
 *
 * The surface is threaded into `compileOpenAI` first, so what goes on the wire
 * is the exact shape the caller would send themselves. Every existing guarantee
 * holds on both paths: compile runs first and a refused schema is never sent,
 * the key and model resolve through `@schemaport/core`, `options.client` stays
 * the only way a test reaches an SDK, and failures are classified by
 * `classifyProviderError` so an expired key is never reported as a bad schema.
 */
export async function probeOpenAI(
  tool: CanonicalTool,
  options: OpenAIProbeOptions = {},
): Promise<ProbeResult> {
  const base = { providerId: PROVIDER_ID, toolName: tool.name };
  const surface = resolveApiSurface(options);

  const compiled = compileOpenAI(tool, {
    apiSurface: surface,
    ...(options.allowLossy !== undefined ? { allowLossy: options.allowLossy } : {}),
  });
  if (!compiled.ok || compiled.output === undefined) {
    return probeCompileRefused(base, compiled);
  }

  const model = resolveProbeModel(options.model, OPENAI_MODEL_ENV, DEFAULT_PROBE_MODEL);

  let client: OpenAIProbeClient;
  if (options.client !== undefined) {
    client = options.client as OpenAIProbeClient;
  } else {
    const apiKey = resolveApiKey(options.apiKey, OPENAI_API_KEY_ENV);
    if (apiKey === undefined) return probeMissingCredentials(base, OPENAI_API_KEY_ENV);
    client = new OpenAI({ apiKey }) as unknown as OpenAIProbeClient;
  }

  const create = createFor(surface, client);
  if (create === undefined) {
    return probeError(
      base,
      'unsupported',
      {
        message: `The supplied \`options.client\` has no \`${
          surface === 'chat-completions' ? 'chat.completions' : 'responses'
        }.create\` method, so the ${surface} surface cannot be probed with it.`,
      },
      model,
    );
  }

  try {
    const response = await create(
      probeRequestBody(surface, model, tool.name, probePrompt(tool), compiled.output),
      { timeout: resolveProbeTimeout(options.timeoutMs) },
    );

    const { parsed, note } =
      surface === 'chat-completions'
        ? extractChatToolCall(response, tool.name)
        : extractResponsesToolCall(response, tool.name);
    return probeAccepted({
      ...base,
      model,
      tool,
      ...(parsed !== undefined ? { argumentsReceived: parsed } : {}),
      ...(note !== undefined ? { notes: [note] } : {}),
    });
  } catch (error) {
    const { kind, detail } = classifyProviderError(error);
    if (kind === 'rejected') return probeRejected(base, model, detail);
    return probeError(base, kind, detail, model);
  }
}

/**
 * Probe OpenAI through the package-level provider entrypoint.
 *
 * This concise alias mirrors the `openaiProvider.probe()` method for callers
 * that prefer named functions while preserving the existing `probeOpenAI`
 * export for compatibility.
 */
export function probe(
  tool: CanonicalTool,
  options?: OpenAIProbeOptions,
): Promise<ProbeResult>;
export function probe(request: ProbeRequest): Promise<ProbeResult>;
export async function probe(
  input: CanonicalTool | ProbeRequest,
  options: OpenAIProbeOptions = {},
): Promise<ProbeResult> {
  if ("tool" in input) {
    return probeOpenAI(input.tool, input.options ?? {});
  }
  return probeOpenAI(input, options);
}
