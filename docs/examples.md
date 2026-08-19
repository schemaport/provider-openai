# Examples

All output below is copied from actual runs of this package against the shared
fixtures in `@schemaport/core`.

## 1. An optional property — compiles, with a warning

Canonical (`refundOrderTool`):

```json
{
  "name": "refund_order",
  "description": "Refunds all or part of an order",
  "inputSchema": {
    "type": "object",
    "properties": {
      "orderId": { "type": "string", "description": "The order to refund" },
      "amount": {
        "type": "number",
        "minimum": 0,
        "description": "Amount to refund. Omit to refund the full order."
      }
    },
    "required": ["orderId"]
  }
}
```

```ts
const result = openaiProvider.compile(refundOrderTool);
// result.ok === true, no --allow-lossy needed
```

Output:

```json
{
  "type": "function",
  "name": "refund_order",
  "description": "Refunds all or part of an order",
  "parameters": {
    "type": "object",
    "properties": {
      "orderId": { "type": "string", "description": "The order to refund" },
      "amount": {
        "type": ["number", "null"],
        "description": "Amount to refund. Omit to refund the full order.",
        "minimum": 0
      }
    },
    "required": ["orderId", "amount"],
    "additionalProperties": false
  },
  "strict": true
}
```

`minimum: 0` survives — OpenAI documents it as supported. Transformations:

| Code | Path | Lossy |
|---|---|---|
| `renamed-input-schema-to-parameters` | `inputSchema` | no |
| `enabled-strict-mode` | `inputSchema` | no |
| `converted-optional-property-to-nullable` | `inputSchema.properties.amount` | no |
| `added-additional-properties-false` | `inputSchema.additionalProperties` | no |

And the compile result still carries one warning:

```json
{
  "severity": "warning",
  "code": "openai/strict-optional-property",
  "message": "Optional property `amount` cannot stay optional in OpenAI strict mode. It is emitted as required and nullable, so the model may send `amount: null` where the canonical schema expected the key to be omitted.",
  "path": "inputSchema.properties.amount",
  "compile": {
    "supported": true,
    "lossy": false,
    "detail": "Emits `amount` as required with `null` added to its type."
  },
  "docsUrl": "https://developers.openai.com/api/docs/guides/function-calling"
}
```

That warning is the point. `refund_order` compiles cleanly, but your handler now
has to treat `amount: null` as "no amount given".

## 2. An open typed map — refused

Canonical (`openMapTool`): `tags` is
`{ "type": "object", "additionalProperties": { "type": "string" } }`.

```ts
const result = openaiProvider.compile(openMapTool);
// result.ok === false, result.output === undefined
```

```json
{
  "severity": "error",
  "code": "core/lossy-transformation-refused",
  "message": "Compiling for openai would weaken this schema: dropped-additional-properties-schema at inputSchema.properties.tags.additionalProperties. Re-run with --allow-lossy to accept the weaker output."
}
```

Strict mode requires `additionalProperties: false`, so the string map cannot be
expressed at all. With `{ allowLossy: true }` it compiles to a `tags` object
that accepts no keys whatsoever — usually a sign the tool should take an array
of `{ key, value }` pairs instead.

## 3. Draft-07 `definitions` — rewritten, nothing lost

```json
{
  "type": "object",
  "definitions": {
    "Money": {
      "type": "object",
      "properties": { "cents": { "type": "integer" } },
      "required": ["cents"],
      "additionalProperties": false
    }
  },
  "properties": { "total": { "$ref": "#/definitions/Money" } },
  "required": ["total"],
  "additionalProperties": false
}
```

compiles to

```json
{
  "type": "object",
  "properties": { "total": { "$ref": "#/$defs/Money" } },
  "required": ["total"],
  "additionalProperties": false,
  "$defs": {
    "Money": {
      "type": "object",
      "properties": { "cents": { "type": "integer" } },
      "required": ["cents"],
      "additionalProperties": false
    }
  }
}
```

with `renamed-definitions-to-defs` and `rewrote-definitions-reference`, both
`lossy: false`, plus an `openai/legacy-definitions-keyword` warning.

## 4. Checking without compiling

```ts
import { openaiProvider } from '@schemaport/provider-openai';

for (const item of openaiProvider.check(tool)) {
  console.log(`${item.severity} ${item.code} at ${item.path}`);
  console.log(`  ${item.message}`);
  console.log(`  compile: ${item.compile.detail}`);
  if (item.docsUrl) console.log(`  ${item.docsUrl}`);
}
```

Diagnostics are sorted by severity, then path, then code, so the output is
stable between runs.

## 5. Probing

```bash
export OPENAI_API_KEY=sk-...
schemaport probe --target openai tools/refund_order.json
```

See [probing.md](./probing.md) for the request that is sent, the default model
and how every failure mode is classified.
