# Adapted pull requests

These contributions were incorporated through focused commits rather than merging
their branches unchanged. The original PRs remain the source for classroom attribution.

| PR | Contributor | Incorporated work |
| --- | --- | --- |
| [#6](https://github.com/ari-dc-uba-ar/ssot2026/pull/6) | nazolaz | Isolated-database CRUD testing, adapted to the current API and migrations. |
| [#15](https://github.com/ari-dc-uba-ar/ssot2026/pull/15) | fdllrs | Spreadsheet editing, filtering, sorting and confirmations, subsequently extended. |
| [#16](https://github.com/ari-dc-uba-ar/ssot2026/pull/16) | fausto-figueroa | Bulk deletion, dependency previews and transactional validation. |
| [#39](https://github.com/ari-dc-uba-ar/ssot2026/pull/39) | aviollaz | Menu areas supplied by the backend, rendered as filterable collapsible groups. Discovery and browser assertions were updated. |
| [#34](https://github.com/ari-dc-uba-ar/ssot2026/pull/34) | aviollaz | Named browser-test steps and readable page actions. Helpers are shared with the newer suite; explicit saving and grouped navigation coverage are retained. |
| [#40](https://github.com/ari-dc-uba-ar/ssot2026/pull/40) | Runtra / Facundo Chenlo, LU 335/23 | CSV parsing, export, transactional import, duplicate handling, toolbar actions and result dialogs. |
| [#41](https://github.com/ari-dc-uba-ar/ssot2026/pull/41) | aviollaz | Related records in the review dialog, including labels reached through association tables. |
| [#42](https://github.com/ari-dc-uba-ar/ssot2026/pull/42) | aviollaz | Alternating spreadsheet row colors, adapted for both themes and existing hover/new-row colors. |

## Related-record compatibility adjustments

- Incoming and outgoing readable relationships are projected from the SSOT into
  API metadata. The browser does not import table definitions or scan every table
  to discover relationships. Editor references retain their existing input names.
- Each incoming relationship has independent pagination using the app's existing
  page size and 200-row client/server threshold. Only the visible page's outgoing
  references are resolved, with exact composite-key filters and shared requests.
- Association rows retain their own fields. Two foreign keys do not imply a pure
  many-to-many table, and no domain-specific summary is inferred.
- Visited pages are cached for the lifetime of the review. Live invalidation
  refreshes affected pages and labels; closing the dialog or ending the session
  releases its cache and subscriptions. Unsaved spreadsheet drafts are preserved.
- Unit tests cover arbitrary domain names, composite and overlapping keys, nulls
  and unavailable targets. Browser tests cover server pagination, cache reuse,
  live changes, retry, mobile overflow and cleanup against real PostgreSQL.

## CSV compatibility adjustments

- Null and empty strings have distinct encodings, so exporting and importing does
  not change their meaning. Empty files return validation errors.
- Import/export capabilities come from SSOT field metadata. There is no special
  case for a particular table name in either the CSV backend or frontend.
- Imports reuse existing write validation and insertion, and use one public result
  type. The app supplies the upload limit to both the server parser and browser.
- Tests are included in `test:api`, `test:crud` and `test:ui`. Real PostgreSQL checks
  cover rollback, concurrent imports, composite keys and field/entity constraints;
  browser checks cover uploads, downloads and preservation of unsaved drafts.

PR #18's student summary is not included: it requires domain-specific reporting
rules and a separate API capability design.
