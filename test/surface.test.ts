import { describe, expect, it } from 'vitest';
import type { CompileResult } from '@schemaport/core';
import { FIXTURE_TOOLS, refundOrderTool } from '@schemaport/core';
import type { ChatCompletionFunctionTool } from 'openai/resources/chat/completions';
import type { FunctionTool } from 'openai/resources/responses/responses';
import { compileOpenAI, openaiProvider } from '../src/index.js';
import type { OpenAIChatCompletionsTool, OpenAIFunctionTool } from '../src/index.js';
import { MAIN_RESPONSES_OUTPUT } from './fixtures/main-output.js';
import { badNameTool, cleanTool, definitionsTool, rewriteTool, scalarRootTool } from './fixtures/tools.js';

const FIXTURE_NAMES = Object.keys(FIXTURE_TOOLS).sort();

const parametersOf = (result: CompileResult): unknown => {
  const output = result.output as { parameters?: unknown; function?: { parameters?: unknown } };
  return output.function ? output.function.parameters : output.parameters;
};

const codes = (result: CompileResult): string[] => result.transformations.map((t) => t.code);

/* -------------------------------------------------------------------------- */
/* The default surface must not have moved                                     */
/* -------------------------------------------------------------------------- */

describe('the default output is byte-identical to main', () => {
  it('covers all six shared @schemaport/core fixtures', () => {
    // A core release that adds a fixture should fail here rather than quietly
    // leaving the new one unpinned.
    expect(FIXTURE_NAMES).toHaveLength(6);
    expect(Object.keys(MAIN_RESPONSES_OUTPUT).sort()).toEqual(FIXTURE_NAMES);
  });

  it.each(FIXTURE_NAMES)('%s compiles to the exact bytes main emitted', (name) => {
    const tool = FIXTURE_TOOLS[name];
    if (tool === undefined) throw new Error(`missing fixture ${name}`);
    const pinned = MAIN_RESPONSES_OUTPUT[name];
    if (pinned === undefined) throw new Error(`missing pin for ${name}`);

    const result = compileOpenAI(tool, { allowLossy: true });
    expect(JSON.stringify(result.output)).toBe(pinned.output);
    expect(JSON.stringify(result.transformations)).toBe(pinned.transformations);
    expect(result.diagnostics.map((d) => d.code)).toEqual([...pinned.diagnosticCodes]);
  });

  it.each(FIXTURE_NAMES)('%s keeps the same refusal verdict without allowLossy', (name) => {
    const tool = FIXTURE_TOOLS[name];
    if (tool === undefined) throw new Error(`missing fixture ${name}`);
    const pinned = MAIN_RESPONSES_OUTPUT[name];
    if (pinned === undefined) throw new Error(`missing pin for ${name}`);
    expect(compileOpenAI(tool).ok).toBe(pinned.okWithoutAllowLossy);
  });

  it('is what an explicit apiSurface: responses produces too', () => {
    for (const name of FIXTURE_NAMES) {
      const tool = FIXTURE_TOOLS[name];
      if (tool === undefined) throw new Error(`missing fixture ${name}`);
      expect(JSON.stringify(compileOpenAI(tool, { apiSurface: 'responses', allowLossy: true }))).toBe(
        JSON.stringify(compileOpenAI(tool, { allowLossy: true })),
      );
    }
  });

  it('is unaffected by the CLI call shape, `compile(tool, { allowLossy })`', () => {
    const viaProvider = openaiProvider.compile(refundOrderTool, { allowLossy: false });
    expect(JSON.stringify(viaProvider.output)).toBe(MAIN_RESPONSES_OUTPUT['refund_order']?.output);
  });
});

/* -------------------------------------------------------------------------- */
/* The Chat Completions envelope                                               */
/* -------------------------------------------------------------------------- */

describe('the chat-completions shape', () => {
  const result = compileOpenAI(cleanTool, { apiSurface: 'chat-completions' });

  it('nests the function definition under `function`', () => {
    expect(result.ok).toBe(true);
    expect(result.output).toEqual({
      type: 'function',
      function: {
        name: 'close_ticket',
        description: 'Closes a ticket',
        parameters: {
          type: 'object',
          properties: { ticketId: { type: 'string' } },
          required: ['ticketId'],
          additionalProperties: false,
        },
        strict: true,
      },
    });
  });

  it('is assignable to the SDK `ChatCompletionFunctionTool` type', () => {
    // A type-level assertion: `openai@7.5.0` declares
    // `{ function: Shared.FunctionDefinition; type: 'function' }`, and
    // `FunctionDefinition` is `{ name; description?; parameters?; strict? }`.
    // If either shape drifts, this stops compiling.
    const asSdkTool: ChatCompletionFunctionTool = result.output as OpenAIChatCompletionsTool;
    expect(asSdkTool.type).toBe('function');
    expect(asSdkTool.function.name).toBe('close_ticket');
  });

  it('is assignable to the SDK `FunctionTool` type on the default surface', () => {
    const asSdkTool: FunctionTool = compileOpenAI(cleanTool).output as OpenAIFunctionTool;
    expect(asSdkTool.type).toBe('function');
    expect(asSdkTool.name).toBe('close_ticket');
  });

  it('omits `description` inside `function` when the tool has none', () => {
    const output = compileOpenAI(FIXTURE_TOOLS['ping'] ?? cleanTool, {
      apiSurface: 'chat-completions',
    }).output as OpenAIChatCompletionsTool;
    expect('description' in output.function).toBe(false);
  });
});

describe('`strict` sits where each surface puts it', () => {
  it('is a sibling of `name` on the Responses tool', () => {
    const output = compileOpenAI(refundOrderTool).output as Record<string, unknown>;
    expect(output['strict']).toBe(true);
    expect(output['function']).toBeUndefined();
  });

  it('is inside `function` on the Chat Completions tool, and not at the top level', () => {
    const output = compileOpenAI(refundOrderTool, { apiSurface: 'chat-completions' })
      .output as Record<string, unknown>;
    // A top-level `strict` here would be an unrecognised field, and the schema
    // would go unenforced — the whole reason the surface has to be named.
    expect('strict' in output).toBe(false);
    expect(Object.keys(output).sort()).toEqual(['function', 'type']);
    expect((output['function'] as Record<string, unknown>)['strict']).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* One schema pipeline, two envelopes                                          */
/* -------------------------------------------------------------------------- */

describe('the surfaces share one compiled schema', () => {
  it.each(FIXTURE_NAMES)('%s has identical `parameters` on both surfaces', (name) => {
    const tool = FIXTURE_TOOLS[name];
    if (tool === undefined) throw new Error(`missing fixture ${name}`);

    const responses = compileOpenAI(tool, { allowLossy: true });
    const chat = compileOpenAI(tool, { apiSurface: 'chat-completions', allowLossy: true });

    expect(parametersOf(chat)).toEqual(parametersOf(responses));
    expect(JSON.stringify(parametersOf(chat))).toBe(JSON.stringify(parametersOf(responses)));
  });

  it.each(FIXTURE_NAMES)('%s reports identical diagnostics on both surfaces', (name) => {
    const tool = FIXTURE_TOOLS[name];
    if (tool === undefined) throw new Error(`missing fixture ${name}`);

    const responses = compileOpenAI(tool, { allowLossy: true });
    const chat = compileOpenAI(tool, { apiSurface: 'chat-completions', allowLossy: true });
    expect(JSON.stringify(chat.diagnostics)).toBe(JSON.stringify(responses.diagnostics));
  });

  it.each(FIXTURE_NAMES)(
    '%s records the same transformations plus exactly one wrapping entry',
    (name) => {
      const tool = FIXTURE_TOOLS[name];
      if (tool === undefined) throw new Error(`missing fixture ${name}`);

      const responses = compileOpenAI(tool, { allowLossy: true });
      const chat = compileOpenAI(tool, { apiSurface: 'chat-completions', allowLossy: true });

      const extra = chat.transformations.filter(
        (t) => t.code === 'nested-under-function-key',
      );
      expect(extra).toHaveLength(1);
      expect(extra[0]?.lossy).toBe(false);
      expect(extra[0]?.path).toBe('inputSchema');

      const withoutWrapper = chat.transformations.filter(
        (t) => t.code !== 'nested-under-function-key',
      );
      expect(JSON.stringify(withoutWrapper)).toBe(JSON.stringify(responses.transformations));
    },
  );

  it('does not add a wrapping transformation on the default surface', () => {
    expect(codes(compileOpenAI(refundOrderTool))).not.toContain('nested-under-function-key');
  });

  it('applies the same schema rewrites, not just the same keywords', () => {
    const chat = compileOpenAI(definitionsTool, { apiSurface: 'chat-completions' });
    expect(parametersOf(chat)).toMatchObject({
      properties: { total: { $ref: '#/$defs/Money' } },
    });
    expect(codes(chat)).toEqual(expect.arrayContaining(['renamed-definitions-to-defs']));
  });
});

/* -------------------------------------------------------------------------- */
/* Refusals do not depend on the surface                                       */
/* -------------------------------------------------------------------------- */

describe('refusal behaviour is identical across surfaces', () => {
  const refusing = [
    ['a lossy dropped keyword', FIXTURE_TOOLS['create_ticket']],
    ['a lossy open typed map', FIXTURE_TOOLS['tag_resource']],
    ['a lossy oneOf conversion', rewriteTool],
    ['an unresolvable tool name', badNameTool],
    ['a non-object root schema', scalarRootTool],
  ] as const;

  it.each(refusing)('refuses %s on both surfaces', (_label, tool) => {
    if (tool === undefined) throw new Error('missing fixture');

    const responses = compileOpenAI(tool);
    const chat = compileOpenAI(tool, { apiSurface: 'chat-completions' });

    expect(responses.ok).toBe(false);
    expect(chat.ok).toBe(false);
    expect(responses.output).toBeUndefined();
    expect(chat.output).toBeUndefined();
    expect(chat.diagnostics.map((d) => d.code)).toEqual(responses.diagnostics.map((d) => d.code));
  });

  it('accepts the same tools with allowLossy on both surfaces', () => {
    for (const [, tool] of refusing) {
      if (tool === undefined) throw new Error('missing fixture');
      const responses = compileOpenAI(tool, { allowLossy: true });
      const chat = compileOpenAI(tool, { apiSurface: 'chat-completions', allowLossy: true });
      expect(chat.ok).toBe(responses.ok);
    }
  });

  it('does not make a clean tool lossy, or a lossy tool clean', () => {
    for (const name of FIXTURE_NAMES) {
      const tool = FIXTURE_TOOLS[name];
      if (tool === undefined) throw new Error(`missing fixture ${name}`);
      expect(compileOpenAI(tool, { apiSurface: 'chat-completions' }).ok, name).toBe(
        compileOpenAI(tool).ok,
      );
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Determinism                                                                 */
/* -------------------------------------------------------------------------- */

describe('determinism on the chat-completions surface', () => {
  it.each(FIXTURE_NAMES)('%s compiles byte-identically twice', (name) => {
    const tool = FIXTURE_TOOLS[name];
    if (tool === undefined) throw new Error(`missing fixture ${name}`);
    const options = { apiSurface: 'chat-completions', allowLossy: true } as const;
    expect(JSON.stringify(compileOpenAI(tool, options))).toBe(
      JSON.stringify(compileOpenAI(tool, options)),
    );
  });

  it('does not depend on key order in the canonical source', () => {
    const reordered = {
      name: refundOrderTool.name,
      description: refundOrderTool.description,
      inputSchema: {
        required: ['orderId'],
        properties: {
          orderId: { description: 'The order to refund', type: 'string' },
          amount: {
            description: 'Amount to refund. Omit to refund the full order.',
            minimum: 0,
            type: 'number',
          },
        },
        type: 'object',
      },
    };
    expect(
      JSON.stringify(compileOpenAI(reordered, { apiSurface: 'chat-completions' }).output),
    ).toBe(
      JSON.stringify(compileOpenAI(refundOrderTool, { apiSurface: 'chat-completions' }).output),
    );
  });
});

describe('provider delegation', () => {
  it('passes apiSurface through openaiProvider.compile', () => {
    expect(
      JSON.stringify(openaiProvider.compile(refundOrderTool, { apiSurface: 'chat-completions' })),
    ).toBe(JSON.stringify(compileOpenAI(refundOrderTool, { apiSurface: 'chat-completions' })));
  });
});
