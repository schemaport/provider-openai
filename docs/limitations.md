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

## Chat Completions is not a supported output target

The compiled output is the Responses API tool shape. Chat Completions nests the
function under a `function` key. The `parameters` schema is identical, so you can
re-wrap it yourself, but this package does not emit that form and does not probe
against it.

## Scope

- Only `type: 'function'` tools. Custom tools (`type: 'custom'`), MCP tools,
  file search, web search and the rest of the Responses tool union are out of
  scope.
- `output_schema`, `allowed_callers` and `defer_loading` on `FunctionTool` are
  not emitted; the canonical format has no equivalent.
- `check()` deduplicates by subschema object identity, so a schema object shared
  by reference at two paths is reported once, at the first path reached.
