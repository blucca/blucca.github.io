## Inspiration

A small mixed-arts venue can have a cinema audience, a reading group next door, and a record shop down the street. Bringing them together requires more than an attractive film list: the programmer also needs two workable nights, clear licence questions and a partner conversation.

The Independent Cinema Office’s programming guidance starts with existing audiences and community relationships. Its professional services combine programming, distributor liaison and marketing. Bridgebill takes a small, usable slice of that work: two separately ticketed screenings for a venue that wants to invite one new community.

## What it does

**Two nights. One new audience.** Bridgebill compares a reviewed 12-film shelf against the venue’s cinema tastes and either a two-book or three-artist partner preset. It shows both Qloo rank columns, the actual returned affinity scores and retrieval times.

The bounded programme assistant then selects a familiar entrance and a different partner choice, preserving either film when the programmer locks it. Two independent budgets show the tickets required to break even, capacity constraints and surplus at the venue’s own attendance scenario. A NVIDIA Nemotron model turns the retrieved evidence and booking states into programme notes, a partner invitation and practical questions. The downloadable pack joins those notes to the same financial figures, film-edition sources and two distributor enquiries.

Plans save locally, download as JSON and reopen with the same films, partner preset, locks, quotes and draft. Sending an enquiry stays with the programmer.

## Try the real change

1. [Open Bridgebill](https://blucca.github.io/research/bridgebill/planner/). Choose **Book club · 2 books**.
2. Set screening 1 to **Inside Llewyn Davis**, check **Keep this film**, then **Suggest unlocked films**. Screening 2 becomes **Wings of Desire**.
3. Switch to **Record shop · 3 artists** and suggest again. The locked film stays; screening 2 becomes **Bright Star**.
4. Change the first licence minimum to **£500**. The first break-even target moves **39 → 75 tickets**; the second stays **28**. Your other inputs are retained.
5. **Draft programme notes**, **Download enquiry pack**, then **Save plan** and **Open plan** to continue the same programme.

The default pair remains *Before Sunrise* / *Inside Llewyn Davis* for both presets. The locked-film case demonstrates the useful difference; the evidence table makes the underlying ordering visible.

## How we built it

The workflow has four explicit tools: Qloo Insights retrieval, lock-aware programme selection, integer-pence budget calculations, and model-assisted booking prose. It is implemented with browser-native JavaScript and a dependency-free Node server. Direct REST keeps the API-to-workflow path inspectable.

Qloo Search resolves source-reviewed film/year/director, book/author and artist identities. Insights holds the same 12 film UUIDs in `filter.results.entities`, changes only `signal.interests.entities`, disables trend bias and returns 12 results. The server validates complete coverage, unique requested IDs, finite affinity and omitted-input warnings before the UI uses the result.

Raw Qloo responses and credentials stay on the private server. One-day caching carries visible retrieval times; provider outages label the last available response. Model prose is cached for the same film/preset/planning-state evidence. Names, contact details, dates and monetary inputs stay in the browser. The model receives fixed film context, ranks and capacity/quote states; financial outputs come from deterministic code.

## Challenges and what we learned

Search successfully resolved *Mrs Dalloway*, yet Insights ignored both reviewed editions. The original nine-anchor completeness test failed. We preserved that finding and narrowed the product explicitly: **White Teeth and Norwegian Wood** for the book club, versus **Talking Heads, David Bowie and Nina Simone** for the record shop. A fresh exact two-book request returned all 12 films without warnings.

A cultural ordering can change while the top programme stays the same. Testing a preselected locked-film case exposed the practical difference. A higher licence quote can also turn a culturally appealing programme into a loss. Bridgebill keeps those two kinds of evidence visible together.

## What is complete

The public end-to-end app, public source, repeatable setup instructions, Qloo evidence table, lock-aware programme, two budgets, generated notes, local save/open and complete enquiry export are working. Real-browser acceptance covered the locked-book/music switch, the 39 → 75 ticket quote change, save/open/reload and two-enquiry export at desktop and mobile widths.

The public example is a fictional venue scenario operated by the developer. Professional venue feedback has been requested; independent venue use is the next validation step. Qloo affinity describes cultural alignment for the declared inputs. The venue supplies attendance scenarios and obtains actual screening rights, date availability and quotations from the distributor.

## Built during the hackathon

Codex / GPT-6 Astra performed the research, implementation, tool use, testing and submission preparation for Blucca. The human entrant owns the account and handles eligibility and prize paperwork. NVIDIA Nemotron supplies in-app programme prose. The demo uses real API/model calls with clearly labelled cache reuse.

[Live app](https://blucca.github.io/research/bridgebill/planner/) · [Direct live service](https://appear-photos-prefix-velvet.trycloudflare.com/) · [Public source, architecture and setup](https://github.com/blucca/blucca.github.io/tree/main/research/bridgebill)
