import { describe, expect, it } from 'vitest';
import type { CompileResult, Transformation } from '@schemaport/core';
import { isLossy, minimalTool, nestedTool, openMapTool, refundOrderTool } from '@schemaport/core';
import { compileOpenAI, openaiProvider } from '../src/index.js';
import {
  annotatedTool,
  closedObjectTool,
  falseItemsTool,
  falseSubschemaTool,
  nonSchemaSubschemaTool,
  trueSubschemaTool,
  badFormatTool,
  badNameTool,
  cleanTool,
  definitionsTool,
  nullableTool,
  openObjectTool,
  rewriteTool,
  scalarRootTool,
  typedMapTool,
  unknownKeywordTool,
  unsupportedKeywordTool,
} from './fixtures/tools.js';

const codes = (transformations: Transformation[]): string[] => transformations.map((t) => t.code);

const lossyCodes = (result: CompileResult): string[] =>
  result.transformations.filter((t) => t.lossy).map((t) => t.code);

describe('output shape', () => {
  it('emits the Responses API FunctionTool shape with strict: true', () => {
    const result = compileOpenAI(cleanTool);
    expect(result.ok).toBe(true);
    expect(result.output).toEqual({
      type: 'function',
      name: 'close_ticket',
      description: 'Closes a ticket',
      parameters: {
        type: 'object',
        properties: { ticketId: { type: 'string' } },
        required: ['ticketId'],
        additionalProperties: false,
      },
      strict: true,
    });
  });

  it('omits `description` when the canonical tool has none', () => {
    const output = compileOpenAI(minimalTool).output as Record<string, unknown>;
    expect('description' in output).toBe(false);
  });
});

describe('refund_order — the headline case', () => {
  const result = compileOpenAI(refundOrderTool);

  it('compiles without allowLossy', () => {
    expect(result.ok).toBe(true);
    expect(isLossy(result)).toBe(false);
  });

  it('carries exactly one surviving warning, about the optional property', () => {
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning');
    expect(result.diagnostics).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings.map((d) => d.code)).toContain('openai/nullable-instead-of-omitted');
  });

  it('emits `amount` as required and nullable, keeping `minimum`', () => {
    expect(result.output).toEqual({
      type: 'function',
      name: 'refund_order',
      description: 'Refunds all or part of an order',
      parameters: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'The order to refund' },
          amount: {
            type: ['number', 'null'],
            description: 'Amount to refund. Omit to refund the full order.',
            minimum: 0,
          },
        },
        required: ['orderId', 'amount'],
        additionalProperties: false,
      },
      strict: true,
    });
  });

  it('records the transformations it applied, none of them lossy', () => {
    expect(result.transformations).toEqual([
      {
        code: 'renamed-input-schema-to-parameters',
        path: 'inputSchema',
        detail: 'Emitted `inputSchema` as the OpenAI `parameters` field.',
        lossy: false,
      },
      {
        code: 'enabled-strict-mode',
        path: 'inputSchema',
        detail:
          'Emitted `strict: true` so OpenAI enforces the schema instead of best-effort matching.',
        lossy: false,
      },
      {
        code: 'converted-optional-property-to-nullable',
        path: 'inputSchema.properties.amount',
        detail:
          'Made `amount` required and added `"null"` to its type; strict mode has no optional properties.',
        lossy: false,
      },
      {
        code: 'added-additional-properties-false',
        path: 'inputSchema.additionalProperties',
        detail: 'Added `additionalProperties: false`, which strict mode requires on every object.',
        lossy: false,
      },
    ]);
  });
});

describe('determinism', () => {
  const tools = [refundOrderTool, nestedTool, minimalTool, rewriteTool, definitionsTool];

  it.each(tools.map((tool) => [tool.name, tool] as const))(
    'compiles %s byte-identically twice',
    (_name, tool) => {
      const first = compileOpenAI(tool, { allowLossy: true });
      const second = compileOpenAI(tool, { allowLossy: true });
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      expect(JSON.stringify(first.output)).toBe(JSON.stringify(second.output));
    },
  );

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
    expect(JSON.stringify(compileOpenAI(reordered).output)).toBe(
      JSON.stringify(compileOpenAI(refundOrderTool).output),
    );
  });
});

describe('non-lossy transformations', () => {
  it('closes an explicitly open object', () => {
    const result = compileOpenAI(openObjectTool);
    expect(result.ok).toBe(true);
    expect(codes(result.transformations)).toContain('closed-open-object');
    expect(lossyCodes(result)).toEqual([]);
    expect(result.diagnostics.map((d) => d.code)).toContain(
      'openai/extra-properties-no-longer-accepted',
    );
    // The `error` form was worked around by compile, so finalizeCompile drops it.
    expect(result.diagnostics.map((d) => d.code)).not.toContain(
      'openai/additional-properties-true',
    );
  });

  it('rewrites `const` to a single-value enum', () => {
    const result = compileOpenAI(rewriteTool, { allowLossy: true });
    const parameters = (result.output as { parameters: Record<string, never> }).parameters;
    expect(parameters).toMatchObject({ properties: { kind: { enum: ['refund'] } } });
    expect(codes(result.transformations)).toContain('converted-const-to-enum');
  });

  it('renames draft-07 `definitions` to `$defs` and repoints references', () => {
    const result = compileOpenAI(definitionsTool);
    expect(result.ok).toBe(true);
    expect(lossyCodes(result)).toEqual([]);
    expect(result.output).toEqual({
      type: 'function',
      name: 'draft07',
      description: 'Uses draft-07 definitions',
      parameters: {
        type: 'object',
        properties: { total: { $ref: '#/$defs/Money' } },
        required: ['total'],
        additionalProperties: false,
        $defs: {
          Money: {
            type: 'object',
            properties: { cents: { type: 'integer' } },
            required: ['cents'],
            additionalProperties: false,
          },
        },
      },
      strict: true,
    });
    expect(codes(result.transformations)).toEqual(
      expect.arrayContaining(['renamed-definitions-to-defs', 'rewrote-definitions-reference']),
    );
  });

  it('turns OpenAPI `nullable: true` into a type union', () => {
    const result = compileOpenAI(nullableTool);
    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      parameters: { properties: { note: { type: ['string', 'null'] } } },
    });
    expect(codes(result.transformations)).toContain('converted-nullable-to-type-union');
  });

  it('drops annotations and `default` without becoming lossy', () => {
    const result = compileOpenAI(annotatedTool);
    expect(result.ok).toBe(true);
    expect(lossyCodes(result)).toEqual([]);
    expect(result.output).toMatchObject({
      parameters: { properties: { mode: { type: 'string' } } },
    });
    expect(codes(result.transformations)).toEqual(
      expect.arrayContaining(['dropped-annotation-keyword', 'dropped-default-keyword']),
    );
  });
});

describe('the lossy gate', () => {
  const lossyTools = [
    ['documented-unsupported keywords', unsupportedKeywordTool, 'dropped-unsupported-keyword'],
    ['undocumented constraint keywords', unsupportedKeywordTool, 'dropped-undocumented-constraint-keyword'],
    ['unknown keywords', unknownKeywordTool, 'dropped-unknown-keyword'],
    ['unsupported format', badFormatTool, 'dropped-unsupported-format'],
    ['typed additionalProperties map', typedMapTool, 'dropped-additional-properties-schema'],
    ['oneOf', rewriteTool, 'converted-one-of-to-any-of'],
    ['shared open-map fixture', openMapTool, 'dropped-additional-properties-schema'],
    ['shared nested fixture', nestedTool, 'dropped-undocumented-constraint-keyword'],
  ] as const;

  it.each(lossyTools)('refuses %s without allowLossy', (_label, tool, code) => {
    const result = compileOpenAI(tool);
    expect(result.ok).toBe(false);
    expect(result.output).toBeUndefined();
    expect(lossyCodes(result)).toContain(code);
    expect(result.diagnostics.map((d) => d.code)).toContain('core/lossy-transformation-refused');
  });

  it.each(lossyTools)('compiles %s with allowLossy', (_label, tool, code) => {
    const result = compileOpenAI(tool, { allowLossy: true });
    expect(result.ok).toBe(true);
    expect(result.output).toBeDefined();
    expect(lossyCodes(result)).toContain(code);
    expect(result.diagnostics.map((d) => d.code)).not.toContain('core/lossy-transformation-refused');
  });

  it('drops the unsupported keyword from the output', () => {
    const result = compileOpenAI(unsupportedKeywordTool, { allowLossy: true });
    expect(result.output).toMatchObject({
      parameters: { properties: { code: { type: 'string' } } },
    });
    const code = (
      result.output as { parameters: { properties: { code: Record<string, unknown> } } }
    ).parameters.properties.code;
    expect('minLength' in code).toBe(false);
    expect('maxLength' in code).toBe(false);
  });

  it('emits `oneOf` branches as `anyOf`', () => {
    const result = compileOpenAI(rewriteTool, { allowLossy: true });
    expect(result.output).toMatchObject({
      parameters: {
        properties: { value: { anyOf: [{ type: 'string' }, { type: 'number' }] } },
      },
    });
  });
});

describe('boolean and non-schema subschemas', () => {
  it('refuses a `false` subschema without allowLossy', () => {
    const result = compileOpenAI(falseSubschemaTool);
    expect(result.ok).toBe(false);
    expect(result.output).toBeUndefined();
    expect(lossyCodes(result)).toContain('widened-false-subschema');
    expect(result.diagnostics.map((d) => d.code)).toContain('core/lossy-transformation-refused');
  });

  it('compiles a `false` subschema to `{}` under allowLossy, recorded lossy', () => {
    const result = compileOpenAI(falseSubschemaTool, { allowLossy: true });
    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      parameters: { properties: { a: {}, b: { type: 'string' } } },
    });
    expect(result.transformations).toContainEqual({
      code: 'widened-false-subschema',
      path: 'inputSchema.properties.a',
      detail:
        'Emitted `{}` in place of the `false` subschema. OpenAI cannot express "accept nothing", so this now accepts any value.',
      lossy: true,
    });
  });

  it('compiles a `true` subschema cleanly, with no lossy transformation', () => {
    const result = compileOpenAI(trueSubschemaTool);
    expect(result.ok).toBe(true);
    expect(lossyCodes(result)).toEqual([]);
    expect(result.output).toMatchObject({ parameters: { properties: { a: {} } } });
    expect(codes(result.transformations)).toContain('normalized-true-subschema');
  });

  it('emits `items: {}` rather than dropping `items` entirely', () => {
    const result = compileOpenAI(falseItemsTool, { allowLossy: true });
    const xs = (
      result.output as { parameters: { properties: { xs: Record<string, unknown> } } }
    ).parameters.properties.xs;
    // Regression guard: `items` used to vanish, letting the array accept anything.
    expect('items' in xs).toBe(true);
    expect(xs['items']).toEqual({});
    expect(lossyCodes(result)).toContain('widened-false-subschema');
  });

  it('refuses a non-schema subschema value', () => {
    const result = compileOpenAI(nonSchemaSubschemaTool);
    expect(result.ok).toBe(false);
    expect(lossyCodes(result)).toContain('widened-invalid-subschema');
  });

  it('does not regress `additionalProperties: false`', () => {
    const result = compileOpenAI(closedObjectTool);
    expect(result.ok).toBe(true);
    expect(result.transformations).toEqual([
      {
        code: 'renamed-input-schema-to-parameters',
        path: 'inputSchema',
        detail: 'Emitted `inputSchema` as the OpenAI `parameters` field.',
        lossy: false,
      },
      {
        code: 'enabled-strict-mode',
        path: 'inputSchema',
        detail:
          'Emitted `strict: true` so OpenAI enforces the schema instead of best-effort matching.',
        lossy: false,
      },
    ]);
    expect(result.output).toEqual({
      type: 'function',
      name: 'closed_object',
      description: 'Uses additionalProperties: false',
      parameters: {
        type: 'object',
        properties: { a: { type: 'string' } },
        required: ['a'],
        additionalProperties: false,
      },
      strict: true,
    });
  });
});

describe('unresolvable errors', () => {
  it('refuses a tool whose name OpenAI rejects, even with allowLossy', () => {
    const result = compileOpenAI(badNameTool, { allowLossy: true });
    expect(result.ok).toBe(false);
    expect(result.output).toBeUndefined();
    expect(result.diagnostics.map((d) => d.code)).toContain('openai/tool-name-invalid-characters');
  });

  it('refuses a non-object root schema', () => {
    const result = compileOpenAI(scalarRootTool, { allowLossy: true });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain('openai/root-schema-not-object');
  });
});

describe('provider delegation', () => {
  it('compile() goes through compileOpenAI', () => {
    expect(JSON.stringify(openaiProvider.compile(refundOrderTool))).toBe(
      JSON.stringify(compileOpenAI(refundOrderTool)),
    );
  });
});
