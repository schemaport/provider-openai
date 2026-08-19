# Changelog

All notable changes to `@schemaport/provider-openai` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-20

Initial release. Rules reviewed against official OpenAI documentation on
2026-08-20; sources are listed in `docs/openai-support.md`.

### Added

- `openaiProvider`, a `SchemaPortProvider` targeting the OpenAI **Responses API**
  function tool (`POST /v1/responses`, `tools[]`) with `strict: true`.
- `check()` with 27 compatibility rules:
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
  `rewrote-definitions-reference`, `converted-nullable-to-type-union`.
  Lossy: `dropped-unsupported-keyword`, `dropped-conflicting-definitions`,
  `dropped-undocumented-constraint-keyword`, `dropped-unknown-keyword`,
  `dropped-unsupported-format`, `dropped-additional-properties-schema`,
  `converted-one-of-to-any-of`.
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
