# Contributing

Thanks for considering a contribution. This project is intentionally small: almost everything worth
changing is one file with tests next to it.

## Setup

```bash
npm install
npm run build      # → dist/, load unpacked in chrome://extensions
npm test           # offline unit tests, no network
npm run typecheck
PF_LIVE=1 npm test # opt-in: hits the real APIs and spends computing units
```

Read [docs/DESIGN.md](docs/DESIGN.md) before changing behaviour. It records why several odd-looking
decisions are deliberate, which is much cheaper than rediscovering them.

## Ground rules

1. **No new runtime dependencies without a very good reason.** The extension ships zero.
2. **Logic stays pure.** Anything in `src/lib/domain` must be importable and testable without `chrome`,
   `fetch` or the DOM.
3. **Never invent a number.** If the API does not return something, say "unavailable" or derive it in a
   documented, tested way.
4. **Label estimates as estimates.** Gas, price impact and slippage have different confidence levels.
5. **Never hide data silently.** A filter that can remove a row must return an attributable reason.
6. **Minimal permissions.** A PR that adds a permission needs a paragraph justifying it.
7. **No telemetry.** Ever.

## Adding a protocol to the registry

`src/lib/domain/registry.ts` decides whether a market can appear at all: an unlisted protocol scores
15/100 on the protocol factor and is hidden while `hideUnknownProtocols` is on (the default). So
"protocol X is unlisted" and "protocol X is hidden" are the same statement, and a missing entry is a bug
report waiting to happen.

When you add one:

- **Pick the tier honestly** against the definitions in the file header. Tier A is a track record, not a
  vibe. Tier B exists precisely so you do not have to choose between inflating a young protocol to A and
  burying it at C.
- **Write a `note` only when you have something specific and sourced to say.** Apyx is tier C because
  apxUSD traded below par for months and redemptions are priced off a protocol-computed redemption
  value — that is the kind of claim that needs a citation, not a feeling. The UI renders your note on the
  detail view, so write it for the person deciding whether to lend this protocol their money.
- **Add aliases.** Pendle spells the same protocol inconsistently — `USD.AI` and `USD.ai` are both
  returned for USD.AI — so include the variants and the legal entity name. `tests/registry.test.ts`
  asserts the API's own spelling resolves (`APYX`, not `Apyx`).
- **Add an `auditUrl` only if you have checked it yourself.** Pendle's own `marketInfo.auditedUrl` is
  empty for every market we have scanned, so the registry is the only source of audit links, and a
  guessed URL is worse than the honest "no audit link on file" flag.

## Changing the score

`src/lib/domain/score.ts` holds `SCORE_WEIGHTS`, `VERDICT_RULES`, `FACTOR_DOCS` and `FLAG_DOCS`. If you
change a threshold:

- the weights must still sum to 1 after re-normalisation (there is a test);
- every factor's `detail` string has to stay human-readable — the UI shows it as the explanation;
- update the matching prose in `FACTOR_DOCS` / `FLAG_DOCS` and the rule text in `VERDICT_RULE`;
- `tests/score.test.ts` enforces all of the above, because the Method page is generated from these same
  constants. Adding a threshold without its explanation fails CI.

## Changing the fee model

`src/lib/domain/route.ts` reconstructs the SDK's swap fee and shows its own result next to the SDK's,
including the difference. If you touch it:

- **keep both numbers in the UI** — the whole point is that a mismatch is visible;
- `tests/route.test.ts` asserts the arithmetic per leg, including the two-leg roll-over case;
- `PF_LIVE=1 npm test` asserts the reconstruction stays within 5% of the SDK's fee on a real market. If
  that assertion starts failing, the fee model changed and the explanatory text needs updating too, not
  just the constant.

## API changes

Raw provider shapes are confined to `src/lib/api/normalize.ts`. If Pendle renames a field, fix it there
(and the matching case in `tests/normalize.test.ts`) rather than leaking the new name into
`domain/types.ts`.

## Brand assets

Icons, the header mark and the README banner are generated from one geometry definition, with no image
dependency — `zlib` and a hand-rolled CRC32:

```bash
npm run brand   # → public/icons/*.png, public/brand/mark.svg, assets/brand/banner.svg
```

`scripts/brand.mjs` records how each number was measured off the artwork in `assets/brand/source/`. Do
not hand-edit the generated files, and do not add a raster pipeline.

Two things to know before you touch it:

- **`SIZE_TUNING` deliberately deviates from the source proportions.** The rule's true width is 1.8% of
  the mark height, which is 0.25 px at a 16 px icon. Each size gets a widened rule and dots so the mark
  still *reads*; that is the point of an icon, and the table records the trade.
- **`MARK_UI_RULE` was chosen by rendering candidates at 22 px and comparing**, not by taste.

## Testing expectations

- New pure logic → unit tests.
- New UI behaviour expressible as math → push it into `domain/` and unit test it.
- New filter or hiding rule → it must return an attributable reason via `domain/screen.ts`, and appear in
  the Discover summary. Nothing may be dropped silently.
- New network behaviour → assert in `tests/live.test.ts` (skipped unless `PF_LIVE` is set).

`tests/panel.render.test.ts` renders every view in jsdom, so a broken DOM helper fails CI without a
browser. `tests/manifest.test.ts` fails if the permission list grows or the version drifts from
`package.json`.

Run `PF_LIVE=1 npm test` before opening a PR that touches the API layer — it exercises real markets, a
real entry/exit/roll quote and 1440 points of history.

## Commits and PRs

Conventional-ish subjects (`feat:`, `fix:`, `docs:`, `test:`, `chore:`) are appreciated but not enforced.
In the PR description say what changed, why, and what you verified — including the exact commands you
ran.

## Code style

TypeScript strict, including `noUncheckedIndexedAccess`. `verbatimModuleSyntax` is on, so use `import
type` for type-only imports. 2-space indent, single quotes, trailing commas, ~120 column soft limit.

## Security

See [SECURITY.md](SECURITY.md).
