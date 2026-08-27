# Changelog

All notable changes to `@schemaport/provider-openai` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Chat Completions as a second output target.** `compile()` and `probe()` now
  take an optional `apiSurface`, either `'responses'` (the default, unchanged)
  or `'chat-completions'`:

  ```ts
  const result = openaiProvider.compile(tool, { apiSurface: 'chat-completions' });
  // { type: 'function', function: { name, description, parameters, strict: true } }

  await client.chat.completions.create({ model, messages, tools: [result.output] });
  ```

  Until now the only emitted shape was the flat Responses API `FunctionTool`,
  and `docs/limitations.md` recorded Chat Completions as unsupported. Chat
  Completions is still widely used, so anyone targeting it had to re-nest
  SchemaPort's output by hand — the exact manual reshaping this package exists
  to remove. The shapes are confirmed against `openai@7.5.0`:
  `ChatCompletionFunctionTool` is `{ type: 'function'; function:
  Shared.FunctionDefinition }`, and `FunctionDefinition` is `{ name;
  description?; parameters?; strict? }`.

  **`strict` is not in the same place on the two surfaces.** On the Responses
  tool it is a top-level sibling of `name` and `parameters`; on the Chat
  Completions tool it lives inside `function`. A tool compiled for one surface
  and posted to the other does not merely fail validation — a top-level `strict`
  on Chat Completions is not the strict flag at all, so the likelier outcome is
  a schema that silently goes unenforced. That is why the surface is a named
  option rather than something inferred.

  **The compatibility rules are unchanged, and are not duplicated.** The schema
  pipeline runs once and only the final wrapping differs (`src/surface.ts`).
  Same strict-mode requirements, same supported-keyword allowlist, same
  transformations on `parameters`, same size limits, same diagnostics, same
  refusals. Choosing Chat Completions does **not** change which keywords
  survive, does not rescue a schema the other surface refused, and does not make
  anything more or less lossy. `parameters` is byte-identical between the two
  for every shared `@schemaport/core` fixture, and there is a test that says so.

  **The default is byte-identical to before.** `compile(tool)` and
  `compile(tool, { allowLossy })` — the calls the CLI makes — emit exactly the
  bytes 0.1.0 emitted, with the same transformation array and the same
  diagnostics. `test/fixtures/main-output.ts` pins that output for all six
  shared fixtures, captured from the previous commit rather than regenerated
  from the current source.

  `apiSurface` is optional and adds nothing to `@schemaport/core`;
  `openaiProvider` remains assignable to `SchemaPortProvider`, asserted at build
  time in `src/index.ts`.

- **`nested-under-function-key`** — a new non-lossy `Transformation`, recorded
  when and only when the Chat Completions envelope is used, so the manifest
  records which surface was emitted. The Responses envelope adds nothing new:
  `renamed-input-schema-to-parameters` and `enabled-strict-mode` already
  describe it and have been in the manifest since 0.1.0, so a third entry would
  have changed every existing manifest to say what it already said.

- **`probe()` targets the selected surface.** With
  `apiSurface: 'chat-completions'` it sends one `POST /v1/chat/completions`
  through the SDK's `chat.completions` path, carrying the nested tool, the
  `probePrompt` text as a `messages` entry, the nested
  `ChatCompletionNamedToolChoice` form of `tool_choice`, and
  `max_completion_tokens` (`max_tokens` is `@deprecated` in the SDK types). It
  reads the call back from `choices[].message.tool_calls[]`. Every existing
  guarantee holds on both paths: compile runs first and a refused schema is
  never sent, key and model resolution are unchanged, failures are classified by
  `classifyProviderError`, and `options.client` is still the only way a test
  reaches an SDK. `OpenAIProbeClient` is now a union of the two structural
  client slices; a client that cannot reach the requested surface is reported as
  `errorKind: 'unsupported'` with nothing sent.

- New exports: `OpenAIApiSurface`, `OpenAICompileOptions`, `OpenAIProbeOptions`,
  `OpenAIChatCompletionsTool`, `OpenAICompiledTool`, `OpenAIProvider`,
  `OpenAIResponsesProbeClient`, `OpenAIChatCompletionsProbeClient`,
  `DEFAULT_API_SURFACE`, `OPENAI_API_SURFACES`,
  `CHAT_COMPLETIONS_WRAPPER_CODE` and `wrapForSurface`. `OpenAIFunctionTool`
  moved from `src/compile.ts` to `src/surface.ts` and is re-exported unchanged.

- 68 further tests (116 → 184): the pinned default output, the Chat Completions
  shape checked against the SDK's own types, `strict`'s position on each
  surface, identical `parameters` and diagnostics across surfaces for all six
  shared fixtures, transformation equality apart from the one wrapping entry,
  refusal parity for both lossy and unresolvable tools, determinism, and mocked
  Chat Completions probe outcomes. Still no network request anywhere.

- **`openai/schema-nesting-near-limit`** — a new **warning** that fires when a
  schema's deepest nesting reaches 9 or 10 levels, within two levels of
  OpenAI's documented limit of 10, but does not exceed it. This brings the rule
  count to **30**.

  Until now there was nothing between "fine" and "rejected": a schema at depth
  9 or 10 passed `check()` in silence and then broke on the next nested
  property someone added, turning a clean CI run into an API rejection in a
  diff that had nothing obviously to do with depth. The warning names the
  measured depth, the limit and the remaining headroom (one level at depth 9,
  none at depth 10).

  Nothing about compilation changes. The schema is sendable as written and is
  emitted byte-for-byte unchanged, so the diagnostic's compile ability is
  plain `compilable` — not lossy, never a refusal, unaffected by
  `--allow-lossy` — and the warning simply survives into the compile result and
  the manifest. There is no accompanying `Transformation`, because compile does
  not touch the schema.

  **One finding per schema, not two.** Above the limit the warning is
  suppressed and the existing `openai/schema-too-deep` error fires alone. Depth
  8 reports nothing, 9 and 10 report the warning, 11 and beyond report the
  error.

  The two-level margin is SchemaPort's own choice, not an OpenAI limit; it is
  exported as `NESTING_DEPTH_WARNING_THRESHOLD` (9), derived from
  `MAX_NESTING_DEPTH`.

## [0.1.0] - 2026-08-20

Initial release. Rules reviewed against official OpenAI documentation on
2026-08-20; sources are listed in `docs/openai-support.md`.

### Fixed

- **Silent weakening of boolean subschemas.** A `false` subschema in
  `properties`, `$defs`, `definitions`, `anyOf` or `oneOf` compiled to `{}` with
  no diagnostic, no transformation record and no refusal — turning "accept
  nothing" into "accept anything". `items: false` was worse: the `items` keyword
  was dropped entirely, letting the array accept any element. Both now raise
  `openai/boolean-subschema` and record a `lossy: true`
  `widened-false-subschema` transformation, so compilation is refused without
  `allowLossy`. `true` subschemas compile to the equivalent `{}` with a
  non-lossy `normalized-true-subschema` record. Values that are not schemas at
  all are handled the same way under `openai/non-schema-subschema` /
  `widened-invalid-subschema`. `additionalProperties: false` is unaffected.

  `validateCanonicalTool` in `@schemaport/core` rejects boolean subschemas, so
  the CLI path could not reach this; the fix is defence in depth for callers
  using the adapter directly.

### Added

- `openaiProvider`, a `SchemaPortProvider` targeting the OpenAI **Responses API**
  function tool (`POST /v1/responses`, `tools[]`) with `strict: true`.
- `check()` with 29 compatibility rules:
  - Tool identity — `openai/tool-name-invalid-characters`,
    `openai/tool-name-too-long`, `openai/missing-tool-description`.
  - Root schema — `openai/root-schema-not-object`, `openai/root-schema-anyof`.
  - Size limits — `openai/too-many-properties`, `openai/schema-too-deep`,
    `openai/too-many-enum-values`, `openai/large-enum-too-long`,
    `openai/schema-too-large`.
  - Objects — `openai/strict-optional-property`,
    `openai/nullable-instead-of-omitted`,
    `openai/object-missing-additional-properties`,
    `openai/additional-properties-true`,
    `openai/extra-properties-no-longer-accepted`,
    `openai/additional-properties-schema`.
  - Subschema slots — `openai/boolean-subschema`,
    `openai/non-schema-subschema`.
  - Keywords — `openai/unsupported-keyword`,
    `openai/undocumented-constraint-keyword`, `openai/unknown-keyword`,
    `openai/unsupported-string-format`, `openai/one-of-converted-to-any-of`,
    `openai/annotation-keyword-dropped`, `openai/default-keyword-dropped`,
    `openai/const-converted-to-enum`, `openai/legacy-definitions-keyword`,
    `openai/conflicting-definitions-keywords`,
    `openai/nullable-keyword-converted`.
- `compile()` producing a ready-to-send `FunctionTool`, built from an allowlist
  of documented keywords so no unverified keyword reaches the API. Deterministic:
  fixed key order, no timestamps, no randomness, independent of key order in the
  source file.
- Transformations, all recorded with a stable code, path, detail and `lossy`
  flag. Non-lossy: `renamed-input-schema-to-parameters`, `enabled-strict-mode`,
  `converted-optional-property-to-nullable`,
  `added-additional-properties-false`, `closed-open-object`,
  `dropped-annotation-keyword`, `dropped-default-keyword`,
  `converted-const-to-enum`, `renamed-definitions-to-defs`,
  `rewrote-definitions-reference`, `converted-nullable-to-type-union`,
  `normalized-true-subschema`.
  Lossy: `dropped-unsupported-keyword`, `dropped-conflicting-definitions`,
  `dropped-undocumented-constraint-keyword`, `dropped-unknown-keyword`,
  `dropped-unsupported-format`, `dropped-additional-properties-schema`,
  `converted-one-of-to-any-of`, `widened-false-subschema`,
  `widened-invalid-subschema`.
- `probe()` against `POST /v1/responses` using `openai@7.5.0`, with a forced
  `tool_choice`, a 1024-token output cap and no execution of the developer's
  function. Model resolution: `options.model` → `SCHEMAPORT_OPENAI_MODEL` →
  `gpt-5.6-luna`. Key resolution: `options.apiKey` → `OPENAI_API_KEY`.
  `options.client` is supported as a test seam.
- Separate diagnostic codes for the two evidence tiers behind a dropped
  constraint, so a keyword OpenAI names as unsupported is distinguishable from
  one that is merely absent from its supported list. `docs/probing.md` documents
  how to settle a tier-2 case against the live API.
- Paired error/warning diagnostics wherever OpenAI rejects the canonical schema
  *as written* **and** compilation changes runtime behaviour. The error makes
  `check` fail CI; the warning survives `finalizeCompile` into the compile
  result. Applies to `openai/strict-optional-property` +
  `openai/nullable-instead-of-omitted`, and to
  `openai/additional-properties-true` +
  `openai/extra-properties-no-longer-accepted`.
- Documentation: `docs/openai-support.md`, `docs/rules.md`,
  `docs/transformations.md`, `docs/limitations.md`, `docs/probing.md`,
  `docs/examples.md`.
- 89 tests covering every rule by code, valid/invalid/warning fixtures,
  deterministic compilation, the lossy refusal and `allowLossy` paths, and
  mocked probe outcomes (accepted, rejected, missing credentials, 404
  model-not-found, 401, 429, compile-refused). No test makes a network request.

[0.1.0]: https://github.com/schemaport/provider-openai/releases/tag/v0.1.0
