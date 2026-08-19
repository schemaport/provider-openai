# Compatibility rules

Every rule `check()` implements, with its stable code. All 25 codes are prefixed
`openai/`, carry a `path` built with `joinPath` and a `docsUrl` pointing at the
official page the rule came from.

`compile` column reads: **fixes** = compile produces usable output and nothing is
lost; **fixes (lossy)** = compile produces usable output but a constraint is
dropped, so `--allow-lossy` is required; **refuses** = compile cannot produce
usable output at all.

## Tool identity

| Code | Severity | Compile | Fires when |
|---|---|---|---|
| `openai/tool-name-invalid-characters` | error | refuses | The name uses characters outside `a-z A-Z 0-9 _ -`. Compile will not rename the tool, because the name is the identifier your dispatch code matches on. |
| `openai/tool-name-too-long` | error | refuses | The name exceeds 64 characters. |
| `openai/missing-tool-description` | info | fixes | The tool has no description. OpenAI uses it to decide whether to call the function. |

## Root schema

| Code | Severity | Compile | Fires when |
|---|---|---|---|
| `openai/root-schema-not-object` | error | refuses | `inputSchema.type` is not exactly `object`. |
| `openai/root-schema-anyof` | error | refuses | The root schema uses `anyOf`, which OpenAI forbids at the root. |

## Size limits

All five refuse, because trimming a schema to fit a size limit would mean
deleting parts of the caller's contract.

| Code | Severity | Compile | Fires when |
|---|---|---|---|
| `openai/too-many-properties` | error | refuses | More than 5000 properties in total. |
| `openai/schema-too-deep` | error | refuses | More than 10 levels of nesting. |
| `openai/too-many-enum-values` | error | refuses | More than 1000 enum values across all properties. |
| `openai/large-enum-too-long` | error | refuses | An enum with more than 250 values whose string values total more than 15,000 characters. |
| `openai/schema-too-large` | error | refuses | Property names, definition names and enum values total more than 120,000 characters. |

## Objects

| Code | Severity | Compile | Fires when |
|---|---|---|---|
| `openai/strict-optional-property` | **warning** | fixes | A property is absent from `required`. Compile makes it required and adds `"null"` to its type. |
| `openai/object-missing-additional-properties` | error | fixes | An object schema does not set `additionalProperties`. Compile adds `false`. |
| `openai/additional-properties-true` | **warning** | fixes | An object explicitly sets `additionalProperties: true`. Compile closes it. |
| `openai/additional-properties-schema` | error | fixes (lossy) | `additionalProperties` is a value schema (an open typed map). Strict mode cannot express it, so the map is erased. |

### Why `openai/strict-optional-property` is a warning, not an error

`finalizeCompile` removes `error` diagnostics that compile worked around. If
this rule were an `error`, a successful compile would report nothing — but the
compiled schema genuinely behaves differently at runtime: the model may emit
`{"amount": null}` where the canonical schema expected `amount` to be omitted.
The contract requires that behaviour change to survive into the compile result,
so the rule is a `warning`. The same reasoning applies to
`openai/additional-properties-true`.

## Keywords

| Code | Severity | Compile | Fires when |
|---|---|---|---|
| `openai/unsupported-keyword` | error | fixes (lossy) | A keyword OpenAI **names** as unsupported: `allOf`, `not`, `dependentRequired`, `dependentSchemas`, `if`, `then`, `else`. |
| `openai/conflicting-definitions-keywords` | error | fixes (lossy) | A schema carries both `definitions` and `$defs`. This is not an OpenAI restriction — SchemaPort refuses to merge the two maps, so `definitions` is dropped and any `#/definitions/...` reference will dangle. |
| `openai/undocumented-constraint-keyword` | error | fixes (lossy) | A constraining keyword absent from OpenAI's supported list but not named as unsupported: `minLength`, `maxLength`, `minProperties`, `maxProperties`, `patternProperties`, `propertyNames`, `uniqueItems`, `prefixItems`, `contains`, `minContains`, `maxContains`, `unevaluatedProperties`, `unevaluatedItems`. The message says explicitly that the behaviour is unconfirmed — see [openai-support.md](./openai-support.md#two-tiers-of-unsupported). |
| `openai/unknown-keyword` | error | fixes (lossy) | A keyword SchemaPort does not recognise at all, such as a vendor extension. Treated as constraining, because assuming otherwise would be the unsafe guess. |
| `openai/unsupported-string-format` | error | fixes (lossy) | `format` is set to a value outside OpenAI's list of nine supported formats. |
| `openai/one-of-converted-to-any-of` | error | fixes (lossy) | `oneOf` is used. OpenAI supports `anyOf` only, and `anyOf` accepts values matching more than one branch. |
| `openai/annotation-keyword-dropped` | info | fixes | A non-constraining annotation is dropped: `title`, `examples`, `$comment`, `$schema`, `$id`, `$anchor`, `deprecated`, `readOnly`, `writeOnly`. Also fires for `nullable: false`, which is equally decorative. |
| `openai/default-keyword-dropped` | **warning** | fixes | `default` is dropped. Nothing about accepted values changes, but the model no longer sees the default and will pick a value itself. |
| `openai/const-converted-to-enum` | info | fixes | `const` is emitted as a single-value `enum`, which accepts exactly the same value. |
| `openai/legacy-definitions-keyword` | **warning** | fixes | The draft-07 `definitions` keyword is used. Compile renames it to `$defs` and repoints `#/definitions/...` references. |
| `openai/nullable-keyword-converted` | **warning** | fixes | The OpenAPI 3.0 `nullable: true` keyword is used. Compile expresses it as a type union containing `"null"`. |

## Where check does not descend

`check()` walks only the subschemas that survive compilation: `properties`,
`items`, `anyOf`, `oneOf`, `$defs` and `definitions`. It deliberately does not
descend into `allOf`, `not`, `prefixItems`, `patternProperties`,
`if`/`then`/`else` or a schema-valued `additionalProperties`, because those
slots are dropped wholesale and are already reported at their parent. Reporting
rules about the interior of a branch that will not exist in the output would be
noise.

The **size-limit rules walk differently**, and deliberately so. `measureSchema`
descends into `allOf`, `prefixItems`, `not` and a schema-valued
`additionalProperties` as well, because OpenAI parses the schema you send before
it decides anything about it — a schema that busts the depth or property budget
does so on what was submitted, not on what SchemaPort would have kept.
