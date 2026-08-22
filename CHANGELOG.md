# Changelog

All notable changes to Pivot Hunter are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and version numbers follow [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH` — breaking changes bump MAJOR, new features bump MINOR, fixes bump PATCH).

## [Unreleased]

## [1.0.0] - 2026-08-22

Initial release.

### Added

- In-browser SQL engine (DuckDB-WASM) — CSVs load straight from the file handle, no server round-trip, fully self-hosted (no CDN dependency, works offline)
- Virtualized data grid that stays smooth at millions of rows
- Per-column filtering with explicit operators — contains, does not contain, equals, not equals, greater/less than(-or-equal), is empty, is not empty — available both from a header dropdown and a right-click context menu on any cell
- Global search across all columns
- Column sorting
- Row tagging, persisted across sessions
- Highlight rules (SQL-driven row coloring), a "highlighted only" grid toggle, and a per-rule "Isolate" button
- Arbitrary-depth "group by" on any combination of columns, with reorderable nesting levels and lazily-loaded rows
- Statistics: event frequency histogram, time-gap/interval analysis, and volume-based outlier detection (IQR or z-score), each with click-to-drill-down back into the grid
- CSV export — current filtered view, tagged rows only, or the full file
- Automatic detection and synthesis of a combined timestamp column when a file splits date and time across two columns (e.g. IIS/W3C logs), so stats stay accurate on that kind of export
- GitHub Pages hosting with automatic build and deploy on every push to `main`

[Unreleased]: https://github.com/imnottwon/Pivot-Hunter/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/imnottwon/Pivot-Hunter/releases/tag/v1.0.0
