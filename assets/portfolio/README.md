# Blucca portfolio images

Product screenshots and original engineering covers prepared on October 6, 2026. These images illustrate self-initiated work and independent demonstrations.

| Image | Source and state |
|---|---|
| `flowdelta-app.png` | [FlowDelta](https://blucca.github.io/flowdelta/?demo=swiftia), the historical Swiftia comparison. Acceptance plan starts Not run. |
| `swiftia-runtime.png` | Page 4 of the [service sample](https://blucca.github.io/flowdelta/examples/service-sample.html), summarizing the October 5 isolated n8n run. [Runnable source and results](https://github.com/blucca/flowdelta/tree/main/examples/runtime-checks). |
| `arc-reconciler.png` | [Arc Receipt Reconciler](https://blucca.github.io/arc-receipt-reconciler/), after Load synthetic example. All displayed amounts are fabricated test data. |
| `blucca-website.png` | [Blucca's own business website](https://blucca.github.io/), desktop viewport. |
| `document-approval-gate.png` | Original 1200 × 900 illustration of the [Document Approval Gate](https://github.com/blucca/document-approval-gate). The [recorded run](https://github.com/blucca/document-approval-gate/blob/main/examples/observed-results.json) contains 12 passed scenarios on real PostgreSQL 18.6 with a synthetic ERP. The lost-response example recorded two HTTP attempts and one simulated business write. |
| `n8n-check-silent-filter.png` | Original 1400 × 1050 illustration of the [silent-filter regression](https://github.com/blucca/n8n-check/tree/main/examples/silent-filter). Synthetic 9-row input; real n8n 2.41.7 execution succeeds in both versions. Exact output checks observe 0 of 8 intended rows with the old filter and all 8 after the fix. Editable source: `n8n-check-silent-filter.html`. |
| `hubspot-company-link.png` | Original 1200 × 900 illustration of the [Company Report Link card](https://blucca.github.io/examples/hubspot-company-link/). Inputs and report URL are synthetic. [Source and test scope](https://github.com/blucca/blucca.github.io/tree/main/examples/hubspot-company-link): 9 passed checks using real HubSpot SDK components, its synthetic renderer and stubbed CRM responses; TypeScript passed. Installation and destination navigation belong to customer-environment acceptance. |

The Swiftia workflow portions are derived from MI's MIT-licensed work, copyright 2025 MI; [source and license](https://github.com/blucca/flowdelta/tree/main/examples/public-cases). Application design, tooling and the written analysis are Blucca's work. n8n and Arc are the respective third parties' names.

The two engineering covers use Blucca's original layout and schematic graphics. They are labeled illustrations and engineering samples. The report card shows a generated URL with an encoded email plus sign and a leading-zero company ID. HubSpot is the respective third party's name.

Editable cover source: [`engineering-covers.html`](engineering-covers.html). Render `#approval` or `#report` in Chromium at a 1200 × 900 viewport, device scale factor 1, and capture the viewport as PNG. Fonts use Arial/Helvetica with system fallbacks. The source is self-contained.

You may reproduce these images to describe the linked work, with a source link and the example/synthetic labels preserved.
