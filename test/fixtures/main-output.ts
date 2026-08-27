/**
 * Output pinned from `main` (d171ded), before the `apiSurface` option existed.
 *
 * These strings were produced by running `compileOpenAI` on that commit against
 * the six shared `@schemaport/core` fixtures. They are the contract the CLI
 * depends on: `compile(tool)` and `compile(tool, { allowLossy })` must keep
 * emitting exactly this, byte for byte, now that a second output target exists.
 *
 * Do not regenerate these from the current source — that would make the test
 * pin the code to itself. Regenerate them only from a commit you have decided
 * is the new baseline, and say so in the changelog.
 */
export interface PinnedCompile {
  /** `JSON.stringify(compileOpenAI(tool, { allowLossy: true }).output)` */
  readonly output: string;
  /** `JSON.stringify(...transformations)` — the array the CLI writes into its manifest. */
  readonly transformations: string;
  /** Diagnostic codes, in order. */
  readonly diagnosticCodes: readonly string[];
  /** `compileOpenAI(tool).ok` with no `allowLossy` — the refusal gate. */
  readonly okWithoutAllowLossy: boolean;
}

export const MAIN_RESPONSES_OUTPUT: Readonly<Record<string, PinnedCompile>> = Object.freeze({
  create_ticket: {
    output:
      "{\"type\":\"function\",\"name\":\"create_ticket\",\"description\":\"Creates a support ticket\",\"parameters\":{\"type\":\"object\",\"properties\":{\"title\":{\"type\":\"string\"},\"priority\":{\"type\":\"string\",\"enum\":[\"low\",\"medium\",\"high\"]},\"escalated\":{\"type\":[\"boolean\",\"null\"]},\"attempts\":{\"type\":[\"integer\",\"null\"],\"minimum\":0,\"maximum\":10},\"labels\":{\"type\":[\"array\",\"null\"],\"maxItems\":20,\"items\":{\"type\":\"string\"}},\"requester\":{\"type\":[\"object\",\"null\"],\"properties\":{\"email\":{\"type\":\"string\",\"format\":\"email\"},\"name\":{\"type\":[\"string\",\"null\"]}},\"required\":[\"email\",\"name\"],\"additionalProperties\":false},\"history\":{\"type\":[\"array\",\"null\"],\"items\":{\"type\":\"object\",\"properties\":{\"at\":{\"type\":\"string\"},\"note\":{\"type\":[\"string\",\"null\"]}},\"required\":[\"at\",\"note\"],\"additionalProperties\":false}}},\"required\":[\"title\",\"priority\",\"escalated\",\"attempts\",\"labels\",\"requester\",\"history\"],\"additionalProperties\":false},\"strict\":true}",
    transformations:
      "[{\"code\":\"renamed-input-schema-to-parameters\",\"path\":\"inputSchema\",\"detail\":\"Emitted `inputSchema` as the OpenAI `parameters` field.\",\"lossy\":false},{\"code\":\"enabled-strict-mode\",\"path\":\"inputSchema\",\"detail\":\"Emitted `strict: true` so OpenAI enforces the schema instead of best-effort matching.\",\"lossy\":false},{\"code\":\"dropped-undocumented-constraint-keyword\",\"path\":\"inputSchema.properties.title.minLength\",\"detail\":\"Dropped `minLength`; OpenAI does not list it as supported and SchemaPort could not confirm it is enforced.\",\"lossy\":true},{\"code\":\"dropped-undocumented-constraint-keyword\",\"path\":\"inputSchema.properties.title.maxLength\",\"detail\":\"Dropped `maxLength`; OpenAI does not list it as supported and SchemaPort could not confirm it is enforced.\",\"lossy\":true},{\"code\":\"converted-optional-property-to-nullable\",\"path\":\"inputSchema.properties.requester.properties.name\",\"detail\":\"Made `name` required and added `\\\"null\\\"` to its type; strict mode has no optional properties.\",\"lossy\":false},{\"code\":\"added-additional-properties-false\",\"path\":\"inputSchema.properties.requester.additionalProperties\",\"detail\":\"Added `additionalProperties: false`, which strict mode requires on every object.\",\"lossy\":false},{\"code\":\"converted-optional-property-to-nullable\",\"path\":\"inputSchema.properties.history.items.properties.note\",\"detail\":\"Made `note` required and added `\\\"null\\\"` to its type; strict mode has no optional properties.\",\"lossy\":false},{\"code\":\"added-additional-properties-false\",\"path\":\"inputSchema.properties.history.items.additionalProperties\",\"detail\":\"Added `additionalProperties: false`, which strict mode requires on every object.\",\"lossy\":false},{\"code\":\"converted-optional-property-to-nullable\",\"path\":\"inputSchema.properties.escalated\",\"detail\":\"Made `escalated` required and added `\\\"null\\\"` to its type; strict mode has no optional properties.\",\"lossy\":false},{\"code\":\"converted-optional-property-to-nullable\",\"path\":\"inputSchema.properties.attempts\",\"detail\":\"Made `attempts` required and added `\\\"null\\\"` to its type; strict mode has no optional properties.\",\"lossy\":false},{\"code\":\"converted-optional-property-to-nullable\",\"path\":\"inputSchema.properties.labels\",\"detail\":\"Made `labels` required and added `\\\"null\\\"` to its type; strict mode has no optional properties.\",\"lossy\":false},{\"code\":\"converted-optional-property-to-nullable\",\"path\":\"inputSchema.properties.requester\",\"detail\":\"Made `requester` required and added `\\\"null\\\"` to its type; strict mode has no optional properties.\",\"lossy\":false},{\"code\":\"converted-optional-property-to-nullable\",\"path\":\"inputSchema.properties.history\",\"detail\":\"Made `history` required and added `\\\"null\\\"` to its type; strict mode has no optional properties.\",\"lossy\":false},{\"code\":\"added-additional-properties-false\",\"path\":\"inputSchema.additionalProperties\",\"detail\":\"Added `additionalProperties: false`, which strict mode requires on every object.\",\"lossy\":false}]",
    diagnosticCodes: ["openai/nullable-instead-of-omitted", "openai/nullable-instead-of-omitted", "openai/nullable-instead-of-omitted", "openai/nullable-instead-of-omitted", "openai/nullable-instead-of-omitted", "openai/nullable-instead-of-omitted", "openai/nullable-instead-of-omitted"],
    okWithoutAllowLossy: false,
  },
  ping: {
    output:
      "{\"type\":\"function\",\"name\":\"ping\",\"parameters\":{\"type\":\"object\",\"properties\":{},\"required\":[],\"additionalProperties\":false},\"strict\":true}",
    transformations:
      "[{\"code\":\"renamed-input-schema-to-parameters\",\"path\":\"inputSchema\",\"detail\":\"Emitted `inputSchema` as the OpenAI `parameters` field.\",\"lossy\":false},{\"code\":\"enabled-strict-mode\",\"path\":\"inputSchema\",\"detail\":\"Emitted `strict: true` so OpenAI enforces the schema instead of best-effort matching.\",\"lossy\":false},{\"code\":\"added-additional-properties-false\",\"path\":\"inputSchema.additionalProperties\",\"detail\":\"Added `additionalProperties: false`, which strict mode requires on every object.\",\"lossy\":false}]",
    diagnosticCodes: ["openai/missing-tool-description"],
    okWithoutAllowLossy: true,
  },
  refund_order: {
    output:
      "{\"type\":\"function\",\"name\":\"refund_order\",\"description\":\"Refunds all or part of an order\",\"parameters\":{\"type\":\"object\",\"properties\":{\"orderId\":{\"type\":\"string\",\"description\":\"The order to refund\"},\"amount\":{\"type\":[\"number\",\"null\"],\"description\":\"Amount to refund. Omit to refund the full order.\",\"minimum\":0}},\"required\":[\"orderId\",\"amount\"],\"additionalProperties\":false},\"strict\":true}",
    transformations:
      "[{\"code\":\"renamed-input-schema-to-parameters\",\"path\":\"inputSchema\",\"detail\":\"Emitted `inputSchema` as the OpenAI `parameters` field.\",\"lossy\":false},{\"code\":\"enabled-strict-mode\",\"path\":\"inputSchema\",\"detail\":\"Emitted `strict: true` so OpenAI enforces the schema instead of best-effort matching.\",\"lossy\":false},{\"code\":\"converted-optional-property-to-nullable\",\"path\":\"inputSchema.properties.amount\",\"detail\":\"Made `amount` required and added `\\\"null\\\"` to its type; strict mode has no optional properties.\",\"lossy\":false},{\"code\":\"added-additional-properties-false\",\"path\":\"inputSchema.additionalProperties\",\"detail\":\"Added `additionalProperties: false`, which strict mode requires on every object.\",\"lossy\":false}]",
    diagnosticCodes: ["openai/nullable-instead-of-omitted"],
    okWithoutAllowLossy: true,
  },
  schedule_job: {
    output:
      "{\"type\":\"function\",\"name\":\"schedule_job\",\"description\":\"Schedules a background job\",\"parameters\":{\"type\":\"object\",\"properties\":{\"jobId\":{\"type\":\"string\",\"pattern\":\"^job_[a-z0-9]+$\"},\"runEvery\":{\"type\":\"integer\",\"multipleOf\":60,\"minimum\":60,\"maximum\":86400},\"window\":{\"type\":[\"array\",\"null\"],\"minItems\":2,\"maxItems\":2,\"items\":{\"type\":\"string\"}}},\"required\":[\"jobId\",\"runEvery\",\"window\"],\"additionalProperties\":false},\"strict\":true}",
    transformations:
      "[{\"code\":\"renamed-input-schema-to-parameters\",\"path\":\"inputSchema\",\"detail\":\"Emitted `inputSchema` as the OpenAI `parameters` field.\",\"lossy\":false},{\"code\":\"enabled-strict-mode\",\"path\":\"inputSchema\",\"detail\":\"Emitted `strict: true` so OpenAI enforces the schema instead of best-effort matching.\",\"lossy\":false},{\"code\":\"dropped-undocumented-constraint-keyword\",\"path\":\"inputSchema.properties.jobId.minLength\",\"detail\":\"Dropped `minLength`; OpenAI does not list it as supported and SchemaPort could not confirm it is enforced.\",\"lossy\":true},{\"code\":\"converted-optional-property-to-nullable\",\"path\":\"inputSchema.properties.window\",\"detail\":\"Made `window` required and added `\\\"null\\\"` to its type; strict mode has no optional properties.\",\"lossy\":false},{\"code\":\"added-additional-properties-false\",\"path\":\"inputSchema.additionalProperties\",\"detail\":\"Added `additionalProperties: false`, which strict mode requires on every object.\",\"lossy\":false}]",
    diagnosticCodes: ["openai/nullable-instead-of-omitted"],
    okWithoutAllowLossy: false,
  },
  set_limit: {
    output:
      "{\"type\":\"function\",\"name\":\"set_limit\",\"description\":\"Sets a numeric limit or removes it\",\"parameters\":{\"type\":\"object\",\"properties\":{\"limit\":{\"anyOf\":[{\"type\":\"number\",\"minimum\":1},{\"type\":\"null\"}]}},\"required\":[\"limit\"],\"additionalProperties\":false},\"strict\":true}",
    transformations:
      "[{\"code\":\"renamed-input-schema-to-parameters\",\"path\":\"inputSchema\",\"detail\":\"Emitted `inputSchema` as the OpenAI `parameters` field.\",\"lossy\":false},{\"code\":\"enabled-strict-mode\",\"path\":\"inputSchema\",\"detail\":\"Emitted `strict: true` so OpenAI enforces the schema instead of best-effort matching.\",\"lossy\":false},{\"code\":\"added-additional-properties-false\",\"path\":\"inputSchema.additionalProperties\",\"detail\":\"Added `additionalProperties: false`, which strict mode requires on every object.\",\"lossy\":false}]",
    diagnosticCodes: [],
    okWithoutAllowLossy: true,
  },
  tag_resource: {
    output:
      "{\"type\":\"function\",\"name\":\"tag_resource\",\"description\":\"Attaches arbitrary string tags to a resource\",\"parameters\":{\"type\":\"object\",\"properties\":{\"resourceId\":{\"type\":\"string\"},\"tags\":{\"type\":\"object\",\"properties\":{},\"required\":[],\"additionalProperties\":false}},\"required\":[\"resourceId\",\"tags\"],\"additionalProperties\":false},\"strict\":true}",
    transformations:
      "[{\"code\":\"renamed-input-schema-to-parameters\",\"path\":\"inputSchema\",\"detail\":\"Emitted `inputSchema` as the OpenAI `parameters` field.\",\"lossy\":false},{\"code\":\"enabled-strict-mode\",\"path\":\"inputSchema\",\"detail\":\"Emitted `strict: true` so OpenAI enforces the schema instead of best-effort matching.\",\"lossy\":false},{\"code\":\"dropped-additional-properties-schema\",\"path\":\"inputSchema.properties.tags.additionalProperties\",\"detail\":\"Replaced the `additionalProperties` value schema with `false`; the open typed map is gone.\",\"lossy\":true},{\"code\":\"added-additional-properties-false\",\"path\":\"inputSchema.additionalProperties\",\"detail\":\"Added `additionalProperties: false`, which strict mode requires on every object.\",\"lossy\":false}]",
    diagnosticCodes: [],
    okWithoutAllowLossy: false,
  },
});
