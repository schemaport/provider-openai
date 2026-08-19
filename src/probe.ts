import type { CanonicalTool, ProbeOptions, ProbeResult } from '@schemaport/core';
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

/**
 * Default probe model.
 *
 * `gpt-5.6-luna` is the cheapest model on OpenAI's current pricing page that
 * lists `function_calling` and `structured_outputs` under supported features
 * ($0.20 / $1.20 per 1M tokens). `gpt-5-nano` is cheaper still, but OpenAI's
 * deprecation page schedules `gpt-5-nano-2025-08-07` for shutdown on
 * 2026-12-11 and names `gpt-5.6-luna` as its replacement.
 *
 * Override with `SCHEMAPORT_OPENAI_MODEL` or `options.model`.
 */
export const DEFAULT_PROBE_MODEL = 'gpt-5.6-luna';

/**
 * Output cap for the probe request. Large enough that a reasoning model can
 * still emit one forced tool call, small enough that a probe stays cheap.
 */
export const PROBE_MAX_OUTPUT_TOKENS = 1024;

/**
 * The slice of the OpenAI SDK the probe uses.
 *
 * Declared structurally so `options.client` can be a test double without
 * constructing a real client or touching the network.
 */
export interface OpenAIProbeClient {
  responses: {
    create(
      body: Record<string, unknown>,
      options?: { timeout?: number },
    ): Promise<unknown> | PromiseLike<unknown>;
  };
}

interface ResponseOutputItem {
  type?: unknown;
  name?: unknown;
  arguments?: unknown;
}

/** Pull the arguments of the forced tool call out of a Responses API result. */
function extractToolCallArguments(
  response: unknown,
  toolName: string,
): { parsed?: unknown; note?: string } {
  if (typeof response !== 'object' || response === null) return {};
  const output = (response as { output?: unknown }).output;
  if (!Array.isArray(output)) return {};

  for (const item of output as ResponseOutputItem[]) {
    if (item === null || typeof item !== 'object') continue;
    if (item.type !== 'function_call' || item.name !== toolName) continue;
    if (typeof item.arguments !== 'string') continue;
    try {
      return { parsed: JSON.parse(item.arguments) };
    } catch {
      return { note: 'The model returned a tool call whose arguments were not valid JSON.' };
    }
  }
  return {};
}

/**
 * Ask OpenAI whether it accepts the compiled tool definition.
 *
 * Sends exactly one Responses API request: the compiled tool, one short
 * instruction from `probePrompt`, `tool_choice` pinned to this tool and a small
 * output cap. The developer's function is never executed and no real data is
 * sent.
 */
export async function probeOpenAI(
  tool: CanonicalTool,
  options: ProbeOptions = {},
): Promise<ProbeResult> {
  const base = { providerId: PROVIDER_ID, toolName: tool.name };

  const compiled = compileOpenAI(
    tool,
    options.allowLossy !== undefined ? { allowLossy: options.allowLossy } : undefined,
  );
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

  try {
    const response = await client.responses.create(
      {
        model,
        input: probePrompt(tool),
        tools: [compiled.output],
        tool_choice: { type: 'function', name: tool.name },
        max_output_tokens: PROBE_MAX_OUTPUT_TOKENS,
      },
      options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : undefined,
    );

    const { parsed, note } = extractToolCallArguments(response, tool.name);
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
