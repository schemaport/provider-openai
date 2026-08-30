# Compatibility rules

Every rule `check()` implements, with its stable code. All 30 codes are prefixed
`openai/`, carry a `path` built with `joinPath` and a `docsUrl` pointing at the
official page the rule came from.

`compile` column reads: **fixes** = compile produces usable output and nothing is
lost; **fixes (lossy)** = compile produces usable output but a constraint is
dropped, so `--allow-lossy` is required; **refuses** = compile cannot produce
usable output at all.

## What "stable code" guarantees

The `code` on a diagnostic is this package's machine-readable interface. If you
filter, suppress, or gate CI on findings, filter on the code.

**Stable across releases:**

- The code string itself. A code is never renamed. If a rule's meaning changes
  enough that the old name would mislead, the old code is retired and a new one
  is introduced rather than quietly redefined.
- The `path`, which always points at the schema location the rule is about, and
  is always built with `joinPath` so it can be matched or split reliably.

**Not stable, and safe to change in any release:**

- The `message`. It is written for a human reading terminal output and gets
  reworded whenever a clearer phrasing turns up. Do not match on it.
- The `docsUrl`. Providers move their documentation; the link follows.
- The **set** of codes. New rules arrive in minor releases — that is how a
  provider's changing requirements reach you. Treat an unrecognised
  `openai/...` code as a finding you have not triaged yet, not as an error.

**Changes with the rule, and is worth watching:**

- `severity`, and the `compile` ability. A rule can move between `warning` and
  `error`, or stop being lossy, when the evidence for it changes. Both are
  recorded in `CHANGELOG.md` when they do, because a `--fail-on error` gate can
  start or stop failing as a result.

So this is the durable form of a CI filter:

```bash
schemaport check tools --targets openai --format json \
  | jq '[.tools[].targets.openai.diagnostics[]
         | select(.code == "openai/undocumented-constraint-keyword")]'
```

and this is the brittle form, which breaks on the next rewording:

```bash
schemaport check tools --targets openai | grep "could not confirm"
```

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

The five **exceeded-limit** rules all refuse, because trimming a schema to fit a
size limit would mean deleting parts of the caller's contract. Four further
**near-limit** rules fire *below* their ceiling and refuse nothing — see
[Every size limit warns before it fails](#every-size-limit-warns-before-it-fails).

| Code | Severity | Compile | Fires when |
|---|---|---|---|
| `openai/too-many-properties` | error | refuses | More than 5000 properties in total. |
| `openai/property-count-near-limit` | **warning** | fixes | Property count is above 90% of 5000 but does not exceed it. |
| `openai/schema-too-deep` | error | refuses | More than 11 levels of nesting. |
| `openai/schema-nesting-near-limit` | **warning** | fixes | Nesting reaches 10 or 11 levels — within one level of the limit of 11 — but does not exceed it. Advance warning: the schema is fine today, the next nested property is not. Never fires alongside `openai/schema-too-deep`. |
| `openai/too-many-enum-values` | error | refuses | More than 1000 enum values across all properties. |
| `openai/enum-values-near-limit` | **warning** | fixes | Enum-value count is above 90% of 1000 but does not exceed it. |
| `openai/large-enum-too-long` | error | refuses | An enum with more than 250 values whose string values total more than 15,000 characters. |
| `openai/schema-too-large` | error | refuses | Property names, definition names and enum values total more than 120,000 characters. |
| `openai/schema-size-near-limit` | **warning** | fixes | Total string length is above 90% of 120,000 but does not exceed it. |

### Every size limit warns before it fails

The three warnings above are the same idea as
`openai/schema-nesting-near-limit`, applied to the counting limits. A schema at
4900 of 5000 properties used to pass `check()` in silence, and the next property
added made OpenAI reject the tool with nothing in between.

Each fires above `SIZE_WARNING_FRACTION` of its limit and states the headroom
left:

```
⚠ Schema declares 4997 properties; OpenAI allows at most 5000. That leaves
  room for 3 more; beyond that OpenAI will reject the tool.
  Path: inputSchema
```

At exactly the limit the message says "There is no headroom left: any addition
will make OpenAI reject the tool."

**One finding per budget, never two.** Each warning is branched off its own
refusal, so a schema over the limit gets the error alone — a second finding
about the same number is noise.

`SIZE_WARNING_FRACTION` is `0.9`, and it is a judgement rather than a figure
OpenAI documents: high enough that an ordinary schema never trips it, low enough
to leave time to act. It is exported so it can be read rather than guessed at.

Nesting depth deliberately does **not** use the fraction. It keeps an absolute
threshold, because one level away from eleven is a meaningful amount of room,
whereas on a limit in the thousands "one away" is not actionable and a
proportion is. `openai/large-enum-too-long` has no near-limit warning either:
it is a conditional rule about one enum rather than a budget accumulating across
the schema, so there is no single number to be close to.

Like the depth warning, all three compile unchanged — `compile.supported` is
`true`, `compile.lossy` is `false`, there is no accompanying `Transformation`,
and `--allow-lossy` is irrelevant.

### Why nesting depth warns before it fails

OpenAI allows 11 levels of nesting and rejects the tool at 12. Without this rule
there is nothing between "fine" and "rejected": a schema at depth 10 or 11
passes `check()` in silence, and then the next nested property someone adds to
it turns a clean CI run into an API rejection, usually in a diff that has
nothing obviously to do with depth.

The four near-limit rules are the only **warnings** in this package that report
a schema OpenAI accepts as written and that compiles byte-for-byte unchanged.
They fit neither half of the usual taxonomy:

- they are **not** errors, because the schema *is* sendable — an error here
  would fail a CI run gated on errors for a tool OpenAI is perfectly happy with;
- they are **not** "compilation changed runtime behaviour" warnings either, in
  the way `openai/nullable-instead-of-omitted` and
  `openai/extra-properties-no-longer-accepted` are. Nothing changes. There is no
  accompanying `Transformation`, because compile does not touch the schema.

They are **warnings about the next change**, not about this one. For each,
`compile.supported` is `true` and `compile.lossy` is `false`, so
`finalizeCompile` never refuses because of one and `--allow-lossy` is
irrelevant; the warning simply survives into the compile result and the
manifest so the headroom is visible where the schema is reviewed.

**One finding per schema, never two.** Over the limit the warning is suppressed
and `openai/schema-too-deep` fires alone. Depth 9 → nothing; depth 10 and 11 →
the warning; depth 12 and beyond → the error. The message states the measured
depth, the limit, and the remaining headroom (one level at depth 10, none at
depth 11).

The margin is SchemaPort's own choice, not something OpenAI documents. It is
exported as `NESTING_DEPTH_WARNING_THRESHOLD` and **derived** from
`MAX_NESTING_DEPTH` rather than written as a number, so the two cannot drift.
Every figure quoted above follows `MAX_NESTING_DEPTH`; read the constant rather
than trusting the number in this sentence if the two ever disagree.

Depth is measured by `measureSchema`, which walks wider than the compatibility
rules do — see [Where check does not descend](#where-check-does-not-descend).

## Objects

| Code | Severity | Compile | Fires when |
|---|---|---|---|
| `openai/strict-optional-property` | error | fixes | A property is absent from `required`. OpenAI strict mode rejects the schema as written. |
| `openai/nullable-instead-of-omitted` | **warning** | fixes | Paired with the above, at the same path: after compilation the model may send `name: null` instead of omitting the property. |
| `openai/object-missing-additional-properties` | error | fixes | An object schema does not set `additionalProperties`. Compile adds `false`. |
| `openai/additional-properties-true` | error | fixes | An object explicitly sets `additionalProperties: true`. OpenAI strict mode requires `false`. |
| `openai/extra-properties-no-longer-accepted` | **warning** | fixes | Paired with the above, at the same path: after compilation the model can no longer send the undeclared keys the canonical schema allowed. |
| `openai/additional-properties-schema` | error | fixes (lossy) | `additionalProperties` is a value schema (an open typed map). Strict mode cannot express it, so the map is erased. |

## Boolean and non-schema subschemas

| Code | Severity | Compile | Fires when |
|---|---|---|---|
| `openai/boolean-subschema` | error | fixes (lossy) | A subschema slot holds `false`. `false` accepts *nothing*; OpenAI cannot express that, so it compiles to `{}`, which accepts *anything* — the widest possible weakening of a constraint. |
| `openai/boolean-subschema` | info | fixes | A subschema slot holds `true`. It compiles to `{}`, which accepts exactly the same values, so nothing is lost. |
| `openai/non-schema-subschema` | error | fixes (lossy) | A subschema slot holds something that is not a schema at all (a string, a number, `null`). Treated like `false`: replaced with `{}` and reported lossy, rather than silently normalised away. |

Slots checked: `properties`, `items`, `$defs`, `definitions`, `prefixItems`,
`anyOf`, `oneOf`, `allOf`, `not`. **`additionalProperties` is exempt** — a
boolean is its normal form there, and `openai/object-missing-additional-properties`
/ `openai/additional-properties-true` / `openai/additional-properties-schema`
already own it. A plain `additionalProperties: false` produces no diagnostic.

Where the boolean sits inside a slot compile drops wholesale (`allOf`, `not`,
`prefixItems`), the diagnostic says so in its `compile.detail` instead of
claiming a `{}` will be emitted. Both paths are lossy, so compilation is refused
either way.

**Why this rule exists even though the CLI cannot reach it.**
`validateCanonicalTool` in `@schemaport/core` rejects boolean subschemas
outright, so no tool loaded from disk gets this far. But the adapter is a public
API that can be called directly, and SchemaPort's promise never to weaken a
schema silently has to hold there too. This is defence in depth.

### Why optional properties produce two diagnostics

There are two independent, both-true facts, and collapsing them into one
diagnostic loses whichever one you drop.

**Fact 1 — the schema as written is not sendable.** OpenAI strict mode rejects a
property that is not listed in `required`. `check()` must report that as an
`error`, or a CI run gated on errors (`--fail-on error`) would exit 0 for a
schema that cannot be sent to OpenAI at all. That is
`openai/strict-optional-property`. `finalizeCompile` drops it from a *successful*
compile result, which is correct: there the
`converted-optional-property-to-nullable` transformation is the record.

**Fact 2 — the compiled schema behaves differently at runtime.** The model may
emit `{"amount": null}` where the canonical schema expected `amount` to be
omitted, so your handler has to treat `null` as "not supplied". That has to
survive into the compile result and the manifest, so it is a separate
`warning`: `openai/nullable-instead-of-omitted`, at the same path.

`check()` output for the PRD's headline tool reads:

```
OpenAI
✗ Optional property `amount` is not allowed in OpenAI strict mode.
  Path: inputSchema.properties.amount
  SchemaPort can compile this as required and nullable.
⚠ After compilation the model may send `amount: null` instead of omitting it.
  Path: inputSchema.properties.amount
```

The warning is emitted only for properties the conversion actually touches — a
property that was already in `required` changes nothing at runtime and is
silent.

`openai/additional-properties-true` / `openai/extra-properties-no-longer-accepted`
are split on exactly the same principle: strict mode forbids `true` (error), and
closing the object stops the model sending undeclared keys (warning).

Rules where only the runtime fact is certain stay single warnings.
`openai/default-keyword-dropped`, `openai/legacy-definitions-keyword` and
`openai/nullable-keyword-converted` are not promoted, because OpenAI does not
document whether it *rejects* `default`, `definitions` or `nullable` — claiming
an error there would assert something unverified.

The four near-limit rules are single warnings for a different reason again:
there is no error to pair them with, because OpenAI accepts the schema as
written and compile changes nothing. Each is suppressed once its own limit is
actually exceeded, at which point the refusal says everything the warning
would. See
[Every size limit warns before it fails](#every-size-limit-warns-before-it-fails).

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
