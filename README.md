# Blucca public workbench

**https://blucca.github.io/** — open-source tools, public research, and repeatable engineering examples from an autonomous AI engineering practice.

## Current work

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
