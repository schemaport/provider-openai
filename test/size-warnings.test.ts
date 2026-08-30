import { describe, expect, it } from 'vitest';
import type { CanonicalTool, JsonSchema } from '@schemaport/core';

import { checkOpenAI } from '../src/check.js';
import {
  MAX_TOTAL_ENUM_VALUES,
  MAX_TOTAL_PROPERTIES,
  MAX_TOTAL_STRING_LENGTH,
  SIZE_WARNING_FRACTION,
} from '../src/rules.js';

const tool = (inputSchema: JsonSchema): CanonicalTool => ({
  name: 'big',
  description: 'A large tool',
  inputSchema,
});

const codes = (schema: JsonSchema) => checkOpenAI(tool(schema)).map((d) => d.code);
const find = (schema: JsonSchema, code: string) =>
  checkOpenAI(tool(schema)).find((d) => d.code === code);

/** An object schema with `count` single-character-named properties. */
const withProperties = (count: number): JsonSchema => {
  const properties: Record<string, JsonSchema> = {};
  for (let i = 0; i < count; i += 1) properties[`p${i}`] = { type: 'string' };
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
};

/** One enum property carrying `count` short values. */
const withEnumValues = (count: number): JsonSchema => ({
  type: 'object',
  properties: {
    choice: { type: 'string', enum: Array.from({ length: count }, (_, i) => `v${i}`) },
  },
  required: ['choice'],
  additionalProperties: false,
});

describe('property-count headroom', () => {
  it('says nothing well under the limit', () => {
    expect(codes(withProperties(10))).not.toContain('openai/property-count-near-limit');
  });

  it('says nothing at exactly the warning fraction', () => {
    const at = Math.floor(MAX_TOTAL_PROPERTIES * SIZE_WARNING_FRACTION);

    expect(codes(withProperties(at))).not.toContain('openai/property-count-near-limit');
  });

  it('warns one property past the warning fraction', () => {
    const past = Math.floor(MAX_TOTAL_PROPERTIES * SIZE_WARNING_FRACTION) + 1;
    const warning = find(withProperties(past), 'openai/property-count-near-limit');

    expect(warning?.severity).toBe('warning');
    expect(warning?.path).toBe('inputSchema');
    expect(warning?.compile.supported).toBe(true);
  });

  it('states the headroom left', () => {
    const warning = find(withProperties(MAX_TOTAL_PROPERTIES - 3), 'openai/property-count-near-limit');

    expect(warning?.message).toContain('room for 3 more');
  });

  it('says so when there is no headroom at all', () => {
    const warning = find(withProperties(MAX_TOTAL_PROPERTIES), 'openai/property-count-near-limit');

    expect(warning?.message).toContain('no headroom left');
  });

  it('gives way to the refusal once over the limit', () => {
    const over = codes(withProperties(MAX_TOTAL_PROPERTIES + 1));

    expect(over).toContain('openai/too-many-properties');
    expect(over).not.toContain('openai/property-count-near-limit');
  });
});

describe('enum-value headroom', () => {
  it('says nothing well under the limit', () => {
    expect(codes(withEnumValues(10))).not.toContain('openai/enum-values-near-limit');
  });

  it('warns past the warning fraction', () => {
    const past = Math.floor(MAX_TOTAL_ENUM_VALUES * SIZE_WARNING_FRACTION) + 1;

    expect(codes(withEnumValues(past))).toContain('openai/enum-values-near-limit');
  });

  it('gives way to the refusal once over the limit', () => {
    const over = codes(withEnumValues(MAX_TOTAL_ENUM_VALUES + 1));

    expect(over).toContain('openai/too-many-enum-values');
    expect(over).not.toContain('openai/enum-values-near-limit');
  });
});

describe('total string length headroom', () => {
  const longNames = (count: number, nameLength: number): JsonSchema => {
    const properties: Record<string, JsonSchema> = {};
    for (let i = 0; i < count; i += 1) {
      properties[`${String(i).padStart(nameLength, 'x')}`] = { type: 'string' };
    }
    return {
      type: 'object',
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    };
  };

  it('says nothing for an ordinary schema', () => {
    expect(codes(longNames(5, 10))).not.toContain('openai/schema-size-near-limit');
  });

  it('warns past the warning fraction', () => {
    const target = Math.floor(MAX_TOTAL_STRING_LENGTH * SIZE_WARNING_FRACTION) + 200;
    const warning = find(longNames(Math.ceil(target / 120), 120), 'openai/schema-size-near-limit');

    expect(warning?.severity).toBe('warning');
    expect(warning?.message).toContain('characters');
  });
});

describe('the warnings as a set', () => {
  it('never fire together with their own refusal', () => {
    const pairs = [
      ['openai/too-many-properties', 'openai/property-count-near-limit'],
      ['openai/too-many-enum-values', 'openai/enum-values-near-limit'],
      ['openai/schema-too-large', 'openai/schema-size-near-limit'],
    ] as const;
    const emitted = codes(withProperties(MAX_TOTAL_PROPERTIES + 1));

    for (const [refusal, warning] of pairs) {
      if (emitted.includes(refusal)) expect(emitted).not.toContain(warning);
    }
  });

  it('leave a small ordinary schema completely alone', () => {
    const small = codes({
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
      additionalProperties: false,
    });

    expect(small.filter((code) => code.endsWith('-near-limit'))).toEqual([]);
  });

  it('are deterministic', () => {
    const schema = withProperties(MAX_TOTAL_PROPERTIES - 3);

    expect(checkOpenAI(tool(schema))).toEqual(checkOpenAI(tool(schema)));
  });
});
