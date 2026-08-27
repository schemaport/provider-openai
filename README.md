# @schemaport/provider-openai

OpenAI tool-schema compatibility checks, compilation and live probing for
[SchemaPort](https://github.com/schemaport).

Define a tool schema once; this package tells you what OpenAI will and will not
enforce, compiles it to a ready-to-send Responses API function tool, and refuses
to weaken it behind your back.

**Rules reviewed against official OpenAI documentation on 2026-08-20.**
Every source URL is listed in [docs/openai-support.md](./docs/openai-support.md)
and exported as `openaiProvider.docs`.

## Install

```bash
npm install @schemaport/provider-openai
```

## Use

```ts
import { openaiProvider } from '@schemaport/provider-openai';

const tool = {
  name: 'refund_order',
  description: 'Refunds all or part of an order',
  inputSchema: {
    type: 'object',
    properties: {
      orderId: { type: 'string' },
      amount: { type: 'number', minimum: 0 },
    },
    required: ['orderId'],
  },
};

openaiProvider.check(tool);
// [ warning openai/strict-optional-property at inputSchema.properties.amount ]

const result = openaiProvider.compile(tool);
// result.ok === true
// result.output -> a Responses API FunctionTool, strict: true
// result.diagnostics still carries the warning above
```

```ts
const tools = [result.output];
await client.responses.create({ model, input, tools });
```

## What it does

- **`check(tool)`** — 30 compatibility rules, each with a stable `openai/…` code,
  a precise path, a documentation URL and an honest statement of what `compile()`
  will do about it. See [docs/rules.md](./docs/rules.md).
- **`compile(tool, options)`** — emits the Responses API `FunctionTool` shape
  with `strict: true`, or the Chat Completions shape with
  `{ apiSurface: 'chat-completions' }`, recording every change as a
  `Transformation`. Changes that widen the accepted value set are marked `lossy`
  and refuse to compile without `allowLossy`. See
  [docs/transformations.md](./docs/transformations.md).
- **`probe(tool, options)`** — sends one minimal request, to whichever surface
  you selected, and reports whether OpenAI accepted the schema, distinguishing a
  real rejection from a missing key, a stale model id or a network failure. See
  [docs/probing.md](./docs/probing.md).

## The target surface

Two, both always with `strict: true` — the only mode in which OpenAI actually
enforces the schema.

The default is the **Responses API** function tool (`POST /v1/responses`,
`tools[]`), a flat `{ type, name, description, parameters, strict }`. Pass
`apiSurface` for the **Chat Completions** form instead:

```ts
const result = openaiProvider.compile(tool, { apiSurface: 'chat-completions' });
// result.output -> { type: 'function', function: { name, description, parameters, strict: true } }

await client.chat.completions.create({ model, messages, tools: [result.output] });
```

Note that `strict` moves *inside* `function` on that surface. The two request
bodies are not interchangeable, which is why the surface is named rather than
inferred.

**Choosing a surface changes the envelope and nothing else.** Same strict-mode
requirements, same supported keywords, same transformations on `parameters`,
same diagnostics, same refusals. It will not rescue a schema that the other
surface refused, and it does not make anything more or less lossy. Which to
pick, and the exact shapes as declared by `openai@7.5.0`, are in
[docs/openai-support.md](./docs/openai-support.md#which-surface-to-choose-and-why).

## The lossy rule

A transformation is `lossy` when the compiled schema **accepts arguments the
canonical schema rejects**. Those refuse to compile unless you opt in:

```ts
openaiProvider.compile(tool);                      // ok: false, nothing emitted
openaiProvider.compile(tool, { allowLossy: true }); // ok: true, you've been told
```

Narrowing — closing an object, making an optional property required-and-nullable
— is not lossy, but it is never silent. Where OpenAI rejects the canonical schema
*as written*, `check()` raises an **error** so a CI run gated on errors fails.
Where compilation changes what the model emits *at runtime*, a separate
**warning survives into the compile result**. "Compiles with zero warnings" is
only ever printed when OpenAI genuinely preserves your contract.

## Honesty about uncertainty

OpenAI's structured outputs guide contradicts itself about `minLength` and
`maxLength`. This package takes the conservative branch — it drops them and marks
the drop lossy — but the diagnostic says outright that the behaviour could not be
confirmed rather than asserting OpenAI rejects them. The two evidence tiers have
separate diagnostic codes so you can tell them apart:
`openai/unsupported-keyword` (OpenAI names it as unsupported) versus
`openai/undocumented-constraint-keyword` (merely absent from the supported list).

And an uncertain static rule is not the last word: `schemaport probe --targets
openai` with a real key answers what OpenAI does with your schema today. See
[docs/probing.md](./docs/probing.md#resolving-a-tier-2-drop-with-probe).

## Probing

```bash
export OPENAI_API_KEY=sk-...
export SCHEMAPORT_OPENAI_MODEL=gpt-5.6-luna   # optional override

schemaport probe --targets openai tools/refund_order.json
```

Default model `gpt-5.6-luna`: the cheapest current model whose model page lists
`function_calling` and `structured_outputs`, and which is not on the deprecation
schedule. Details and the full error-classification table are in
[docs/probing.md](./docs/probing.md).

## Documentation

| Page | Contents |
|---|---|
| [docs/openai-support.md](./docs/openai-support.md) | Target API, strict mode, the supported JSON Schema subset, size limits, source URLs |
| [docs/rules.md](./docs/rules.md) | Every compatibility rule with its code and severity |
| [docs/transformations.md](./docs/transformations.md) | Every transformation with its lossy classification |
| [docs/limitations.md](./docs/limitations.md) | Known limitations and unconfirmed behaviour |
| [docs/probing.md](./docs/probing.md) | Probe setup, model selection, result classification |
| [docs/examples.md](./docs/examples.md) | Worked examples with real output |

## Development

```bash
npm run build
npm test
npm run lint
```

No test makes a network request; the probe SDK is driven through the
`options.client` seam.

## License

MIT
