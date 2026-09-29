# Architecture

## Shape

┌─────────────────────── side panel (src/panel) ─────────────────────────────┐
│ main.ts → App (app.ts)                                                      │
│   state: settings, favorites, snapshot, benchmark, scores, history, sim     │
│   views: discover · detail · simulate · favorites · settings                │
│   renders with src/panel/dom.ts helpers — no framework, no innerHTML for    │
│   dynamic data (everything user-facing goes through textContent)            │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │ src/lib/api/client.ts
                                │ fetch · TTL cache · single-flight
                                ▼
                    ┌──────────────────────────┐
                    │ src/lib/api/pendle.ts    │
                    │ src/lib/api/treasury.ts  │
                    │   (the only fetch calls) │
                    └───────────┬──────────────┘
                                ▼
                      src/lib/api/normalize.ts
                  raw provider payloads → domain types
                                │
                                ▼
                  src/lib/domain/*  (pure, fully unit tested)
        types · chains · registry · score · screen · history · simulate · format

┌───────────────── background service worker (src/background) ────────────────┐
│ 27 lines, 9 of them code. One job: `setPanelBehavior` at install, so the    │
│ toolbar button opens the panel. No network, no state, no timers.            │
└─────────────────────────────────────────────────────────────────────────────┘

## Why the panel fetches, and the worker does not

This was the other way round until it was measured. MV3 grants cross-origin access to "an extension
service worker **or foreground tab**" holding `host_permissions`; only content scripts are pinned to
their page's origin. A side panel is a foreground extension page, this extension has no content
scripts, and both upstream APIs are CORS-friendly anyway (Treasury sends `Access-Control-Allow-Origin:
*`; Pendle echoes the caller's origin) — so the hop through the worker bought nothing and cost:

- an RPC protocol (`src/lib/rpc.ts`, deleted) whose only purpose was talking to a process Chrome may
  kill at any moment;
- a second structured-clone of the ~0.3 MB snapshot on every refresh;
- a failure mode where an idle worker answers nothing and the UI has to say so.

What the worker genuinely did provide is now handled by the layer below, `chrome.storage.local`, which
is shared by every context:

| Was | Is |
| --- | --- |
| the worker finished a fetch after the panel closed | the panel refetches next time it opens. Nothing was watching it, so that work was wasted |
| one in-flight request shared by two windows' panels | the second panel reads the fresh persisted snapshot. Only two *simultaneous* cold opens duplicate — one extra markets request |
| one writer to `chrome.storage` | single-flight inside `api/client.ts` serialises callers in a context. `storage.local` has no compare-and-swap, so a cross-window write race on the native-price map is possible and harmless — it is a cache |

The service worker remains because the platform requires one for exactly one thing, which is cheap,
offline and event-driven:

`sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` — only settable from the worker, and it
must run at install/startup or the toolbar button does nothing.

That is the whole file now (27 lines, 9 of them code). The badge that used to share the job was removed; see
`docs/PRODUCT.md` §20.

`api/` and `domain/` still never import `chrome`, so they run under plain Node in tests.

## Layers and the rules between them

| Layer | May import | Must not |
| --- | --- | --- |
| `domain/*` | `util/*`, each other | `chrome`, `fetch`, DOM |
| `api/pendle.ts`, `api/treasury.ts`, `api/http.ts` | `domain/types`, `util/*` | `chrome`, DOM |
| `api/client.ts` | `api/*`, `storage`, `util/*` | DOM |
| `storage/*` | `domain/types` | DOM |
| `background/*` | `chrome.sidePanel` | network, storage, DOM — it configures one setting and stops |
| `panel/*` | `domain`, `storage`, `dom`, `api/client` | `api/pendle` / `api/treasury` directly — go through `client` so cache policy cannot be bypassed |
| `panel/chart.ts` | `dom` only | `domain` (charts are dumb: they take numbers, not markets) |
| `panel/views/simulate-detail.ts` | `domain`, `dom`, `components` | `api/client` (it renders numbers, it does not fetch them) |

### No scheduler

There is no `alarms` permission and no background polling. The worker only runs on `onInstalled` and
`onStartup`, and never spends an API unit. All fetching is instigated by a human opening the panel or
pressing ⟳.

## Caching tiers

| Data | TTL | Where | Notes |
| --- | --- | --- | --- |
| markets | 5 min | memory + `chrome.storage` | ~10 computing units per full refresh |
| history | 30 min | `chrome.storage` (12 most recent) | 5 units per fetch; endpoint always returns ~1440 hourly points |
| benchmark | 6 h | `chrome.storage` | a monthly official series |
| native token price | 10 min | `chrome.storage` | used to price gas |
| convert quotes | never | — | every quote is a point-in-time estimate; staleness is shown |

`SingleFlight` gives both single-flight de-duplication and the in-memory TTL layer. `mapLimit(…, 3, …)`
bounds concurrency across chains, and the size sweep is deliberately sequential.

The in-memory layer is per-context (a panel, or the worker), and the persisted layer is shared. That is
why a second window's panel normally does not refetch: it finds a snapshot younger than the TTL.

## The domain math

- `decimal.ts` — exact `string ↔ BigInt` base-unit conversion. 18-decimal token amounts exceed
  `Number.MAX_SAFE_INTEGER`, so user input never round-trips through a float.
- `score.ts` — the only opinionated module. `SCORE_WEIGHTS` plus `decideVerdict`, both small and both
  covered by tests. Weights are re-normalized when a factor is unavailable, and the sum-to-one
  invariant is asserted in tests and in the live test. Every threshold is an exported constant because
  the Method view is generated from them.
- `screen.ts` — which markets Discover shows and, for every hidden one, exactly one attributable
  reason. Pure over pre-computed candidates, so the UI can print a truthful reason histogram instead of
  dropping rows silently. Explicit choices (chain, collateral type, search) are never bypassed by
  "show all"; quality bars are.
- `history.ts` — σ, coverage above benchmark and drift over the available window, collapsed into one
  0–1 stability factor (`STABILITY` holds the weights).
- `simulate.ts` — pure functions that take an API quote and return structured results. Request
  builders are separated from interpretation so both can be tested without network access. It also
  owns `fairValuePath` (the PT pricing identity), `buildTrajectories`, `compareScenarios` and
  `buildMaturityPlan`, which is why the trajectory chart, the scenario table and the maturity plan are
  unit-tested numbers rather than chart config.
- `route.ts` — route and fee forensics. Reads the quote's own transaction calldata (`contractParamInfo`)
  to name the venues, splits price impact into internal/external legs, and reconstructs the fee from
  `feeRate × notional × daysToMaturity/365`, reporting both its number and the SDK's so a mismatch is
  visible. Contains the only hardcoded ABI selectors in the codebase (two of them, for naming the steps
  of a composed roll), and degrades to raw hex for anything unknown.
- `successor.ts` — the "same asset, next expiry" match used to default the roll-over destination and to
  price a maturity roll. Separate from the Discover ranking on purpose: for a roll you want continuity
  of exposure, not the best score.
- `registry.ts` — the curated protocol tiers. Not decoration: an unlisted protocol is hidden by
  default, so adding one is behaviour-changing.

## Documentation that cannot drift

The "Method" view is not prose sitting next to the code — it is generated from the same exported
constants the scorer uses (`SCORE_WEIGHTS`, `SPREAD_SCORE_RANGE`, `LIQUIDITY_SCORE_RANGE`,
`MATURITY_BANDS`, `STABILITY`, `VERDICT_RULES`, `FACTOR_DOCS`, `FLAG_DOCS`). `tests/score.test.ts`
asserts that every factor has a full doc block, that the weights still sum to 1, that the prose quotes
the real thresholds, and that every flag the scorer can emit has an explanation. Changing a threshold
without updating its explanation fails CI.

## Styling

`src/panel/panel.css` is the only stylesheet, and it is token-first: everything visual comes from custom
properties in `:root`.

| Group | Tokens | Rule |
| --- | --- | --- |
| Type | `--fs-2xs` … `--fs-3xl` | eight steps; pick the nearer one, never invent a ninth |
| Weight | `--fw-normal`, `--fw-medium`, `--fw-bold` | three, matching the font stack's real weights |
| Space | `--sp-1` … `--sp-10`, 2px base | every `gap`, `padding` and `margin` |
| Radius | `--radius-xs` … `--radius-pill` | |
| Colour | `--bg`, `--panel`, `--text`, `--muted`, `--border`, `--accent`, `--good`, `--warn`, `--bad` | redefined once for dark mode |
| Target | `--tap` | minimum size for anything clickable |

This exists because the sheet had drifted: fifteen font sizes and ten gap sizes, several within half a
pixel of each other. If a change seems to need a value between two steps, either the scale is wrong or the
change is — argue for it in the PR instead of adding a sixteenth size.

Brand assets are generated, not hand-drawn: `npm run brand` writes the PNG icons, the header mark and
the README banner from the single geometry definition in `scripts/brand.mjs` (measurements recorded off
`assets/brand/source/`). The header logo is the ink tile rather than an accent chip on purpose — the
mark's colours are fixed, so it has to carry its own background to work in both themes:
`tests/manifest.test.ts` asserts the header references the generated mark.

Class names are flat and single-purpose (`.card`, `.stat`, `.chip`, `.field`, `.disclosure`). Four rules:
no decorative borders or gradients; no colour that does not carry meaning (`good`/`warn`/`bad` only);
**anything identical on every row of a list belongs above the list, not repeated in each row**; and
**density is fine, flatness is not** — when a view accumulates more than about four things worth reading,
sort it into a lead and collapsible `disclosure()` blocks (see `PRODUCT.md` §21). Every disclosure summary
must carry a value, so a collapsed block never hides a number without saying so.

## Extension security model

- MV3, `storage` + `sidePanel` only, and exactly two `host_permissions`.
- No remote code, no `eval`, no inline scripts (Vite emits bundled, local JS).
- No wallet APIs, no transaction signing. Quotes are built against a burn address purely to read back
  expected amounts and price impact.
- All persisted data is local; nothing is transmitted anywhere except the two public APIs.

## Error and failure behaviour

- Network: `withRetry` with backoff; 429 and 5xx are retryable, 4xx are not.
- Partial data: the v2 risk-info fetch is allowed to fail — prices and liquidity are still useful.
- Market data gaps: the UI says "no usable history" / "not in the active snapshot" rather than
  rendering a zero.
- Quotes: failures surface the API message verbatim (e.g. the $100M input-valuation cap).

## Extending

- **Different chain:** add it to `CHAINS` in `domain/chains.ts`; the API layer is chain-agnostic.
- **Different data provider:** implement `fetchMarkets` / `fetchHistory` / `convert` and reuse
  everything downstream.
- **Different scoring opinion:** edit `BASE_WEIGHTS` and `decideVerdict` in `domain/score.ts`.
- **Different protocol trust opinion:** edit `PROTOCOL_REGISTRY` in `domain/registry.ts`.

Each of those is a single file with tests next to it, which is the point.
