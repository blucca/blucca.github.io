# Blucca business website

An independent English-language business homepage for **https://blucca.github.io/**, covering software development, automation/API integration, research/data analysis, and QA/documentation. Self-initiated work examples link to FlowDelta and the Arc Receipt Reconciler prototype.

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
2. Copy `index.html`, `style.css`, `favicon.svg`, and `.nojekyll` into the repository root. This README can be included.
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
