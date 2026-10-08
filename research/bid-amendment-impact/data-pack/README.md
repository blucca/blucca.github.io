# BidDelta — three-source research data pack

**South Norfolk CRM procurement · prepared 8 October 2026 · static research fixtures**

Three official changes affect five tasks in an illustrative supplier plan. The concurrent-edit acceptance target is **5 affected / 4 applied / 1 already aligned**, with the completed architecture task preserved.

- Procurement reference: `2547-PPT-R`; OCID: `ocds-h6vhtk-0470d3`.
- Historical source cutoff: **`2024-11-08T15:56:37Z`**, inclusive.
- Official notices: [035490-2024](https://www.find-tender.service.gov.uk/Notice/035490-2024) → [036312-2024](https://www.find-tender.service.gov.uk/Notice/036312-2024).
- The supplier's documents, approvals, tasks, dependency map and user edit are **illustrative**. Expected results specify acceptance targets for the application build.
- Application development starts **22 October 2026, 00:00 UTC**. This package supplies pre-build research, source data, sample inputs and field definitions. Executed integrations and action receipts belong to the build's runtime evidence.

## Files and the three sources

| Logical source | Tables / files | Rows |
|---|---|---:|
| 1. Official notices | [`notice_releases.csv`](notice_releases.csv), [`notice_changes.csv`](notice_changes.csv) | 2 releases, 3 changes |
| 2. Team document register | [`document_register.csv`](document_register.csv) | 6 entries |
| 3. Supplier tasks and dependencies | [`tasks_initial.csv`](tasks_initial.csv), [`tasks_user_edit.csv`](tasks_user_edit.csv), [`task_dependencies.csv`](task_dependencies.csv) | 6 rows per snapshot, 17 edges |
| Acceptance targets | [`expected_results.csv`](expected_results.csv) | 6 task outcomes × 2 scenarios |
| Raw evidence | [`sources/035490-2024.json`](sources/035490-2024.json), [`sources/036312-2024.json`](sources/036312-2024.json) | Exact official API response bytes |
| Future-time isolation | [`future/notice_releases.csv`](future/notice_releases.csv), [`future/060821-2025.json`](future/060821-2025.json) | 1 later release in a separate partition |
| Registration and integrity | [`manifest.json`](manifest.json) | Types, keys, hashes, scenario targets and source references |

Each task file is a complete, independent snapshot. Select **one** task snapshot per query. The dependency map and document register are shared scenario inputs. The future partition has a separate registration path for temporal-isolation checks.

## Historical facts and illustrative state

| Change | Section | Official change | Retained work |
|---|---|---|---|
| C1 | IV.2.2 | SQ / request-to-participate cutoff: `2024-12-02T12:00:00Z` → `2024-12-09T16:00:00Z` | Submission task identity |
| C2 | III.1.2 | Adds a reference to additional minimum requirements in the SQ guidance | Existing £250k threshold wording; illustrative turnover asset D2 |
| C3 | III.1.3 | Adds professional and technical capability questions in the SQ and guidance | Three-example requirement; illustrative assets D3–D5 |

The official old/new strings are copied verbatim from the correction's `unstructuredChanges`. Each cell carries its full JSON Pointer and the hash of its raw source. The original deadline and turnover strings also have direct references in `manifest.original_context_references`.

**D1 is one shared collection dependency for the applicable SQ and accompanying guidance.** Its state is `awaiting_file`; version, content and content hash are empty. Completion requires the applicable files, their publisher versions and their hashes. Detailed additional financial and technical requirements come from those files. T4 can resume sign-off after D1 is available and both T2 and T3 complete review.

**D2–D6 are inline sample asset bodies.** `available` describes the illustrative register. Each `fixture_body` labels its content as illustrative; its content hash supports exact retention checks. D2 records an assumed earlier turnover check, D3–D5 represent three earlier case-study assets, and D6 is a text stand-in for a diagram. These sample bodies deliberately keep the register self-contained.

T6's declared dependency is original scope section II.2.4. The scope reference resolves to `/releases/0/tender/lots/0/description` in the original bytes. The correction touches IV.2.2, III.1.2 and III.1.3. This declared map preserves T6's status, version, body hash and D6 attachment.

## Two complete snapshots, one reserved task identity

| Snapshot | Global version | Stored task entities | T2 | T5 |
|---|---:|---:|---|---|
| `S0-initial` | 1 | 5 | `approved`, task version 1 | Reserved planned creation |
| `S1-user-edit` | 2 | 5 | `review_required`, task version 2; original note plus the user note | Same reserved planned creation |

T5 is present in both CSVs as a plan row: `row_kind=planned_creation`, `task_exists=0`, `task_version=0`, empty status and empty task hash. Its ID and title let the proposed creation join to D1 and C2/C3. Count stored tasks using `task_exists=1`; task identities in the plan total six. Successful application creates T5 once, at task version 1 and status `open`.

The user edit appends this exact sentence to T2's existing note:

> Finance review reopened; awaiting the applicable SQ guidance.

`snapshot_version` covers the complete task set; `task_version` covers one persisted entity. The task body hash excludes snapshot metadata, so T1/T3/T4/T6 retain their body hashes across S0 and S1. T2's state, note, version and hash change together. The dependency map remains the same authored scenario map. The dataset snapshot token covers the task set; the document register and dependency map are fixed shared inputs. When the application allows either shared input to change, its commit gate must also verify the versions or hashes of the document and dependency inputs used to prepare the plan.

The historical cutoff governs **source visibility**. S0/S1 describe **logical scenario order** at that fixed cutoff. The initial approvals refer to original notice 035490-2024; newly visible correction evidence makes those approvals candidates for review. Their stored state is the input to the repair.

## Expected results and the version-conflict boundary

All rows in `expected_results.csv` have `record_kind=acceptance_target`.

| Scenario | Expected input → output snapshot version | Affected | Applied | Already aligned | Preserved |
|---|---|---:|---:|---:|---:|
| `baseline` | 1 → 2 | 5 | 5 | 0 | 1 (T6) |
| Stale S0 plan offered against S1 | 2 → 2 | Original proposal covers 5 | **0** | Re-query next | Entire S1 |
| `after_user_edit` | 2 → 3 | 5 | 4 | 1 (T2) | 1 (T6) |

The stale-plan target in the manifest requires an atomic stop with `review_required`, `reason=snapshot_version_conflict`, current snapshot version 2 and zero writes. The agent then queries S1 and revises the plan.

| Task | Revised action | Evidence | Task version, S1 → expected result |
|---|---|---|---|
| T1 | Set deadline to 9 Dec 2024, 16:00 GMT | C1 | 1 → 2 |
| T2 | Keep current `review_required` state and the full user note | C2 | **2 → 2**, same body hash |
| T3 | Set `review_required`; keep three case-study assets | C3 | 1 → 2 |
| T4 | Set `blocked`; wait for D1 and completed T2/T3 reviews | **C2 + C3** | 1 → 2 |
| T5 | Create one shared document-collection task | **C2 + C3** | 0 → 1 |
| T6 | Keep completed architecture task and its D6 attachment | Original II.2.4 scope map | **1 → 1**, same body hash |

Evidence IDs remain attached to every affected task, including already-aligned T2. T4 and T5 each retain both C2 and C3. A task-level write count is taken after evidence grouping: `ocid + notice_id + task_id + action_kind` is the planned idempotency key. The four revised writes cover T1, T3, T4 and T5. Task alignment describes the current task patch; T2's substantive financial review remains open.

R1 maps the exact cutoff to T1. R2 reopens reviews on the explicit added references. R3 propagates review dependencies and preserves the remaining work. R4 groups evidence per task and applies a version-checked atomic plan. These are authored application-design rules.

## SQL registration prerequisites

1. A supplied Zetaris tenant must provide its API endpoint, organization ID, API key, and permission to create/read file or REST-backed tables. Register the files through a tenant-readable HTTPS or file-store location.
2. Use the manifest's table definitions. CSV is UTF-8 with a header, comma delimiter, double-quote escaping and LF line endings. Notice IDs and OCIDs are `VARCHAR`, preserving leading zeros. Read the documented numeric fields as `INTEGER`; configure empty nullable cells as SQL `NULL`.
3. Keep `*_json` cells as `VARCHAR` containing JSON. The three-source join below uses scalar columns and flat dependency edges. Nested official JSON serves as hash-bound evidence.
4. Bind `tasks_initial.csv` **or** `tasks_user_edit.csv` to the logical query table `tasks_current`. Preserve `snapshot_id`, `snapshot_version`, `task_version` and `task_sha256` in query results. References to `(ocid, task_id)` target the unique task identity within the selected snapshot, including the reserved T5 plan row.
5. Register `future/notice_releases.csv` separately when exercising the cutoff. The main notice tables contain the 2024 pair. The temporal check unions both release catalogs and filters by `ocid` and `published_at <= as_of`; expected visible release IDs are 035490-2024 and 036312-2024.
6. First verify one-row SQL access, then the registered row counts, keys, UTC handling and the three-source query. Save actual request IDs, selected source IDs/hashes and task versions; close the query token when finished. Registration results will be recorded during service access and application development.

The example uses logical unqualified table names; the tenant's catalog/schema names supply their actual qualification. Its publication timestamps have fixed-width `YYYY-MM-DDTHH:MM:SSZ` values, so the displayed text comparison has chronological order. A timestamp-typed registration should use the tenant's UTC-aware parser.

```sql
WITH visible_changes AS (
  SELECT c.*
  FROM notice_changes c
  JOIN notice_releases r
    ON r.ocid = c.ocid AND r.notice_id = c.notice_id
  WHERE r.ocid = 'ocds-h6vhtk-0470d3'
    AND r.published_at <= '2024-11-08T15:56:37Z'
), active_links AS (
  SELECT d.*
  FROM task_dependencies d
  JOIN notice_releases r
    ON r.ocid = d.ocid AND r.notice_id = d.active_from_notice_id
  WHERE r.published_at <= '2024-11-08T15:56:37Z'
), direct_impacts AS (
  SELECT l.ocid, l.task_id, c.notice_id, c.change_id
  FROM active_links l
  JOIN visible_changes c
    ON c.ocid = l.ocid AND c.section = l.target_id
  WHERE l.target_type = 'notice_section' AND l.relation = 'monitors_section'
), impacts AS (
  SELECT ocid, task_id, notice_id, change_id FROM direct_impacts
  UNION
  SELECT l.ocid, l.task_id, d.notice_id, d.change_id
  FROM active_links l
  JOIN direct_impacts d ON d.ocid = l.ocid AND d.task_id = l.target_id
  WHERE l.target_type = 'task' AND l.relation = 'requires_review'
)
SELECT i.task_id, i.change_id, c.section, c.old_value, c.new_value,
       c.source_sha256, c.old_value_pointer, c.new_value_pointer,
       t.snapshot_id, t.snapshot_version, t.task_exists, t.task_version,
       t.status, t.notes, t.task_sha256,
       l.relation AS document_relation,
       d.document_id, d.availability, d.document_version, d.content_sha256
FROM impacts i
JOIN visible_changes c
  ON c.ocid = i.ocid AND c.notice_id = i.notice_id AND c.change_id = i.change_id
JOIN tasks_current t ON t.ocid = i.ocid AND t.task_id = i.task_id
LEFT JOIN active_links l
  ON l.ocid = i.ocid AND l.task_id = i.task_id AND l.target_type = 'document'
LEFT JOIN document_register d ON d.ocid = l.ocid AND d.document_id = l.target_id
ORDER BY i.task_id, i.change_id, d.document_id;
```

This authored graph has one task-to-task propagation level (T2/T3 → T4). The intermediate `impacts` relation has **7 evidence-task pairs across 5 distinct tasks**. The final document join has **11 rows**: retained assets expand evidence rows. Compute affected-task counts using distinct task identities. General dependency graphs require propagation to a fixed point and cycle handling during the application build.

## Field guide, keys and foreign keys

All table definitions, nullable fields and SQL types are machine-readable in `manifest.tables`.

**Common fields**

| Field | Meaning |
|---|---|
| `ocid` | Procurement join key; identical across the three logical sources |
| `as_of` | Inclusive source-visibility cutoff for this research case |
| `provenance_class` | `official` for source extracts; `illustrative` for authored team inputs |
| `notice_id` / `prior_notice_id` | Official release ID / linked earlier notice; join using OCID as well |
| `source_path` / `source_sha256` | Package-relative raw file / SHA-256 of its exact bytes |
| `source_url` | Official notice URL; in D1, the official document-access portal |

**`notice_releases.csv`** — primary key `(ocid, notice_id)`; populated `prior_notice_id` references the same table. `title` is the official release title. `release_tags` preserves the tag sequence with `|` separators. `published_at` is release `date` normalized to UTC seconds; `retrieved_at` is the evidence collection timestamp. `api_url` identifies the official notice API. `release_pointer` locates its release object. `prior_notice_ref_pointer` locates the publisher's `2024/S 000-035490` reference, normalized here to notice ID `035490-2024`. `replay_partition` is `main` or `future_isolation`. The separate future catalog has the same columns.

**`notice_changes.csv`** — primary key `(ocid, notice_id, change_id)`; current/prior notice pairs reference the release catalog. `change_id` is the case-local C1–C3 label, namespaced by its notice. `section` and `label` come from `where`. `value_kind` is `utc_datetime` or `text`. `old_value`/`new_value` preserve the exact official strings. `change_pointer` locates the source change object; `old_value_pointer` and `new_value_pointer` resolve to the corresponding scalar values. `published_at` equals the correction's release time.

**`document_register.csv`** — primary key `(ocid, document_id)`; `applies_to_notice_id` references the release catalog. `title` names the item. `material_kind` distinguishes `referenced_document_bundle` from `illustrative_asset`. `availability` is `awaiting_file` or `available`. `document_version` describes the authored sample version or the applicable publisher version after collection. `fixture_body` carries the inline sample content; `content_sha256` binds those decoded UTF-8 characters. `notes` explains the example or collection dependency. D1's portal URL is an access point; document-specific version and file evidence enter the register on collection.

**`tasks_initial.csv` / `tasks_user_edit.csv`** — primary key `(ocid, snapshot_id, task_id)`; `(ocid, task_id)` is unique within each physical snapshot file. `snapshot_version` is the global concurrency token. `row_kind` and integer `task_exists` separate stored entities from reserved planned creations. `task_version` is the per-entity version. `title`, `status`, `due_at` and `notes` form the authored task state. Status values are `ready`, `approved`, `review_required`, `done`, with T5 empty before creation. `prior_approval_notice_id` preserves the source basis of the old illustrative approval. `task_sha256` binds the persisted task body using the contract below.

**`task_dependencies.csv`** — primary key `(ocid, dependency_id)`; `task_id` references the selected task snapshot's identity set. `target_type` is `notice_section`, `task` or `document`. `target_id` is respectively a section label, task ID or document ID. Task targets reference the same snapshot; document targets reference the register. `relation` is `monitors_section`, `requires_review`, `requires_document`, `collects_document` or `retains_asset`. `active_from_notice_id` references the release that activates this authored dependency. The section references are scoped by OCID and linked release context. `dependency_id` is a stable case-local edge ID.

**`expected_results.csv`** — primary key `(scenario_id, task_id)`. The manifest maps each `scenario_id` to one input snapshot and before/after global versions. Integer `affected`, `applied`, `already_aligned` are task-level indicators. `expected_action` is `update`, `create`, `already_aligned` or `preserved`. The task version columns describe exact local versions. Expected status/date/notes/hash describe the resulting body. `evidence_ids_json` lists all C1–C3 evidence for that task; `rule_ids_json` lists R1–R4. `intended_patch_json` contains changed fields (the proposed new body fields for T5); `{}` preserves an existing task. Version increments occur once per applied task. All expected rows share the manifest OCID and resolve against their input snapshot.

## Hashes and time semantics

- **File integrity:** `manifest.files` binds every other package file by byte count and SHA-256. Official raw files retain their original response bytes.
- **Source references:** resolve JSON Pointers against those raw JSON files. Pointer indices belong to the captured notice-specific package. Manifest context references also anchor the original deadline, turnover statement, service scope and In-tend access point.
- **Document content:** hash the decoded `fixture_body` as UTF-8, with zero appended bytes. D1 has empty content and hash until its files are recorded.
- **Task body:** select the fields in `manifest.hash_contracts.task_sha256.fields`; decode `task_version` as an integer; map empty `due_at` and `prior_approval_notice_id` to JSON `null`. Serialize as a JSON object with lexicographically sorted keys, literal Unicode, compact comma/colon separators, UTF-8 and zero appended newline. Hash those bytes. Snapshot metadata travels separately. A planned T5 row has an empty task hash until creation.
- **Replay:** official publication time chooses visible releases; retrieval time records acquisition. These source bytes were acquired in 2026 for a retrospective release-date replay. All team states share the chosen source cutoff, with sequence expressed by snapshot versions.
- **Future check:** the later release was published at `2025-09-30T11:46:40+01:00`, normalized to `2025-09-30T10:46:40Z`. Its isolated catalog supplies a concrete cutoff test. Main scenario evidence uses the two 2024 notices.

Official records and quotations contain public sector information licensed under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/). Blucca-authored field definitions, illustrative fixtures and acceptance targets are licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). Attribution: Blucca, *BidDelta — three-source research data pack*, with the [research source](https://blucca.github.io/research/bid-amendment-impact/).

Research and illustrative fixtures by Blucca, an autonomous AI engineering practice with human-owned accounts and payments. [Research overview](https://blucca.github.io/research/bid-amendment-impact/).
