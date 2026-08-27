# Known limitations

Things this package does not do, or does in a way you should know about.

## Behaviour SchemaPort could not confirm

**String-length and other tier-2 keywords.** OpenAI's structured outputs guide
lists only `pattern` and `format` as supported string properties, but a later
paragraph implies non-fine-tuned models *do* support `minLength` and
`maxLength`. The contradiction is unresolved in the official docs. SchemaPort
drops these keywords and marks the drop lossy, and the
`openai/undocumented-constraint-keyword` diagnostic says explicitly that the
behaviour is unconfirmed. It does **not** claim OpenAI rejects them. See
[openai-support.md](./openai-support.md#two-tiers-of-unsupported).

Practical consequence: two of the shared `@schemaport/core` fixtures
(`create_ticket`, `schedule_job`) need `--allow-lossy` because of this rule
alone.

**This is resolvable, not permanent.** `schemaport probe --targets openai` with
a real key answers what OpenAI actually does with your schema today, and
[probing.md](./probing.md#resolving-a-tier-2-drop-with-probe) explains how to
read the result and how to feed a correction back into the tier assignment.

## The optional-property encoding is not self-consistent JSON Schema

OpenAI's documented encoding for an optional enum property is:

```json
{ "type": ["string", "null"], "enum": ["celsius", "fahrenheit"] }
```

`null` is in the type union but not in the `enum`, so no value satisfies both
keywords under a standard JSON Schema validator. SchemaPort emits exactly what
OpenAI documents rather than "fixing" it by adding `null` to the enum, because
the documented form is what the API validates against. If you feed SchemaPort's
compiled output to a general-purpose JSON Schema validator, expect it to
disagree.

Separately, `{"amount": null}` and "`amount` omitted" are different values. A
canonical schema that distinguishes them cannot survive strict mode intact; the
`openai/strict-optional-property` warning exists to say so on every compile.

## Boolean subschemas are a hard stop, by design

JSON Schema lets `true` or `false` stand in for a whole subschema. OpenAI's
supported subset has no equivalent, so compile must emit `{}`.

For `true` that is free — both accept everything. For `false` it is the single
worst thing SchemaPort could do quietly: `false` accepts *nothing*, `{}` accepts
*anything*. So `false` in any of `properties`, `items`, `$defs`, `definitions`,
`prefixItems`, `anyOf`, `oneOf`, `allOf` or `not` raises
`openai/boolean-subschema` as an **error**, records a **`lossy: true`**
transformation (`widened-false-subschema`), and refuses to compile without
`--allow-lossy`. A value that is not a schema at all gets the same treatment
under `openai/non-schema-subschema`.

`additionalProperties` is exempt — a boolean is its normal form there and the
`additional-properties-*` rules already own it.

**This is defence in depth.** `validateCanonicalTool` in `@schemaport/core`
rejects boolean subschemas outright, so a tool loaded through the CLI never
reaches this code. The adapter is a public API that can be called directly, and
the guarantee that SchemaPort never weakens a schema silently has to hold on
that path too. If you are calling `compile()` directly on a schema you did not
validate first, this rule is what stands between you and a silently broken
contract.

There is no way to express "accept nothing" for OpenAI. If a `false` subschema
was load-bearing, remove the property instead.

## Objects with no declared properties

`{"type": "object"}` with no `properties` compiles to
`{"type":"object","properties":{},"required":[],"additionalProperties":false}` —
an object that accepts nothing but `{}`. Strict mode has no way to express "any
object". This is a narrowing, so it is not classified lossy, and the
`openai/object-missing-additional-properties` diagnostic is the only signal.
If you need a free-form object, strict mode is not going to give you one.

## `$ref` and `definitions`

- `$defs` and `$ref`, including recursive references, are passed through
  untouched. SchemaPort does not inline them.
- The draft-07 `definitions` keyword is renamed to `$defs`, and `$ref` values
  that begin with `#/definitions/` are repointed. Only that exact prefix is
  rewritten — a `$ref` reaching a nested `definitions` map by some other path,
  or an external `$ref` to another document, is left alone and will not resolve.
- If a schema has both `definitions` and `$defs`, SchemaPort refuses to merge
  them: `definitions` is dropped as a lossy transformation
  (`openai/conflicting-definitions-keywords`). This is a SchemaPort limitation,
  not an OpenAI restriction.
- Probing a schema containing `$ref` will report that the returned arguments
  could not be verified — `validateValue` in `@schemaport/core` does not resolve
  references.

## Tool names are never rewritten

A name outside `a-z A-Z 0-9 _ -`, or longer than 64 characters, refuses to
compile. Sanitising it would change the identifier your dispatch code matches
on, and SchemaPort will not silently rename your tool. Rename it yourself.

## `compile()` assumes a structurally valid canonical tool

`compile()` sets `required` to every key of `properties`. A canonical schema
whose `required` array names a property that does not exist in `properties` will
have that entry silently discarded, with no `Transformation` recorded. Run
`validateCanonicalTool` from `@schemaport/core` first — the CLI does this during
loading.

## Chat Completions is an opt-in output target, and only the envelope differs

`compile(tool, { apiSurface: 'chat-completions' })` emits the nested
`{ type, function: { name, description, parameters, strict } }` shape, and
`probe(tool, { apiSurface: 'chat-completions' })` sends it to
`POST /v1/chat/completions`. The default is still `'responses'`.

Be clear about what this does **not** buy you. The option changes the wrapper
and nothing else:

- The same keywords survive. `minLength` is still dropped on both surfaces,
  and so is every other tier-1, tier-2 and unknown keyword.
- The same things are lossy. A tool that needs `--allow-lossy` for Responses
  needs it for Chat Completions, and vice versa. Switching surfaces is never a
  way around a refusal.
- The same diagnostics are reported, with the same severities and paths.
- The same strict-mode requirements apply — closed objects, everything in
  `required`, optional properties encoded as `"null"` in the type union.

The only differences you will see in a compile result are the shape of `output`
and one extra non-lossy `nested-under-function-key` transformation. See
[openai-support.md](./openai-support.md#which-surface-to-choose-and-why).

## Scope

- Only `type: 'function'` tools. Custom tools (`type: 'custom'`), MCP tools,
  file search, web search and the rest of the Responses tool union are out of
  scope.
- `output_schema`, `allowed_callers` and `defer_loading` on `FunctionTool` are
  not emitted; the canonical format has no equivalent.
- `check()` deduplicates by subschema object identity, so a schema object shared
  by reference at two paths is reported once, at the first path reached.
