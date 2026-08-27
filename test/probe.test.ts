import { afterEach, describe, expect, it, vi } from 'vitest';
import { nestedTool, refundOrderTool } from '@schemaport/core';
import {
  DEFAULT_PROBE_MODEL,
  OPENAI_MODEL_ENV,
  PROBE_MAX_OUTPUT_TOKENS,
  openaiProvider,
  probe,
  probeOpenAI,
} from '../src/index.js';
import type { OpenAIChatCompletionsProbeClient, OpenAIProbeClient } from '../src/index.js';

/**
 * Every test drives a fake client through `options.client`. No test constructs
 * a real OpenAI client, reads a real key, or makes a network request.
 */

interface Call {
  body: Record<string, unknown>;
  options?: { timeout?: number } | undefined;
}

function fakeClient(handler: (call: Call) => unknown): {
  client: OpenAIProbeClient;
  calls: Call[];
} {
  const calls: Call[] = [];
  const client: OpenAIProbeClient = {
    responses: {
      create(body, options) {
        const call: Call = { body, options };
        calls.push(call);
        return Promise.resolve(handler(call));
      },
    },
  };
  return { client, calls };
}

function acceptingClient(args: unknown, toolName = refundOrderTool.name) {
  return fakeClient(() => ({
    output: [
      { type: 'reasoning', summary: [] },
      { type: 'function_call', name: toolName, call_id: 'c1', arguments: JSON.stringify(args) },
    ],
  }));
}

/** Mimics an `openai` SDK APIError: a status plus an `error` payload. */
function apiError(status: number, message: string, type = 'invalid_request_error'): Error {
  const error = new Error(message) as Error & { status: number; error: unknown };
  error.status = status;
  error.error = { message, type };
  return error;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('accepted', () => {
  it('exposes the concise package-level probe entrypoint', async () => {
    const { client, calls } = acceptingClient({ orderId: 'ord_alias', amount: null });
    const result = await probe(refundOrderTool, { client });

    expect(result.status).toBe('accepted');
    expect(result.providerId).toBe('openai');
    expect(calls).toHaveLength(1);
  });

  it('accepts the object-form probe request for configuration-driven callers', async () => {
    const { client, calls } = acceptingClient({ orderId: 'ord_object', amount: null });
    const result = await probe({ tool: refundOrderTool, options: { client } });

    expect(result.status).toBe('accepted');
    expect(result.providerId).toBe('openai');
    expect(calls).toHaveLength(1);
  });

  it('reports acceptance and validates arguments against the canonical schema', async () => {
    const { client, calls } = acceptingClient({ orderId: 'ord_123', amount: 12.5 });
    const result = await probeOpenAI(refundOrderTool, { client });

    expect(result.status).toBe('accepted');
    expect(result.schemaAccepted).toBe(true);
    expect(result.toolCallReturned).toBe(true);
    expect(result.argumentsValid).toBe(true);
    expect(result.argumentsReceived).toEqual({ orderId: 'ord_123', amount: 12.5 });
    expect(result.model).toBe(DEFAULT_PROBE_MODEL);
    expect(result.providerId).toBe('openai');
    expect(calls).toHaveLength(1);
  });

  it('sends the compiled tool, a forced tool choice and a small output cap', async () => {
    const { client, calls } = acceptingClient({ orderId: 'ord_1', amount: null });
    await probeOpenAI(refundOrderTool, { client });

    const body = calls[0]?.body as Record<string, unknown>;
    expect(body['model']).toBe(DEFAULT_PROBE_MODEL);
    expect(body['max_output_tokens']).toBe(PROBE_MAX_OUTPUT_TOKENS);
    expect(body['tool_choice']).toEqual({ type: 'function', name: 'refund_order' });
    expect(typeof body['input']).toBe('string');
    expect(body['tools']).toEqual([
      openaiProvider.compile(refundOrderTool).output,
    ]);
  });

  it('flags arguments that do not match the canonical schema', async () => {
    const { client } = acceptingClient({ orderId: 42 });
    const result = await probeOpenAI(refundOrderTool, { client });

    expect(result.status).toBe('accepted');
    expect(result.argumentsValid).toBe(false);
    expect(result.argumentErrors?.length).toBeGreaterThan(0);
  });

  it('accepts a response with no tool call, without claiming the shape was verified', async () => {
    const { client } = fakeClient(() => ({ output: [{ type: 'message', content: [] }] }));
    const result = await probeOpenAI(refundOrderTool, { client });

    expect(result.status).toBe('accepted');
    expect(result.toolCallReturned).toBe(false);
    expect(result.argumentsValid).toBeUndefined();
    expect(result.notes.join(' ')).toContain('did not return a tool call');
  });

  it('notes unparsable tool-call arguments instead of throwing', async () => {
    const { client } = fakeClient(() => ({
      output: [{ type: 'function_call', name: 'refund_order', arguments: '{not json' }],
    }));
    const result = await probeOpenAI(refundOrderTool, { client });

    expect(result.status).toBe('accepted');
    expect(result.toolCallReturned).toBe(false);
    expect(result.notes.join(' ')).toContain('not valid JSON');
  });
});

describe('rejected', () => {
  it('classifies a 400 invalid-schema response as a schema rejection', async () => {
    const { client } = fakeClient(() => {
      throw apiError(
        400,
        "Invalid schema for function 'refund_order': In context=('properties', 'amount'), 'minLength' is not permitted.",
      );
    });
    const result = await probeOpenAI(refundOrderTool, { client });

    expect(result.status).toBe('rejected');
    expect(result.schemaAccepted).toBe(false);
    expect(result.errorKind).toBeUndefined();
    expect(result.providerError?.status).toBe(400);
    expect(result.model).toBe(DEFAULT_PROBE_MODEL);
  });
});

describe('environment errors are never reported as schema rejections', () => {
  it('missing credentials', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const result = await probeOpenAI(refundOrderTool);

    expect(result.status).toBe('error');
    expect(result.errorKind).toBe('missing-credentials');
    expect(result.schemaAccepted).toBe(false);
    expect(result.notes.join(' ')).toContain('OPENAI_API_KEY');
  });

  it('404 model not found', async () => {
    const { client } = fakeClient(() => {
      throw apiError(404, "The model 'gpt-nope' does not exist", 'invalid_request_error');
    });
    const result = await probeOpenAI(refundOrderTool, { client, model: 'gpt-nope' });

    expect(result.status).toBe('error');
    expect(result.errorKind).toBe('model-not-found');
    expect(result.schemaAccepted).toBe(false);
    expect(result.model).toBe('gpt-nope');
  });

  it('401 authentication', async () => {
    const { client } = fakeClient(() => {
      throw apiError(401, 'Incorrect API key provided', 'invalid_request_error');
    });
    const result = await probeOpenAI(refundOrderTool, { client });

    expect(result.status).toBe('error');
    expect(result.errorKind).toBe('authentication');
  });

  it('429 rate limit', async () => {
    const { client } = fakeClient(() => {
      throw apiError(429, 'Rate limit reached', 'rate_limit_error');
    });
    const result = await probeOpenAI(refundOrderTool, { client });

    expect(result.status).toBe('error');
    expect(result.errorKind).toBe('rate-limit');
  });
});

describe('compile gate', () => {
  it('never sends a schema that compilation refused', async () => {
    const { client, calls } = acceptingClient({}, nestedTool.name);
    const result = await probeOpenAI(nestedTool, { client });

    expect(calls).toHaveLength(0);
    expect(result.status).toBe('error');
    expect(result.errorKind).toBe('compile-refused');
    expect(result.schemaAccepted).toBe(false);
  });

  it('sends the lossy schema when the caller opted in', async () => {
    const { client, calls } = acceptingClient(
      { title: 't', priority: 'low', escalated: null, attempts: null, labels: null, requester: null, history: null },
      nestedTool.name,
    );
    const result = await probeOpenAI(nestedTool, { client, allowLossy: true });

    expect(calls).toHaveLength(1);
    expect(result.status).toBe('accepted');
  });
});

describe('model and request options', () => {
  it('prefers options.model over the environment override', async () => {
    vi.stubEnv(OPENAI_MODEL_ENV, 'from-env');
    const { client } = acceptingClient({ orderId: 'o', amount: null });
    const result = await probeOpenAI(refundOrderTool, { client, model: 'from-option' });
    expect(result.model).toBe('from-option');
  });

  it('uses the environment override when no model option is given', async () => {
    vi.stubEnv(OPENAI_MODEL_ENV, 'from-env');
    const { client } = acceptingClient({ orderId: 'o', amount: null });
    const result = await probeOpenAI(refundOrderTool, { client });
    expect(result.model).toBe('from-env');
  });

  it('passes timeoutMs through to the SDK request options', async () => {
    const { client, calls } = acceptingClient({ orderId: 'o', amount: null });
    await probeOpenAI(refundOrderTool, { client, timeoutMs: 5000 });
    expect(calls[0]?.options).toEqual({ timeout: 5000 });
  });

  it('does not read the environment when a client is supplied', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const { client, calls } = acceptingClient({ orderId: 'o', amount: null });
    const result = await probeOpenAI(refundOrderTool, { client });
    expect(result.status).toBe('accepted');
    expect(calls).toHaveLength(1);
  });
});

describe('provider delegation', () => {
  it('exposes probe() on the provider', async () => {
    const { client } = acceptingClient({ orderId: 'o', amount: null });
    const result = await openaiProvider.probe?.(refundOrderTool, { client });
    expect(result?.status).toBe('accepted');
  });
});

/* -------------------------------------------------------------------------- */
/* The chat-completions surface                                                */
/* -------------------------------------------------------------------------- */

/**
 * The same seam, one level deeper: `client.chat.completions.create`. Still a
 * plain object, still no SDK construction and no network.
 */
function fakeChatClient(handler: (call: Call) => unknown): {
  client: OpenAIChatCompletionsProbeClient;
  calls: Call[];
} {
  const calls: Call[] = [];
  const client: OpenAIChatCompletionsProbeClient = {
    chat: {
      completions: {
        create(body, options) {
          const call: Call = { body, options };
          calls.push(call);
          return Promise.resolve(handler(call));
        },
      },
    },
  };
  return { client, calls };
}

function acceptingChatClient(args: unknown, toolName = refundOrderTool.name) {
  return fakeChatClient(() => ({
    choices: [
      {
        index: 0,
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: toolName, arguments: JSON.stringify(args) } },
          ],
        },
      },
    ],
  }));
}

describe('chat-completions probe', () => {
  it('reports acceptance and validates arguments against the canonical schema', async () => {
    const { client, calls } = acceptingChatClient({ orderId: 'ord_123', amount: 12.5 });
    const result = await probeOpenAI(refundOrderTool, { client, apiSurface: 'chat-completions' });

    expect(result.status).toBe('accepted');
    expect(result.schemaAccepted).toBe(true);
    expect(result.toolCallReturned).toBe(true);
    expect(result.argumentsValid).toBe(true);
    expect(result.argumentsReceived).toEqual({ orderId: 'ord_123', amount: 12.5 });
    expect(result.model).toBe(DEFAULT_PROBE_MODEL);
    expect(calls).toHaveLength(1);
  });

  it('sends the chat-shaped tool, a nested tool choice and max_completion_tokens', async () => {
    const { client, calls } = acceptingChatClient({ orderId: 'o', amount: null });
    await probeOpenAI(refundOrderTool, { client, apiSurface: 'chat-completions' });

    const body = calls[0]?.body as Record<string, unknown>;
    expect(body['model']).toBe(DEFAULT_PROBE_MODEL);
    // `max_tokens` is `@deprecated` in the SDK types; the Responses field name
    // does not exist here either.
    expect(body['max_completion_tokens']).toBe(PROBE_MAX_OUTPUT_TOKENS);
    expect('max_output_tokens' in body).toBe(false);
    expect('input' in body).toBe(false);
    expect(body['messages']).toEqual([{ role: 'user', content: expect.any(String) }]);
    // ChatCompletionNamedToolChoice nests the name; the Responses form is flat.
    expect(body['tool_choice']).toEqual({ type: 'function', function: { name: 'refund_order' } });
    expect(body['tools']).toEqual([
      openaiProvider.compile(refundOrderTool, { apiSurface: 'chat-completions' }).output,
    ]);
  });

  it('probes what the caller would actually send, not the Responses shape', async () => {
    const { client, calls } = acceptingChatClient({ orderId: 'o', amount: null });
    await probeOpenAI(refundOrderTool, { client, apiSurface: 'chat-completions' });

    const tool = (calls[0]?.body['tools'] as Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(Object.keys(tool).sort()).toEqual(['function', 'type']);
    expect((tool['function'] as Record<string, unknown>)['strict']).toBe(true);
  });

  it('still classifies a 400 as a schema rejection, not an environment error', async () => {
    const { client } = fakeChatClient(() => {
      throw apiError(400, "Invalid schema for function 'refund_order'");
    });
    const result = await probeOpenAI(refundOrderTool, { client, apiSurface: 'chat-completions' });

    expect(result.status).toBe('rejected');
    expect(result.schemaAccepted).toBe(false);
    expect(result.errorKind).toBeUndefined();
    expect(result.providerError?.status).toBe(400);
  });

  it('still separates a stale model id from a bad schema', async () => {
    const { client } = fakeChatClient(() => {
      throw apiError(404, "The model 'gpt-nope' does not exist");
    });
    const result = await probeOpenAI(refundOrderTool, {
      client,
      apiSurface: 'chat-completions',
      model: 'gpt-nope',
    });

    expect(result.status).toBe('error');
    expect(result.errorKind).toBe('model-not-found');
    expect(result.schemaAccepted).toBe(false);
  });

  it('still requires a key when no client is supplied', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const result = await probeOpenAI(refundOrderTool, { apiSurface: 'chat-completions' });

    expect(result.status).toBe('error');
    expect(result.errorKind).toBe('missing-credentials');
    expect(result.notes.join(' ')).toContain('OPENAI_API_KEY');
  });

  it('never sends a schema that compilation refused', async () => {
    const { client, calls } = acceptingChatClient({}, nestedTool.name);
    const result = await probeOpenAI(nestedTool, { client, apiSurface: 'chat-completions' });

    expect(calls).toHaveLength(0);
    expect(result.status).toBe('error');
    expect(result.errorKind).toBe('compile-refused');
    expect(result.schemaAccepted).toBe(false);
  });

  it('accepts a prose answer without claiming the argument shape was verified', async () => {
    const { client } = fakeChatClient(() => ({
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'hi' } }],
    }));
    const result = await probeOpenAI(refundOrderTool, { client, apiSurface: 'chat-completions' });

    expect(result.status).toBe('accepted');
    expect(result.toolCallReturned).toBe(false);
    expect(result.argumentsValid).toBeUndefined();
    expect(result.notes.join(' ')).toContain('did not return a tool call');
  });

  it('notes unparsable tool-call arguments instead of throwing', async () => {
    const { client } = fakeChatClient(() => ({
      choices: [
        {
          index: 0,
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: 'c1', type: 'function', function: { name: 'refund_order', arguments: '{not json' } },
            ],
          },
        },
      ],
    }));
    const result = await probeOpenAI(refundOrderTool, { client, apiSurface: 'chat-completions' });

    expect(result.status).toBe('accepted');
    expect(result.toolCallReturned).toBe(false);
    expect(result.notes.join(' ')).toContain('not valid JSON');
  });

  it('passes timeoutMs through to the SDK request options', async () => {
    const { client, calls } = acceptingChatClient({ orderId: 'o', amount: null });
    await probeOpenAI(refundOrderTool, { client, apiSurface: 'chat-completions', timeoutMs: 5000 });
    expect(calls[0]?.options).toEqual({ timeout: 5000 });
  });

  it('reports a client that cannot reach the chosen surface, without sending anything', async () => {
    const { client, calls } = acceptingClient({ orderId: 'o', amount: null });
    const result = await probeOpenAI(refundOrderTool, { client, apiSurface: 'chat-completions' });

    expect(calls).toHaveLength(0);
    expect(result.status).toBe('error');
    expect(result.errorKind).toBe('unsupported');
    expect(result.schemaAccepted).toBe(false);
  });

  it('defaults to the Responses surface when no apiSurface is given', async () => {
    const { client, calls } = acceptingClient({ orderId: 'o', amount: null });
    await probeOpenAI(refundOrderTool, { client });
    expect(calls[0]?.body['input']).toBeDefined();
    expect(calls[0]?.body['tool_choice']).toEqual({ type: 'function', name: 'refund_order' });
  });
});
