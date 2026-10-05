# Blucca business website

An independent English-language business homepage for **https://blucca.github.io/**, covering software development, automation/API integration, research/data analysis, and QA/documentation. Self-initiated work examples link to FlowDelta and the Arc Receipt Reconciler prototype. The focused service page at [`/n8n-release-checks/`](https://blucca.github.io/n8n-release-checks/) offers a $650 scoped implementation pilot with runnable fixtures, local HTTP mocks, behavior assertions, and a client handoff.

## Local preview

From this directory:

```sh
python3 -m http.server 8080 --bind 127.0.0.1
# Visit http://127.0.0.1:8080/
```

No build step, dependencies, external fonts, JavaScript, analytics, forms, or cookies. Styling and favicon are local. Navigation, contact links, and the expandable privacy note work without scripts.

## Deploy to GitHub Pages

The business homepage belongs in the **blucca/blucca.github.io** repository. This is distinct from the existing `flowdelta` and `arc-receipt-reconciler` project repositories.

1. Create or clone `blucca/blucca.github.io`.
2. Publish the repository contents, including `index.html`, `style.css`, `favicon.svg`, `.nojekyll`, and the `n8n-release-checks/` directory. This README can be included.
3. Commit and push to `main`.
4. In repository Settings → Pages, select **Deploy from a branch**, **main**, **/ (root)**, and save (or use the GitHub API/CLI equivalent).
5. Wait for the Pages deployment to finish and verify `https://blucca.github.io/` on desktop and mobile.

An account-level Pages site serves this root URL. Existing project Pages sites retain their project paths; do not copy those applications into this homepage repository or replace their repositories.

## Content conventions

- Contact: `belgialucca@gmail.com`; main contact button pre-fills a short project brief in the visitor's email client.
- Scope, delivery date, acceptance criteria, and quote are agreed by email. Payment follows scope agreement; work proceeds with customer authorization. No payment provider or activation is claimed.
- AI-led operation and human ownership of accounts/verification/payments are disclosed once in the practice section.
- Project visuals are custom SVG/CSS and an explicitly illustrative document preview, not client evidence. No client list, testimonials, or performance claims are included.
- Privacy is a native expandable section in the footer. GitHub hosting and email provider handling are explained separately from this site's no-tracking implementation.
- The site uses a system sans-serif/Georgia/monospace stack and an editorial paper/forest/terracotta palette. No remote assets required.

## n8n release-checks service page

- Reuses the homepage typography and palette, with page-specific CSS in `n8n-release-checks/style.css`.
- Pilot scope: one workflow or bounded slice of up to 25 nodes, up to two mocked HTTP integrations, eight agreed scenarios, and one revision. Delivery date and acceptance criteria are agreed by email before payment.
- JSON and JUnit reporting and agreed intermediate-node assertions are proposed pilot deliverables. The linked executed sample contains its existing JSON observations and a local synthetic-contract scope.
- The Swiftia evidence card links to `main/examples/runtime-checks` and its machine-readable observations. Existing measured results remain separate from the customer-specific work offered.
- The $149 FlowDelta documentation service remains linked as an alternative scope.
