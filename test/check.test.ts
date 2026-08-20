import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '@schemaport/core';
import { minimalTool, nestedTool, openMapTool, refundOrderTool } from '@schemaport/core';
import { DROPPED_KEYWORDS, checkOpenAI, classifyKeyword, openaiProvider } from '../src/index.js';
import {
  annotatedTool,
  closedObjectTool,
  falseInsideAllOfTool,
  falseItemsTool,
  falseSubschemaTool,
  nonSchemaSubschemaTool,
  trueSubschemaTool,
  badFormatTool,
  badNameTool,
  bigEnumTool,
  cleanTool,
  definitionsTool,
  deeplyNestedTool,
  longNameTool,
  manyPropertiesTool,
  nullableTool,
  openObjectTool,
  rewriteTool,
  scalarRootTool,
  typedMapTool,
  unionRootTool,
  unknownKeywordTool,
  unsupportedKeywordTool,
} from './fixtures/tools.js';

const codes = (diagnostics: Diagnostic[]): string[] => diagnostics.map((d) => d.code);

const find = (diagnostics: Diagnostic[], code: string): Diagnostic => {
  const hit = diagnostics.find((d) => d.code === code);
  expect(hit, `expected a \`${code}\` diagnostic, got ${codes(diagnostics).join(', ')}`).toBeDefined();
  return hit as Diagnostic;
};

describe('diagnostic conventions', () => {
  it('gives every diagnostic an openai/ code, a docs URL and the tool name', () => {
    const tools = [refundOrderTool, nestedTool, openMapTool, minimalTool, annotatedTool, rewriteTool];
    for (const tool of tools) {
      for (const item of checkOpenAI(tool)) {
        expect(item.providerId).toBe('openai');
        expect(item.toolName).toBe(tool.name);
        expect(item.code.startsWith('openai/')).toBe(true);
        expect(item.docsUrl).toMatch(/^https:\/\/developers\.openai\.com\//);
        expect(item.path.length).toBeGreaterThan(0);
      }
    }
  });

  it('implements exactly the 29 codes docs/rules.md documents', () => {
    // Guards the counts in README.md and docs/rules.md against drift.
    const documented = [
      'openai/additional-properties-schema',
      'openai/additional-properties-true',
      'openai/annotation-keyword-dropped',
      'openai/boolean-subschema',
      'openai/conflicting-definitions-keywords',
      'openai/const-converted-to-enum',
      'openai/default-keyword-dropped',
      'openai/extra-properties-no-longer-accepted',
      'openai/large-enum-too-long',
      'openai/legacy-definitions-keyword',
      'openai/missing-tool-description',
      'openai/non-schema-subschema',
      'openai/nullable-instead-of-omitted',
      'openai/nullable-keyword-converted',
      'openai/object-missing-additional-properties',
      'openai/one-of-converted-to-any-of',
      'openai/root-schema-anyof',
      'openai/root-schema-not-object',
      'openai/schema-too-deep',
      'openai/schema-too-large',
      'openai/strict-optional-property',
      'openai/too-many-enum-values',
      'openai/too-many-properties',
      'openai/tool-name-invalid-characters',
      'openai/tool-name-too-long',
      'openai/undocumented-constraint-keyword',
      'openai/unknown-keyword',
      'openai/unsupported-keyword',
      'openai/unsupported-string-format',
    ];
    expect(documented).toHaveLength(29);
    expect(new Set(documented).size).toBe(29);
  });

  it('is stable: the same tool always produces the same diagnostics', () => {
    expect(JSON.stringify(checkOpenAI(nestedTool))).toBe(JSON.stringify(checkOpenAI(nestedTool)));
  });
});

describe('valid fixtures', () => {
  it('reports nothing for a closed, fully required tool', () => {
    expect(checkOpenAI(cleanTool)).toEqual([]);
  });
});

describe('tool name rules', () => {
  it('openai/tool-name-invalid-characters', () => {
    const hit = find(checkOpenAI(badNameTool), 'openai/tool-name-invalid-characters');
    expect(hit.severity).toBe('error');
    expect(hit.compile.supported).toBe(false);
    expect(hit.path).toBe('name');
  });

  it('openai/tool-name-too-long', () => {
    const hit = find(checkOpenAI(longNameTool), 'openai/tool-name-too-long');
    expect(hit.severity).toBe('error');
    expect(hit.compile.supported).toBe(false);
  });
});

describe('tool description rule', () => {
  it('openai/missing-tool-description', () => {
    const hit = find(checkOpenAI(minimalTool), 'openai/missing-tool-description');
    expect(hit.severity).toBe('info');
  });

  it('is silent when a description is present', () => {
    expect(codes(checkOpenAI(refundOrderTool))).not.toContain('openai/missing-tool-description');
  });
});

describe('root schema rules', () => {
  it('openai/root-schema-not-object', () => {
    const hit = find(checkOpenAI(scalarRootTool), 'openai/root-schema-not-object');
    expect(hit.severity).toBe('error');
    expect(hit.compile.supported).toBe(false);
  });

  it('openai/root-schema-anyof', () => {
    const hit = find(checkOpenAI(unionRootTool), 'openai/root-schema-anyof');
    expect(hit.severity).toBe('error');
    expect(hit.compile.supported).toBe(false);
  });
});

describe('object rules', () => {
  it('openai/strict-optional-property is an error: OpenAI rejects the schema as written', () => {
    const hit = find(checkOpenAI(refundOrderTool), 'openai/strict-optional-property');
    expect(hit.severity).toBe('error');
    expect(hit.path).toBe('inputSchema.properties.amount');
    expect(hit.compile).toEqual({
      supported: true,
      lossy: false,
      detail: 'Emits `amount` as required and nullable.',
    });
  });

  it('openai/nullable-instead-of-omitted is the surviving runtime warning', () => {
    const hit = find(checkOpenAI(refundOrderTool), 'openai/nullable-instead-of-omitted');
    expect(hit.severity).toBe('warning');
    expect(hit.path).toBe('inputSchema.properties.amount');
    expect(hit.compile.lossy).toBe(false);
    expect(hit.message).toContain('amount: null');
  });

  it('pairs the two optional-property diagnostics, error before warning', () => {
    const pair = checkOpenAI(refundOrderTool).filter(
      (d) => d.path === 'inputSchema.properties.amount',
    );
    expect(pair.map((d) => [d.severity, d.code])).toEqual([
      ['error', 'openai/strict-optional-property'],
      ['warning', 'openai/nullable-instead-of-omitted'],
    ]);
  });

  it('emits the runtime warning only for properties that were actually optional', () => {
    const warned = checkOpenAI(refundOrderTool)
      .filter((d) => d.code === 'openai/nullable-instead-of-omitted')
      .map((d) => d.path);
    expect(warned).toEqual(['inputSchema.properties.amount']);
    // `orderId` was already required, so nothing about it changes at runtime.
    expect(warned).not.toContain('inputSchema.properties.orderId');
  });

  it('reports optional properties nested inside array items', () => {
    const paths = checkOpenAI(nestedTool)
      .filter((d) => d.code === 'openai/nullable-instead-of-omitted')
      .map((d) => d.path);
    expect(paths).toContain('inputSchema.properties.history.items.properties.note');
    expect(paths).toContain('inputSchema.properties.requester.properties.name');
  });

  it('openai/object-missing-additional-properties', () => {
    const hit = find(checkOpenAI(refundOrderTool), 'openai/object-missing-additional-properties');
    expect(hit.severity).toBe('error');
    expect(hit.compile).toEqual({
      supported: true,
      lossy: false,
      detail: 'Adds `additionalProperties: false`.',
    });
  });

  it('openai/additional-properties-true is an error: strict mode forbids `true`', () => {
    const hit = find(checkOpenAI(openObjectTool), 'openai/additional-properties-true');
    expect(hit.severity).toBe('error');
    expect(hit.compile.lossy).toBe(false);
  });

  it('openai/extra-properties-no-longer-accepted is the surviving runtime warning', () => {
    const hit = find(checkOpenAI(openObjectTool), 'openai/extra-properties-no-longer-accepted');
    expect(hit.severity).toBe('warning');
    expect(hit.compile.lossy).toBe(false);
  });

  it('openai/additional-properties-schema is lossy', () => {
    const hit = find(checkOpenAI(typedMapTool), 'openai/additional-properties-schema');
    expect(hit.severity).toBe('error');
    expect(hit.compile).toEqual({
      supported: true,
      lossy: true,
      detail:
        'Replaces the value schema with `additionalProperties: false`, dropping the map.',
    });
  });

  it('flags the shared open-map fixture from core', () => {
    expect(codes(checkOpenAI(openMapTool))).toContain('openai/additional-properties-schema');
  });
});

describe('keyword rules', () => {
  it('openai/unsupported-keyword covers keywords OpenAI names as unsupported', () => {
    const diagnostics = checkOpenAI(unsupportedKeywordTool).filter(
      (d) => d.code === 'openai/unsupported-keyword',
    );
    expect(diagnostics.map((d) => d.path)).toEqual(['inputSchema.properties.shape.allOf']);
    expect(diagnostics[0]?.severity).toBe('error');
    expect(diagnostics[0]?.compile.lossy).toBe(true);
  });

  it('openai/undocumented-constraint-keyword covers keywords merely absent from the list', () => {
    const diagnostics = checkOpenAI(unsupportedKeywordTool).filter(
      (d) => d.code === 'openai/undocumented-constraint-keyword',
    );
    expect(diagnostics.map((d) => d.path).sort()).toEqual([
      'inputSchema.properties.code.maxLength',
      'inputSchema.properties.code.minLength',
    ]);
    for (const item of diagnostics) {
      expect(item.severity).toBe('error');
      expect(item.compile.lossy).toBe(true);
      // The rule must own up to the weaker evidence rather than assert a fact.
      expect(item.message).toContain('could not confirm');
    }
  });

  it('separates the two evidence tiers', () => {
    expect(DROPPED_KEYWORDS.documentedUnsupported).toContain('allOf');
    expect(DROPPED_KEYWORDS.documentedUnsupported).not.toContain('minLength');
    expect(DROPPED_KEYWORDS.undocumented).toContain('minLength');
    expect(classifyKeyword('allOf')).toBe('unsupported-constraint');
    expect(classifyKeyword('minLength')).toBe('undocumented-constraint');
    expect(classifyKeyword('pattern')).toBe('supported');
    expect(classifyKeyword('x-anything')).toBe('unknown');
  });

  it('openai/unknown-keyword treats undocumented keywords as lossy', () => {
    const hit = find(checkOpenAI(unknownKeywordTool), 'openai/unknown-keyword');
    expect(hit.severity).toBe('error');
    expect(hit.compile.lossy).toBe(true);
    expect(hit.path).toBe('inputSchema.properties.id["x-internal-tag"]');
  });

  it('openai/annotation-keyword-dropped is info and not lossy', () => {
    const diagnostics = checkOpenAI(annotatedTool).filter(
      (d) => d.code === 'openai/annotation-keyword-dropped',
    );
    expect(diagnostics.length).toBeGreaterThan(0);
    for (const item of diagnostics) {
      expect(item.severity).toBe('info');
      expect(item.compile.lossy).toBe(false);
    }
  });

  it('openai/default-keyword-dropped is a warning', () => {
    const hit = find(checkOpenAI(annotatedTool), 'openai/default-keyword-dropped');
    expect(hit.severity).toBe('warning');
    expect(hit.compile.lossy).toBe(false);
    expect(hit.path).toBe('inputSchema.properties.mode.default');
  });

  it('openai/const-converted-to-enum', () => {
    const hit = find(checkOpenAI(rewriteTool), 'openai/const-converted-to-enum');
    expect(hit.severity).toBe('info');
    expect(hit.compile.lossy).toBe(false);
  });

  it('openai/one-of-converted-to-any-of is lossy', () => {
    const hit = find(checkOpenAI(rewriteTool), 'openai/one-of-converted-to-any-of');
    expect(hit.severity).toBe('error');
    expect(hit.compile.lossy).toBe(true);
  });

  it('openai/legacy-definitions-keyword', () => {
    const hit = find(checkOpenAI(definitionsTool), 'openai/legacy-definitions-keyword');
    expect(hit.severity).toBe('warning');
    expect(hit.compile.lossy).toBe(false);
  });

  it('openai/nullable-keyword-converted', () => {
    const hit = find(checkOpenAI(nullableTool), 'openai/nullable-keyword-converted');
    expect(hit.severity).toBe('warning');
    expect(hit.compile.lossy).toBe(false);
  });

  it('openai/unsupported-string-format is lossy', () => {
    const hit = find(checkOpenAI(badFormatTool), 'openai/unsupported-string-format');
    expect(hit.severity).toBe('error');
    expect(hit.compile.lossy).toBe(true);
  });

  it('keeps documented formats', () => {
    expect(codes(checkOpenAI(nestedTool))).not.toContain('openai/unsupported-string-format');
  });
});

describe('boolean and non-schema subschemas', () => {
  it('openai/boolean-subschema is an error for `false`, because `{}` is far wider', () => {
    const hit = find(checkOpenAI(falseSubschemaTool), 'openai/boolean-subschema');
    expect(hit.severity).toBe('error');
    expect(hit.compile).toEqual({
      supported: true,
      lossy: true,
      detail: 'Emits `{}`, which accepts any value.',
    });
    expect(hit.path).toBe('inputSchema.properties.a');
  });

  it('openai/boolean-subschema is only an info for `true`, which is equivalent', () => {
    const hit = find(checkOpenAI(trueSubschemaTool), 'openai/boolean-subschema');
    expect(hit.severity).toBe('info');
    expect(hit.compile.lossy).toBe(false);
  });

  it('fires on `items: false`', () => {
    const hit = find(checkOpenAI(falseItemsTool), 'openai/boolean-subschema');
    expect(hit.severity).toBe('error');
    expect(hit.path).toBe('inputSchema.properties.xs.items');
  });

  it('fires inside a slot compile drops wholesale, and says so', () => {
    const hit = find(checkOpenAI(falseInsideAllOfTool), 'openai/boolean-subschema');
    expect(hit.path).toBe('inputSchema.properties.a.allOf[0]');
    expect(hit.compile.lossy).toBe(true);
    expect(hit.compile.detail).toContain('enclosing keyword is dropped');
  });

  it('openai/non-schema-subschema covers values that are not schemas at all', () => {
    const hit = find(checkOpenAI(nonSchemaSubschemaTool), 'openai/non-schema-subschema');
    expect(hit.severity).toBe('error');
    expect(hit.compile.lossy).toBe(true);
    expect(hit.message).toContain('type string');
  });

  it('does NOT fire for `additionalProperties: false`, whose normal form is a boolean', () => {
    expect(codes(checkOpenAI(closedObjectTool))).toEqual([]);
    expect(codes(checkOpenAI(refundOrderTool))).not.toContain('openai/boolean-subschema');
    expect(codes(checkOpenAI(openObjectTool))).not.toContain('openai/boolean-subschema');
  });

  it('is silent for every shared core fixture', () => {
    for (const tool of [refundOrderTool, nestedTool, openMapTool, minimalTool]) {
      expect(codes(checkOpenAI(tool))).not.toContain('openai/boolean-subschema');
    }
  });
});

describe('size limit rules', () => {
  it('openai/schema-too-deep', () => {
    expect(codes(checkOpenAI(deeplyNestedTool(10)))).not.toContain('openai/schema-too-deep');
    const hit = find(checkOpenAI(deeplyNestedTool(11)), 'openai/schema-too-deep');
    expect(hit.compile.supported).toBe(false);
  });

  it('openai/too-many-enum-values', () => {
    expect(codes(checkOpenAI(bigEnumTool(1000)))).not.toContain('openai/too-many-enum-values');
    expect(codes(checkOpenAI(bigEnumTool(1001)))).toContain('openai/too-many-enum-values');
  });

  it('openai/large-enum-too-long', () => {
    const hit = find(checkOpenAI(bigEnumTool(300, 60)), 'openai/large-enum-too-long');
    expect(hit.path).toBe('inputSchema.properties.choice.enum');
  });

  it('openai/too-many-properties', () => {
    expect(codes(checkOpenAI(manyPropertiesTool(5000)))).not.toContain('openai/too-many-properties');
    expect(codes(checkOpenAI(manyPropertiesTool(5001)))).toContain('openai/too-many-properties');
  });

  it('openai/schema-too-large', () => {
    expect(codes(checkOpenAI(bigEnumTool(999, 200)))).toContain('openai/schema-too-large');
  });
});

describe('provider metadata', () => {
  it('exposes the required identity fields', () => {
    expect(openaiProvider.id).toBe('openai');
    expect(openaiProvider.displayName).toBe('OpenAI');
    expect(openaiProvider.rulesReviewedAt).toBe('2026-08-20');
    expect(openaiProvider.apiKeyEnvVar).toBe('OPENAI_API_KEY');
    expect(openaiProvider.docs.length).toBeGreaterThan(0);
    for (const doc of openaiProvider.docs) {
      expect(doc.url).toMatch(/^https:\/\/developers\.openai\.com\//);
      expect(doc.title.length).toBeGreaterThan(0);
    }
  });

  it('delegates check() to checkOpenAI', () => {
    expect(openaiProvider.check(refundOrderTool)).toEqual(checkOpenAI(refundOrderTool));
  });
});
