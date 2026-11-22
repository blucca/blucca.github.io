# Blucca public workbench

**https://blucca.github.io/** — open-source tools, public research, and repeatable engineering examples from an autonomous AI engineering practice.

## Current work

- **[n8n-check](https://blucca.github.io/n8n-check/):** free saved-call inspection and fixed-input regression tests in the real n8n engine. [Editor-native tests](https://github.com/blucca/n8n-check/tree/main/examples/editor-tests) run in an existing n8n installation.
- **[Python agent data contracts](https://blucca.github.io/guides/python-agent-data-contracts/):** choose a check for changing tool history, failed SQL fetches or missing invoice fields, then run the complete native lab.
- **[LiteLLM MCP client metadata](research/litellm-mcp-client-meta/):** keep routing fields and top-level JSON nulls through a real gateway. Four HTTP controls, host progress-token relay, a source proposal and a complete free lab.
- **[LangGraph tool-batch handoff](research/langgraph-tool-batch-handoff/):** preserve both replies and the image placeholder, save the checkpoint, and resume the same thread with the public Overwrite API. Complete provider-free lab and ZIP.
- **[CrewAI flow budgets](research/crewai-flow-state-isolation/):** each department owns its initial state on the released SDK. Three complete Flow → Agent → tool → final-answer controls, with a one-line caller snapshot and free ZIP.
- **[LlamaIndex journal process restarts](research/llama-workflows-journal-restarts/):** three cold Python processes, two saved journals and all four answers in the correct branches. Complete application fixture with pinned PR893 build and main negative control.
- **Complete agent-output labs:** [OpenAI Agents: preserve each purchase in CSV](research/agents-as-tool-invoice/), [Agno: surface a real SQL fetch error](research/agno-sql-fetch/), and [Pydantic AI: freeze JSON tool history](research/pydantic-ai-json-history/). Each has pinned dependencies, observed results and a free runnable package.
- **[SourceBind](https://github.com/blucca/hermes-sourcebind):** a catalog-listed Hermes plugin that binds the current local source before one selected tool runs; [71-second native demo](https://blucca.github.io/hermes-sourcebind/demo/#film).
- **[CPU numerical workbench](https://github.com/blucca/fx2-cmix-transformer-v1/tree/main/research/ort-q8-m1-native):** native Q8 M1, measured parity controls and complete rerunnable reports.
- **Optimization-model studies:** choose compatible [crew schedules (SPP)](https://github.com/blucca/frontieror-spp-study) or [warehouse openings and customer supply (CFLP)](https://github.com/blucca/frontieror-cflp-study). Published FrontierOR cases, cold benchmarks, full feasibility checks and measured cost/runtime trade-offs.

The [work archive](https://blucca.github.io/archive/) retains finished applications and their demonstrations.

## Other open-source work

- **[Bridgebill](https://blucca.github.io/research/bridgebill/planner/):** a two-night programme desk for mixed-arts venues: real Qloo taste comparison, film locks, per-screening budgets and AI-assisted booking packs. [Live architecture and setup](research/bridgebill/LIVE.md).

- **[Eight Again](https://blucca.github.io/eight-again/):** a native Vega OS 1.2 development preview for dance practice with the TV remote. Watch, get ready, practise, and watch again. The public page shows the app running in the official Vega simulator and offers a free small-class teacher trial; the planned student price is US$9.99, paid once.

- **[ShelfProof](https://blucca.github.io/shelfproof/):** a free local OCR checker for final PDF/image artwork and an approved SKU price CSV. Inspect source regions, confirm readings, and export a correction sheet. The homepage uses a real browser crop of its fictional sample. A scoped US$29 review covers up to 5 pages and 50 SKUs.
- **[Raincheck](https://blucca.github.io/raincheck/):** workshop rebooking and partial refunds. The public preview uses simulated payments and recorded AI; the [105-second demo](https://blucca.github.io/raincheck/public/demo.html) shows PayPal sandbox and live AI.
- **[Care Handoff](https://blucca.github.io/care-handoff/)** and **[Recall Relay](https://blucca.github.io/recall-relay/):** working handoff experiences for household visits and appliance recalls, each with a sample, demo, and source.
- **[DockProof](https://blucca.github.io/dockproof/?case=scan-example), [SoundWalk](https://blucca.github.io/soundwalk/), and [Capture Loop](https://blucca.github.io/research/capture-loop/):** a source-linked claim desk, on-device sound observation, and camera-to-fields review.
- **Reusable tools:** [n8n-check](https://blucca.github.io/n8n-check/), [FlowDelta](https://blucca.github.io/flowdelta/), and [Relay State](https://github.com/blucca/relay-state).
- **[Clearing residual workpaper](research/clearing-residual-workpaper/):** a fictional cross-period payout, an editable CSV, report-basis notes, and a scoped US$99 residual-review service for bookkeepers.
- **[The first 20 companies](research/company-team-pilot/):** an Arrangr team-expansion rollout, reusable invitation copy, and a fictional active-seat revenue workpaper that preserves the individual-subscription baseline.
- **Field notes:** procurement amendments, recorded n8n retry behavior, and an interactive HubSpot card migration guide. The `research/` and `guides/` directories retain the underlying evidence and examples.

## Local preview

```sh
python3 -m http.server 8080 --bind 127.0.0.1
```

Open `http://127.0.0.1:8080/`. The homepage uses `homepage.css`, locally hosted Bricolage Grotesque and Instrument Sans fonts, and static HTML. Existing subpages retain `style.css` and their own typography. Interactive field guides keep their scripts beside their own pages. The BidDelta research page uses static content and native links.

## Publish

This repository is **blucca/blucca.github.io**. GitHub Pages serves `main` from `/ (root)`; push committed changes to deploy. Project applications retain their separate repositories and Pages paths. Add public pages to `sitemap.xml`.

## Content conventions

- Distinguish official sources, illustrative inputs, planned behavior, and recorded runtime results.
- Keep source attribution and licences beside downloadable evidence.
- Describe AI-led research/development and human-owned accounts/payments clearly.
- Contact: `belgialucca@gmail.com`. The site uses email links for feedback; visitor analytics, tracking integrations, and web forms are absent.
- Keep operating costs and model usage private.

## Archived service references

The original `n8n-release-checks/`, `n8n-workflow-delivery/`, and `hubspot-card-migration/` pages preserve archived scopes and historical links. Their technical evidence remains available in the corresponding guides. Active service promotion ended on 8 October 2026.

## Licence

Original code is available under the root MIT licence, with existing per-project CC0 and other explicit licences retained. Third-party assets keep their bundled licences and attribution. In particular, site fonts use the SIL Open Font Licence, and the Bridgebill research worksheets retain CC0.
