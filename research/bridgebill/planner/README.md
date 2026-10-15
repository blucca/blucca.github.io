# Bridgebill programme worksheet

**[Open the worksheet](https://blucca.github.io/research/bridgebill/planner/)**

Two independently ticketed film screenings, one editable plan. Change the ticket price, minimum-or-percentage licence terms, event costs or your attendance scenario. The worksheet shows each screening’s break-even ticket count, capacity constraint and scenario surplus, then creates two distributor enquiries with the same figures.

The starting arts centre, dates, partner and fees are illustrative. Film identities, edition notes and enquiry routes come from the [sourced working shelf](../coverage-input.json). Cultural ranking remains a separate planned feature, subject to live Qloo validation.

## Use it

1. Select a film from the 12-title shelf, or enter your own title and planning runtime.
2. Enter the proposed date, time, seats for sale and single ticket price. Add event costs and the film’s actual licence quotation on a consistent tax and receipt basis.
3. Enter an attendance scenario. Read the ticket target and the per-screening surplus or loss. Adjust a quote to see the same plan recalculate.
4. Add venue/contact/format details and the quote or licence reference. Record the evidence you hold. Changing a film, venue, date, format, capacity or ticket price returns the affected licence status to a planning estimate for reconfirmation.
5. Download the **enquiry pack**: a self-contained HTML document with the two budgets, film sources and two draft messages to review, copy or print. **Save plan** downloads JSON; **Open plan** restores it for the next revision.

Inputs use browser local storage. **Clear saved plan** removes the local copy. Save a JSON file before moving devices or clearing site data. GitHub Pages serves the static application; venue and quotation inputs stay in the browser.

## Calculation

Amounts are integer pence. The licence is the greater of its minimum and the box-office share, with the percentage fee rounded half-up to the nearest penny. Break-even is the first whole ticket count for which receipts cover that rounded licence and the fixed costs. BigInt intermediate arithmetic preserves percentage-rounding boundaries.

The worked 100-seat example uses £10 tickets, £250 fixed costs and a £93 / 35% illustrative fee. It needs **39 tickets**; 35 tickets produce a **£22.50 loss**, and 40 produce a **£10 surplus**. Increasing fixed costs to £700 raises the target to **108 tickets**, above room capacity; selling all 100 seats leaves a **£50 loss**.

The original [CSV study](../screening-budget.csv) uses an unrounded percentage formula. The browser worksheet applies the penny-rounding convention above. Use the selected distributor’s actual tax, receipt and rounding terms for a booking.

## Run and check

From the website repository root:

```sh
python3 -m http.server 8139
# Open http://localhost:8139/research/bridgebill/planner/
node research/bridgebill/planner/budget.check.mjs
```

Static HTML, CSS and JavaScript modules; browser-native date fields, BigInt, local storage and downloads. The app reads the existing `../coverage-input.json` source manifest. A current browser is sufficient.

### Scripted acceptance, 15 October 2026

- Original 39 / 28 ticket targets, £25 combined scenario surplus; 108-ticket capacity failure and £50 loss at 100 attendees.
- A £93 → £500 minimum-fee edit changes the first target from 39 → 75 while the second stays at 28. Changed film/date details trigger quote reconfirmation; Daisies retains its rights-referral route.
- Invalid attendance clears the affected output and pauses export. Invalid plan-file import retains the current worksheet.
- JSON save/open, reload and HTML download preserve custom film, quote reference, budgets and notes. Exported text escapes entered markup; the pack contains two independent enquiries.
- Chromium 154 at 1440 px and 390 px: horizontal overflow 0, page errors 0. These observations use fictional inputs and developer-operated scripts. External venue use is tracked separately.

## Source and licence

Original worksheet, interface, code and documentation: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/), matching the parent research folder. Built by Codex / GPT-6 Astra for [Blucca](https://blucca.github.io/).

- **Londrina Solid**, Marcelo Magalhães: [Google Fonts source](https://github.com/google/fonts/tree/main/ofl/londrinasolid), SIL Open Font License in `fonts/OFL.txt`.
- **Instrument Sans**, Rodrigo Fuenzalida, Jordan Egstad: existing local website asset, SIL Open Font License in `../../../assets/studio/fonts/instrument-sans-OFL.txt`.
- Film sources retain their own terms and are linked from the shared manifest. The £93 / 35% worked fee structure comes from [Filmbankmedia’s public pricing](https://www.filmbankmedia.com/pricing/), checked 14 October 2026. Each title’s screening rights, supplied copy and commercial quotation are confirmed with its distributor.
