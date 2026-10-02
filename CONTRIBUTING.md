# Contributing

This project is intentionally small: almost everything worth changing is one file with tests next to it.
Read [docs/DESIGN.md](docs/DESIGN.md) before changing behaviour — it records why the odd-looking parts
are deliberate.

## Setup

```bash
npm install
npm run build      # → dist/, load unpacked in chrome://extensions
npm test           # offline unit tests, no network
npm run typecheck
PF_LIVE=1 npm test # opt-in: real APIs (spends computing units)
```

## Ground rules

1. **No new runtime dependencies** without a very good reason — the extension ships zero.
2. **Logic stays pure.** `src/lib/domain` must run without `chrome`, `fetch` or the DOM.
3. **Never invent a number.** Say "unavailable" or derive it in a documented, tested way.
4. **Label estimates as estimates.**
5. **Never hide data silently.** A filter that removes a row must return a reason.
6. **Minimal permissions.** Adding one needs a paragraph justifying it.
7. **No telemetry.** Ever.

## There is no protocol registry

The app makes **no protocol-level judgement**. Protocol depth is measured in `domain/protocol.ts` from
snapshot facts (TVL, markets, chains, Pendle's Prime flag), capped at 0.60. To change how a protocol is
ranked, edit `PROTOCOL_DEPTH` and its prose in `FACTOR_DOCS.protocol`; `tests/score.test.ts` fails if the
two drift. Deliberate costs, so they are not "fixed" by accident: there is no "unknown" list, audit links
are not a feature, and size is never safety.

## Changing the score

`domain/score.ts` holds `SCORE_WEIGHTS`, `VERDICT_RULES`, `FACTOR_DOCS` and `FLAG_DOCS`. Weights must
still sum to 1, every `detail` string stays human-readable, and the prose must match the constants —
`tests/score.test.ts` enforces all of it, because the Method page is generated from them.

## Changing the fee model

`domain/route.ts` reconstructs the SDK's fee and shows both numbers; keep both in the UI. `tests/route.ts`
asserts the per-leg arithmetic (including the two-leg roll-over), and `PF_LIVE=1 npm test` keeps the
reconstruction within 5% of the SDK's fee. If that fails, the model changed and the prose needs updating
too.

## API changes

Raw shapes are confined to `api/normalize.ts` — fix field renames there, not in `domain/types.ts`. The
detail page's live data (order book, PT looping, daily history, spot rate) has a normalizer plus a pure
consumer in `domain/rewards.ts`, `domain/book.ts` or `domain/looping.ts`. Add a `tests/normalize.test.ts`
case, and run `PF_LIVE=1 npm test` if you touch the network shape. None of it feeds the score; if you
think it should, that is a scoring change and belongs in `score.ts` with its prose and a test.

## Testing expectations

- New pure logic → unit tests.
- New UI behaviour expressible as math → push it into `domain/`.
- New filter or hiding rule → an attributable reason via `domain/screen.ts`.
- New network behaviour → `tests/live.test.ts` (skipped unless `PF_LIVE` is set).

`tests/panel.render.test.ts` renders every view in jsdom; `tests/manifest.test.ts` fails if permissions
grow or the version drifts from `package.json`. Run `PF_LIVE=1 npm test` before a PR touching the API.

## Brand assets

`npm run brand` writes the icons, header mark and banner from one geometry definition, with no image
dependency. Only `public/` ships, so do not hand-edit generated files or add a raster pipeline.
`SIZE_TUNING` deliberately deviates from the source proportions so the mark still reads at 16 px.

## Commits, style and conduct

Conventional-ish subjects (`feat:`, `fix:`, `docs:`) are appreciated. TypeScript strict
(`noUncheckedIndexedAccess`; `verbatimModuleSyntax`, so use `import type`), 2-space indent, single quotes.
Be decent: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Report vulnerabilities via
[SECURITY.md](SECURITY.md), never a public issue.
