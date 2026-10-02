# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.1] - 2026-10-02

### Added

- The market detail page now shows Pendle's wider data, all on the existing API host:
  - yield provenance (where the underlying/floating yield comes from) and points/reward programmes,
    each labelled with who receives it;
  - the limit-order book in rate terms, plus the maker incentive;
  - PT looping venues with maximum leverage, borrow rate and Pendle's own risk panel, and our
    net-at-max-leverage check beside it;
  - daily history back to Pendle's ~1440-point cap (years), kept separate from the hourly series the
    score reads;
  - a block-fresh live spot rate when it differs from the snapshot.
- Market logos behind an off-by-default Settings toggle; the default is a local monogram that makes no
  third-party request.

### Changed

- Discover cards show a market monogram and Loopable / Variable badges.

## [1.0.0] - 2026-10-02

Initial public release.

### Added

- **Discover** — every Pendle PT market ranked by a transparent 0–100 score,
  with a stated reason for every market that is hidden and a one-click
  **Show all**.
- **Simulate** — entry, exit and roll-over quoted together, a maturity plan, a
  value-over-time chart, and full route / fee / price-impact forensics built
  from the quote's own transaction calldata.
- **Favorites** — a shortlist with the rate drift since it was starred.
- **Settings** — thresholds, chains, benchmark override and cache controls.
- **Method** — every weight, threshold and formula in plain language, generated
  from the same constants the scorer uses so the prose cannot drift from the code.
- A market detail page ordered by the four questions a PT buyer asks, with a
  worked payout, an entry-cost estimate, and data-backed **why it could work** /
  **what to watch** lists (`domain/decision.ts`).

### Changed

- Protocol scoring is now an objective depth measurement
  (`domain/protocol.ts`); the curated protocol registry was removed. The app
  makes no protocol-level judgement anywhere and never calls a protocol "safe".

[Unreleased]: https://github.com/zhouzhuojie/pendle-frens/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/zhouzhuojie/pendle-frens/releases/tag/v1.0.1
[1.0.0]: https://github.com/zhouzhuojie/pendle-frens/releases/tag/v1.0.0
