# QoreDB data diff: SQL fields overwrite JSON row metadata

A non-production source-module review of [QoreDB](https://github.com/QoreDB/QoreDB), pinned at [`67108c1af57de5ec0ae363f20e1e1779b6137b3d`](https://github.com/QoreDB/QoreDB/tree/67108c1af57de5ec0ae363f20e1e1779b6137b3d).

The inspected `exportDiffAsJSON` first writes the computed `_status` and `_key`, then writes SQL result columns into the same object. A valid column with either name replaces that row's metadata.

## Three controlled query pairs

SQLite **3.54.0** executed the synthetic `SELECT`s. The captured column labels and rows were wrapped in QoreDB's `QueryResult` interface, with fixed type/nullability/timing metadata. **Node 26.12.0** imported the untouched TypeScript module directly.

| Query-result field | Internal diff | Exported metadata |
| --- | --- | --- |
| `status`: `paid` → `unpaid` | `modified` | `_status="modified"`; occurrence `_key` retained |
| `_status`: `paid` → `unpaid` | `modified` | `_status={"old":"paid","new":"unpaid"}` |
| `_key`: unchanged `customer-A` | `unchanged` | `_key="customer-A"` |

For the second pair, the queries are:

```sql
SELECT 1 AS id, 'paid' AS _status;
SELECT 1 AS id, 'unpaid' AS _status;
```

Comparison uses `id` as the selected key. The internal diff and aggregate counts stay correct; the exported row loses its computed status. The third pair similarly replaces the occurrence key. All three comparisons return `incomplete=false`; that flag describes comparison warnings.

Source: [`diffUtils.ts`, lines 290–325](https://github.com/QoreDB/QoreDB/blob/67108c1af57de5ec0ae363f20e1e1779b6137b3d/src/lib/diffUtils.ts#L290-L325). The inspected [download/copy handlers](https://github.com/QoreDB/QoreDB/blob/67108c1af57de5ec0ae363f20e1e1779b6137b3d/src/components/Diff/DiffToolbar.tsx#L56-L85) pass this exporter output directly.

## Reproduce

From this directory, load the external upstream module into a temporary file:

```sh
curl --fail --location \
  https://raw.githubusercontent.com/QoreDB/QoreDB/67108c1af57de5ec0ae363f20e1e1779b6137b3d/src/lib/diffUtils.ts \
  --output diffUtils.ts
python3 make_fixtures.py
node --experimental-strip-types replay.mjs ./diffUtils.ts
```

The script asserts the ordinary-column control and both observed metadata collisions, then records [the full result](result.json). The bundled [fixtures](fixtures.json) can also be replayed directly. These checks exercise native SQL and the original JavaScript module; desktop/Tauri/IPC integration is a separate scope.

A focused fix should keep result fields and computed row metadata independently addressable. The maintainer decides the export-format contract before a patch.

## Licensing

The independent fixtures, replay and write-up are MIT, under this repository's [license](../../LICENSE). The externally loaded QoreDB module remains under its [BUSL-1.1 license](https://github.com/QoreDB/QoreDB/blob/67108c1af57de5ec0ae363f20e1e1779b6137b3d/LICENSE-BSL); this recipe uses it for non-production testing. An upstream Premium test/fix would follow QoreDB's existing SPDX and licensing conventions.
