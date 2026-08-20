import type { CanonicalTool, Diagnostic, JsonSchema } from '@schemaport/core';
import { asSchema, isPlainObject, joinPath, sortDiagnostics } from '@schemaport/core';
import {
  checkAdditionalProperties,
  checkBudget,
  checkKeywords,
  checkOptionalProperties,
  checkRootSchema,
  checkSubschemaSlots,
  checkToolDescription,
  checkToolName,
} from './rules.js';

/**
 * Walk the subschemas that survive compilation, in a fixed order.
 *
 * Slots that compile drops wholesale (`allOf`, `not`, `prefixItems`,
 * `patternProperties`, `if`/`then`/`else`) are *not* descended into: the
 * keyword itself is already reported at its parent, and reporting rules about
 * the interior of a branch that will not exist in the output is noise.
 *
 * `oneOf` and `definitions` are descended into, because compile rewrites them
 * into `anyOf` and `$defs` rather than dropping them.
 */
function walkSurvivingSchemas(
  root: JsonSchema,
  rootPath: string,
  visit: (schema: JsonSchema, path: string) => void,
): void {
  const seen = new Set<JsonSchema>();

  const descend = (schema: JsonSchema, path: string): void => {
    if (seen.has(schema)) return; // recursive `$ref` targets are shared objects
    seen.add(schema);
    visit(schema, path);

    for (const keyword of ['properties', '$defs', 'definitions'] as const) {
      const map = schema[keyword];
      if (!isPlainObject(map)) continue;
      for (const [key, value] of Object.entries(map)) {
        const child = asSchema(value);
        if (child) descend(child, joinPath(path, keyword, key));
      }
    }

    for (const keyword of ['anyOf', 'oneOf'] as const) {
      const list = schema[keyword];
      if (!Array.isArray(list)) continue;
      list.forEach((value, index) => {
        const child = asSchema(value);
        if (child) descend(child, joinPath(path, keyword, index));
      });
    }

    const items = asSchema(schema.items);
    if (items) descend(items, joinPath(path, 'items'));
  };

  descend(root, rootPath);
}

/**
 * Every OpenAI compatibility rule, applied to one canonical tool.
 *
 * Diagnostics are sorted by severity, then path, then code, so the output is
 * stable across runs.
 */
export function checkOpenAI(tool: CanonicalTool): Diagnostic[] {
  const out: Diagnostic[] = [
    ...checkToolName(tool),
    ...checkToolDescription(tool),
    ...checkRootSchema(tool),
    ...checkBudget(tool),
    ...checkSubschemaSlots(tool),
  ];

  walkSurvivingSchemas(tool.inputSchema, 'inputSchema', (schema, path) => {
    out.push(...checkKeywords(tool.name, schema, path));
    out.push(...checkAdditionalProperties(tool.name, schema, path));
    out.push(...checkOptionalProperties(tool.name, schema, path));
  });

  return sortDiagnostics(out);
}
