# Probing

A probe answers one question: **does OpenAI actually accept this compiled tool
definition?** It sends a single request and inspects the outcome. It never
executes your function and never sends real data.

## Setup

```bash
export OPENAI_API_KEY=sk-...          # required
export SCHEMAPORT_OPENAI_MODEL=...    # optional, overrides the default model
```

```bash
schemaport probe --target openai path/to/tool.json
```

Programmatically:

```ts
import { openaiProvider } from '@schemaport/provider-openai';

const result = await openaiProvider.probe(tool, {
  model: 'gpt-5.6-luna',   // optional
  apiKey: process.env.MY_KEY, // optional; falls back to OPENAI_API_KEY
  allowLossy: false,          // optional
  timeoutMs: 30_000,          // optional
});
```

Resolution order for the model is `options.model` → `SCHEMAPORT_OPENAI_MODEL` →
the default, via `resolveProbeModel`. For the key it is `options.apiKey` →
`OPENAI_API_KEY`, via `resolveApiKey`.

## The default model

`gpt-5.6-luna`.

It is the cheapest model on OpenAI's current pricing page that lists both
`function_calling` and `structured_outputs` under supported features
($0.20 / $1.20 per 1M input / output tokens).

`gpt-5-nano` is cheaper still ($0.05 / $0.40), but OpenAI's deprecations page
schedules `gpt-5-nano-2025-08-07` for shutdown on **2026-12-11** and names
`gpt-5.6-luna` as its replacement, so defaulting to it would break for everyone
in December. Sources: the [models page](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
and the [deprecations page](https://developers.openai.com/api/docs/deprecations),
both checked 2026-08-20.

If that model is retired, override it with `SCHEMAPORT_OPENAI_MODEL` rather than
waiting for a release.

## What gets sent

Exactly one `POST /v1/responses`:

```jsonc
{
  "model": "gpt-5.6-luna",
  "input": "<probePrompt(tool)>",
  "tools": [ /* the compiled FunctionTool */ ],
  "tool_choice": { "type": "function", "name": "<tool name>" },
  "max_output_tokens": 1024
}
```

- `probePrompt` comes from `@schemaport/core` and asks the model to call the
  tool once with plausible placeholder values.
- `tool_choice` is pinned so the model does not answer in prose.
- The output cap is 1024 tokens: enough that a reasoning model can still emit
  one forced tool call, small enough that a probe stays cheap.
- `timeoutMs` is passed to the SDK as the per-request `timeout`.

## Compile runs first

If compilation is refused — an unresolvable error, or a lossy transformation
without `allowLossy` — the probe returns `probeCompileRefused` and **no request
is sent**. SchemaPort never puts a schema on the wire that it has already
decided is unsafe.

## Result classification

| Outcome | `status` | `errorKind` | Meaning |
|---|---|---|---|
| Request succeeded | `accepted` | — | OpenAI accepted the schema. If a tool call came back, its arguments are validated against the **canonical** schema, so a constraint OpenAI silently ignored shows up as `argumentsValid: false`. |
| HTTP 400 / 422 | `rejected` | — | OpenAI refused the schema itself. This is the only outcome that means "bad schema". |
| No key found | `error` | `missing-credentials` | Set `OPENAI_API_KEY`. |
| HTTP 401 / 403 | `error` | `authentication` | Bad or expired key. |
| HTTP 404 | `error` | `model-not-found` | The model id does not exist or is not available to this key. |
| HTTP 429 | `error` | `rate-limit` | Throttled. |
| HTTP 5xx, connection failure, timeout | `error` | `network` | Never reached a verdict. |
| Compilation refused | `error` | `compile-refused` | Nothing was sent. |

Classification is done by `classifyProviderError` from `@schemaport/core`, using
the SDK error's HTTP status. A stale model id or an expired key is therefore
never reported as a schema rejection.

A response with no `function_call` item still counts as `accepted` — the schema
was accepted — but `toolCallReturned` is `false` and the notes say the argument
shape was not verified. If the model returns arguments that are not valid JSON,
the result is still `accepted` with a note, not a crash.

## Testing without a network

`options.client` is a test seam. When it is set, this package uses it and does
**not** construct an SDK client or read `process.env`:

```ts
const client = {
  responses: {
    create: async () => ({
      output: [
        { type: 'function_call', name: 'refund_order', arguments: '{"orderId":"o_1","amount":null}' },
      ],
    }),
  },
};

const result = await openaiProvider.probe(refundOrderTool, { client });
```

Every test in this repository drives a fake client this way. None makes a
network request.
