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
