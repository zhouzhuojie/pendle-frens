# Contributing

Thanks for considering a contribution. This project is intentionally small; almost everything worth
changing is one file with tests next to it.

## Setup

```bash
npm install
npm run build      # → dist/  (load unpacked in chrome://extensions)
npm test           # offline unit tests
npm run typecheck
PF_LIVE=1 npm test # opt-in: hits the real APIs and spends computing units
```

## Ground rules

1. **No new runtime dependencies without a very good reason.** The extension ships zero.
2. **Logic stays pure.** Anything in `src/lib/domain` must be importable and testable without
   `chrome`, `fetch` or the DOM.
3. **Never invent a number.** If the API does not return something, say "unavailable" or derive it in
   a way that is documented and tested. Do not fabricate a plausible value.
4. **Label estimates as estimates.** Gas, price impact and slippage have distinct confidence levels.
5. **Minimal permissions.** Any PR adding a permission needs a paragraph justifying it in the PR
   description.
6. **No telemetry.** Ever.

## The two most common contributions

### Updating the protocol registry

`src/lib/domain/registry.ts` holds maintainer opinions about protocol trust:

- `A` — blue chip: multi-year live contracts, multiple independent audits, large TVL, no unresolved
  critical incidents.
- `B` — established but younger/smaller, or carrying a known design tradeoff.
- `C` — new, experimental, or thin track record.

A registry PR should include a one-line justification (audits, age, TVL, incidents) in the PR
description. Add an `aliases` entry if the API spells the protocol differently, and add a test case in
`tests/registry.test.ts` if you are introducing an alias.

**This is behaviour-changing, not cosmetic.** An unlisted protocol is hidden by default (see
`hideUnknownProtocols` in Settings), so adding one makes a whole family of markets appear in Discover.
Two practical notes from real data:

- Pendle spells the same protocol inconsistently — `USD.AI` and `USD.ai` are both returned for
  USD.AI — so always add the variants plus the legal entity name as aliases.
- Being honest about tier matters more than being generous. `B` ("established but younger/smaller, or
  carrying a known design tradeoff") exists precisely so you do not have to choose between inflating a
  young protocol to `A` and burying it at `C`. Use the `note` field to record the strongest
  *objection* you found, with a source — for example USD.AI's note records that LlamaRisk declined to
  onboard it to Aave over GPU-collateral liquidity and legal-design concerns.

### Changing the score

`src/lib/domain/score.ts` contains `BASE_WEIGHTS` and `decideVerdict`. If you change either:

- update `tests/score.test.ts`,
- keep the weights summing to 1 after re-normalization (there is a test),
- keep every factor's `detail` string human-readable — the UI shows it as the explanation,
- update the verdict rule text in `src/panel/components.ts` (`VERDICT_RULE`) and in
  `docs/PRODUCT.md` if the bar changes.

## API changes

Raw provider shapes are confined to `src/lib/api/normalize.ts`. If Pendle renames a field, fix it
there (and the matching case in `tests/normalize.test.ts`) rather than leaking the new name into
`domain/types.ts`.

## Adding a protocol to the registry

`src/lib/domain/registry.ts` decides whether a market can appear at all: an unlisted protocol scores 15/100
on the protocol factor and is hidden while `hideUnknownProtocols` is on (the default). So "protocol X is
unlisted" and "protocol X is hidden" are the same statement, and a missing entry is a bug report waiting
to happen.

When you add one:

- pick the tier honestly against the definitions in the file header — A is a track record, not a vibe;
- write a `note` only when you have something specific and sourced to say. Apyx is tier C because apxUSD
  traded below par for months and redemptions are priced off a protocol-computed redemption value; that is
  the kind of claim that needs a citation, not a feeling;
- `tests/registry.test.ts` asserts the API's own spelling resolves (`APYX`, not `Apyx`), because the raw
  string comes from Pendle;
- add an `auditUrl` if the protocol publishes a security page, but **only if you have checked it yourself**.
  Pendle's own `marketInfo.auditedUrl` is empty for every market we have scanned, so the registry is the
  only source of audit links and a guessed URL is worse than the honest "no audit link on file" flag;
- remember the UI renders your note on the detail view. Write it for the person deciding whether to lend
  their money to this protocol, not for a changelog.

## Brand assets

Every icon and logo is generated from one geometry definition, with no image
dependency — `zlib` and a hand-rolled CRC32, same as everything else here:

```
npm run brand        # -> public/icons/*.png, public/brand/mark.svg, assets/brand/banner.svg
```

`scripts/brand.mjs` records how each number was measured off the artwork in
`assets/brand/source/`. If the design changes, re-measure and update that file —
do not hand-edit the generated files, and do not add a raster pipeline.

Two things worth knowing before you touch it:

- **`SIZE_TUNING` deliberately deviates from the source proportions.** The rule's
  true width is 1.8% of the mark height, which is 0.25 px at a 16 px icon. Each
  size gets a widened rule and dots so the mark still *reads*; that is the point
  of an icon, and the table is the record of the trade.
- **`MARK_UI_RULE` was chosen by rendering candidates at 22 px and comparing**,
  not by taste. If you change the header size, re-check it.

## The fee identity

`src/lib/domain/route.ts` reconstructs the SDK's swap fee as
`feeRate × notional × daysToMaturity / 365` and shows its own result next to the SDK's, including the
difference. If you touch that file:

- keep both numbers in the UI — the whole point is that a mismatch is visible;
- `tests/route.test.ts` asserts the arithmetic per leg, including the two-leg case for a roll-over;
- `PF_LIVE=1 npm test` asserts the reconstruction stays within 5% of the SDK's fee on a real market.
  If that live assertion starts failing, the fee model changed and the note in the UI needs updating
  too, not just the constant.

Run `PF_LIVE=1 npm test` before opening a PR that touches the API layer. It exercises real markets,
a real entry/exit/roll quote and 1440 points of history.

## Testing expectations

- New pure logic → unit tests.
- New UI behaviour that can be expressed as math → push it into `domain/` and unit test it.
- New filter or hiding rule → it must return an attributable reason via `domain/screen.ts`, and it must
  show up in the Discover summary. Nothing may be dropped silently.
- New network behaviour → assert in `tests/live.test.ts` (skipped by default).

`tests/panel.render.test.ts` renders every view in jsdom, so a broken DOM helper fails CI without a
browser. `tests/manifest.test.ts` fails if the permission list grows.

## Commits and PRs

Conventional-ish commit subjects (`feat:`, `fix:`, `docs:`, `test:`, `chore:`) are appreciated but not
enforced. In the PR description, say what changed, why, and what you verified — including the exact
commands you ran.

## Code style

TypeScript strict mode including `noUncheckedIndexedAccess`. `verbatimModuleSyntax` is on, so use
`import type` for type-only imports. Formatting is handled by your editor; keep the existing style
(2-space indent, single quotes, trailing commas, ~120 column soft limit).

## Security

If you find a vulnerability, do not open a public issue. Email the maintainer listed in
`package.json` / the repository profile.
