# OpenAI support

`rulesReviewedAt`: **2026-08-20**

Every rule in this package was derived from the official OpenAI documentation
listed at the bottom of this page, plus the type declarations shipped in
`openai@7.5.0`. Nothing here comes from memory or third-party write-ups, and
where the official docs are ambiguous this package says so instead of guessing.

## The API surfaces this package targets

SchemaPort compiles to either OpenAI function-tool envelope, always with
`strict: true`. The surface is chosen per call with `apiSurface`, and defaults
to `'responses'`.

```ts
compile(tool);                                    // Responses (default)
compile(tool, { apiSurface: 'responses' });       // the same thing, explicitly
compile(tool, { apiSurface: 'chat-completions' });
```

### Responses — `POST /v1/responses`, `tools[]`

```jsonc
{
  "type": "function",
  "name": "refund_order",
  "description": "Refunds all or part of an order",
  "parameters": { "type": "object", "...": "..." },
  "strict": true
}
```

This is the shape declared by `openai@7.5.0` in
`resources/responses/responses.d.ts`:

```ts
export interface FunctionTool {
  name: string;
  parameters: { [key: string]: unknown } | null;
  strict: boolean | null;
  type: 'function';
  description?: string | null;
  // ...plus optional fields SchemaPort does not emit
}
```

### Chat Completions — `POST /v1/chat/completions`, `tools[]`

```jsonc
{
  "type": "function",
  "function": {
    "name": "refund_order",
    "description": "Refunds all or part of an order",
    "parameters": { "type": "object", "...": "..." },
    "strict": true
  }
}
```

Declared by `openai@7.5.0` in `resources/chat/completions/completions.d.ts` and
`resources/shared.d.ts`:

```ts
export interface ChatCompletionFunctionTool {
  function: Shared.FunctionDefinition;
  type: 'function';
}

export interface FunctionDefinition {
  name: string;
  description?: string;
  parameters?: FunctionParameters;   // { [key: string]: unknown }
  strict?: boolean | null;
}
```

**Note where `strict` lives.** On the Responses tool it is a top-level sibling
of `name` and `parameters`. On the Chat Completions tool it is *inside*
`function`. This is the trap that makes the two bodies worth distinguishing in
code rather than by hand.

### Which surface to choose, and why

Pick the one matching the endpoint you call. That is the whole decision — the
schema does not change either way.

| | Responses | Chat Completions |
|---|---|---|
| Endpoint | `POST /v1/responses` | `POST /v1/chat/completions` |
| Envelope | flat | nested under `function` |
| `strict` | top level | inside `function` |
| Prompt field | `input` | `messages` |
| Output cap | `max_output_tokens` | `max_completion_tokens` |
| `tool_choice` | `{ type, name }` | `{ type, function: { name } }` |
| Schema rules | identical | identical |

- **New integrations: Responses.** OpenAI's function-calling guide points new
  integrations there, and it is this package's default.
- **Existing Chat Completions code: Chat Completions.** It remains widely used,
  and reshaping SchemaPort's output by hand is exactly the manual step this
  package exists to remove.
- **Strict-mode defaults differ, and SchemaPort does not rely on either.** The
  guide states that Responses requests "will attempt to normalize your schema
  into strict mode when possible, and will fall back to non-strict, best-effort
  function calling", while "Chat Completions requests remain non-strict by
  default". SchemaPort emits `strict: true` explicitly on both.

#### The two request bodies are still not interchangeable

Nothing about the new option makes them so. Chat Completions nests the function
under a `function` key whereas the Responses tool is flat, so pasting one into
the other endpoint fails — and on Chat Completions a top-level `strict` is not
the strict flag at all, so the more likely outcome than a clean error is a
schema that silently goes unenforced. That is why `apiSurface` is a named
choice rather than something inferred.

#### What choosing a surface does not change

The `parameters` schema is byte-identical between the two. Everything this
package decides about a schema — which keywords survive, which drops are lossy,
which diagnostics fire, whether compilation is refused — is a property of
OpenAI's strict-mode structured-outputs subset, not of the endpoint. The schema
pipeline runs once and only the final wrapping differs (`src/surface.ts`), so:

- Choosing Chat Completions does not rescue a schema that Responses refused.
- It does not preserve `minLength`, or any other dropped keyword.
- It does not make anything more, or less, lossy.

The only trace it leaves in a compile result, besides the shape of `output`, is
one extra non-lossy transformation: `nested-under-function-key`.

### Why `strict: true`, always

OpenAI's own guidance is to always enable strict mode, because it "will ensure
function calls reliably adhere to the function schema, instead of being best
effort". SchemaPort's entire purpose is to tell you which constraints a provider
actually enforces; compiling to non-strict mode would mean *no* constraint is
enforced, and every keyword would silently become decorative.

The trade-off is real and is the source of most lossy compiles: strict mode
accepts only a subset of JSON Schema, so keywords outside that subset have to be
dropped, and SchemaPort marks each drop as lossy rather than hiding it.

## The supported JSON Schema subset

Compilation uses an **allowlist**. Only keywords OpenAI documents as supported
are emitted; everything else is dropped and recorded.

| Slot | Emitted verbatim |
|---|---|
| Structure | `type`, `description`, `enum`, `properties`, `required`, `additionalProperties`, `items`, `anyOf`, `$ref`, `$defs` |
| Strings | `pattern`, `format` |
| Numbers | `multipleOf`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum` |
| Arrays | `minItems`, `maxItems` |

Supported `format` values: `date-time`, `time`, `date`, `duration`, `email`,
`hostname`, `ipv4`, `ipv6`, `uuid`. Any other value is dropped (lossy).

`$defs` and `$ref` — including recursive references — are supported by OpenAI and
are passed through untouched.

### Strict-mode requirements

1. The root schema must be an object, and may not use `anyOf`.
2. Every object must set `additionalProperties: false`.
3. Every key of `properties` must appear in `required`.
4. An optional field is expressed by adding `"null"` to its type union, e.g.
   `"type": ["string", "null"]`.

Compilation applies 2–4 automatically. 1 is refused, because inventing a wrapper
object or collapsing a root union would change the tool's meaning.

### Documented size limits

| Limit | Value | Diagnostic |
|---|---|---|
| Total object properties | 5000 | `openai/too-many-properties`; `openai/property-count-near-limit` warns above 90% |
| Nesting depth | 11 levels | `openai/schema-too-deep`; `openai/schema-nesting-near-limit` warns at 10–11 |
| Total enum values | 1000 | `openai/too-many-enum-values`; `openai/enum-values-near-limit` warns above 90% |
| String length of an enum with >250 values | 15,000 chars | `openai/large-enum-too-long` |
| Total chars across property names, definition names and enum values | 120,000 | `openai/schema-too-large`; `openai/schema-size-near-limit` warns above 90% |

Depth is counted with the root schema as level 1, descending through
`properties`, `items`, `anyOf`/`oneOf`/`allOf`/`prefixItems`, `$defs`,
`definitions`, `not` and a schema-valued `additionalProperties` — the size
rules measure the schema as submitted, which is a wider walk than the one the
compatibility rules use (see [rules.md](./rules.md#where-check-does-not-descend)).

### Tool name

`Must be a-z, A-Z, 0-9, or contain underscores and dashes, with a maximum length
of 64` — the Chat Completions API reference, `tools[].function.name`. This is the
only official page that states the constraint; the Responses reference does not
repeat it, but the same name field is used by both APIs.

## Two tiers of "unsupported"

The structured outputs guide is internally inconsistent about string-length
keywords, and this package does not paper over it.

**Tier 1 — named as unsupported.** The guide says verbatim:
"Composition: `allOf`, `not`, `dependentRequired`, `dependentSchemas`, `if`,
`then`, `else`". Dropping these produces `openai/unsupported-keyword`.

**Tier 2 — merely absent from the supported list.** `minLength`, `maxLength`,
`minProperties`, `maxProperties`, `patternProperties`, `propertyNames`,
`uniqueItems`, `prefixItems`, `contains`, `minContains`, `maxContains`,
`unevaluatedProperties`, `unevaluatedItems`.

The guide's "Supported `string` properties" list contains only `pattern` and
`format`, which implies `minLength`/`maxLength` are not supported. But a later
paragraph says fine-tuned models *additionally* do not support `minLength`,
`maxLength`, `pattern`, `format` and the numeric bounds — which reads as though
non-fine-tuned models do support them. OpenAI does not resolve the contradiction
anywhere we could find.

SchemaPort takes the conservative branch: these keywords are dropped and the
drop is `lossy: true`, so you are never told a constraint is enforced when it
might not be. The diagnostic (`openai/undocumented-constraint-keyword`) states
plainly that SchemaPort could not confirm the behaviour, rather than asserting
OpenAI rejects it.

A static rule made under uncertainty is not the end of the story. `schemaport
probe --targets openai` settles it against the live API — see
[probing.md](./probing.md#resolving-a-tier-2-drop-with-probe).

**Unknown keywords** — anything not in any of these lists, including vendor
extensions such as `x-internal-tag` — are dropped and treated as lossy too
(`openai/unknown-keyword`). SchemaPort cannot tell whether an unfamiliar keyword
constrains values, so it refuses to guess in the permissive direction.

## Official sources

| Title | URL |
|---|---|
| Function calling | https://developers.openai.com/api/docs/guides/function-calling |
| Structured model outputs — supported schemas | https://developers.openai.com/api/docs/guides/structured-outputs |
| API reference — `POST /v1/responses` | https://developers.openai.com/api/docs/api-reference/responses/create |
| API reference — `POST /v1/chat/completions` (function name rules) | https://developers.openai.com/api/docs/api-reference/chat/create |
| Models — `gpt-5.6-luna` | https://developers.openai.com/api/docs/models/gpt-5.6-luna |
| Deprecations | https://developers.openai.com/api/docs/deprecations |

Local ground truth: `openai@7.5.0`, `resources/responses/responses.d.ts` and
`resources/chat/completions/completions.d.ts`.

These are also exported as `openaiProvider.docs`.
