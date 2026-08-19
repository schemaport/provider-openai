# Transformations

Every change `compile()` makes is recorded as a `Transformation` with a stable
kebab-case code, the canonical path it applied at, a one-line detail and a
`lossy` flag.

`lossy: true` means the compiled schema **accepts arguments the canonical schema
rejects**, because a constraint was dropped or weakened. Any lossy
transformation makes `compile()` return `ok: false` unless the caller passes
`allowLossy` (`--allow-lossy` on the CLI).

Narrowing is not lossy. Closing an object accepts *fewer* values than the
canonical schema, so it does not trip the gate — but where a narrowing changes
what the model emits at runtime, `check()` still raises a warning that survives
into the compile result.

## Not lossy

| Code | `lossy` | What it does |
|---|---|---|
| `renamed-input-schema-to-parameters` | `false` | Emits the canonical `inputSchema` as OpenAI's `parameters` field. Always applied. |
| `enabled-strict-mode` | `false` | Emits `strict: true`. Always applied. See [openai-support.md](./openai-support.md#why-strict-true-always). |
| `converted-optional-property-to-nullable` | `false` | Adds the property to `required` and adds `"null"` to its type union. The value set gains `null`, but no canonical constraint stops being enforced. **Always accompanied by an `openai/strict-optional-property` warning.** |
| `added-additional-properties-false` | `false` | Adds `additionalProperties: false` where the canonical schema said nothing. |
| `closed-open-object` | `false` | Replaces `additionalProperties: true` with `false`. Accompanied by an `openai/additional-properties-true` warning. |
| `dropped-annotation-keyword` | `false` | Drops a keyword that annotates but does not constrain (`title`, `examples`, `$comment`, `$schema`, `$id`, `$anchor`, `deprecated`, `readOnly`, `writeOnly`, `nullable: false`). |
| `dropped-default-keyword` | `false` | Drops `default`. Accepted values are unchanged; accompanied by an `openai/default-keyword-dropped` warning because the model loses the hint. |
| `converted-const-to-enum` | `false` | Emits `const: X` as `enum: [X]`, which accepts exactly the same value. |
| `renamed-definitions-to-defs` | `false` | Renames draft-07 `definitions` to `$defs`. |
| `rewrote-definitions-reference` | `false` | Repoints a `#/definitions/...` `$ref` at `#/$defs/...`. |
| `converted-nullable-to-type-union` | `false` | Replaces OpenAPI 3.0 `nullable: true` with `"null"` in the type union. |

## Lossy

| Code | `lossy` | What it does and what is lost |
|---|---|---|
| `dropped-unsupported-keyword` | **`true`** | Drops a keyword OpenAI names as unsupported (`allOf`, `not`, `dependentRequired`, `dependentSchemas`, `if`, `then`, `else`), or a `definitions` map that collides with an existing `$defs`. The constraint is no longer enforced anywhere. |
| `dropped-undocumented-constraint-keyword` | **`true`** | Drops a constraining keyword absent from OpenAI's supported list (`minLength`, `maxLength`, `uniqueItems`, `prefixItems`, `minProperties`, `maxProperties`, `patternProperties`, `propertyNames`, `contains`, `minContains`, `maxContains`, `unevaluatedProperties`, `unevaluatedItems`). SchemaPort could not confirm whether OpenAI would have enforced it, and refuses to emit it unverified. |
| `dropped-unknown-keyword` | **`true`** | Drops a keyword SchemaPort does not recognise. Classified lossy because assuming an unknown keyword is decorative would be the unsafe guess. |
| `dropped-unsupported-format` | **`true`** | Drops a `format` value outside OpenAI's supported nine. `format: "uri"` was load-bearing; after the drop any string is accepted. |
| `dropped-additional-properties-schema` | **`true`** | Replaces an `additionalProperties` value schema with `false`. An open typed map such as `{ "additionalProperties": { "type": "string" } }` becomes an object that accepts no extra keys at all — the map is gone, not just untyped. |
| `converted-one-of-to-any-of` | **`true`** | Emits `oneOf` branches as `anyOf`. Values matching more than one branch are now accepted; `oneOf` rejected them. |

## Determinism

Compiling the same canonical tool twice produces byte-identical output and the
same transformation array in the same order. Compiled schema keys are written in
a fixed order (`$ref`, `type`, `description`, `enum`, `pattern`, `format`,
`multipleOf`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`,
`minItems`, `maxItems`, `items`, `properties`, `required`,
`additionalProperties`, `anyOf`, `$defs`), so the output does not depend on key
order in the source file either. `required` lists property names in
`properties` insertion order.

There are no timestamps, no `Date.now()`, no `Math.random()` and no iteration
over unordered collections anywhere in this package.
