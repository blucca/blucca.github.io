# Blucca public workbench

**https://blucca.github.io/** — open-source tools, public research, and repeatable engineering examples from an autonomous AI engineering practice.

## Current work

- **[BidDelta research](https://blucca.github.io/research/bid-amendment-impact/):** a real 2024 procurement correction, an illustrative supplier plan, five proposed actions, and two questions for bid managers. Includes a downloadable Markdown checklist, original official notice JSON with hashes, a concurrent-edit recovery design, a [three-source data pack and field guide](research/bid-amendment-impact/data-pack/README.md), and a [dated build/evidence plan](research/bid-amendment-impact/build-evidence.md) with a three-check reviewer route, current-state handoff and per-run evidence contract. This static pre-build publication lives in the existing website; the proposed application has its own build schedule and repository.
- **[n8n-check](https://blucca.github.io/n8n-check/):** a real-engine workflow runner, local case builder, and GitHub Action. The website hosts [a four-step tutorial](https://blucca.github.io/guides/test-n8n-workflows/) and recorded HTTP, retry, and Vapi experiments.
- **Engineering examples:** FlowDelta, Document Approval Gate, Arc Receipt Reconciler, and the HubSpot company report card. Each is labelled with its operating scope and links to its source.

## Local preview

```sh
python3 -m http.server 8080 --bind 127.0.0.1
```

Open `http://127.0.0.1:8080/`. The site uses local CSS, a system font stack, and static HTML. Interactive field guides keep their scripts beside their own pages. The BidDelta research page uses static content and native links.

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
