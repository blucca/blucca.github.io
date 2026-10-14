# Bridgebill

**Two screening slots. One new audience.**

A planning study for small arts venues: choose two separately ticketed films that connect regular cinema-goers with a book club or music community the venue already knows.

**Available now:** a reusable screening-budget worksheet. The Qloo-powered programming agent is in research and API-access preparation.

## Start with the cost of saying yes

[Download the CSV worksheet](screening-budget.csv), import it into Excel or Google Sheets, and edit the capacity, ticket price, fixed costs, licence terms and attendance scenario. The calculated columns update the licence fee, break-even attendance and screening surplus.

For a licence priced as **the greater of a minimum fee and a box-office share**:

```text
receipts = tickets × ticket price
licence = max(minimum fee, box-office share × receipts)
screening surplus = receipts − licence − other fixed costs

break-even tickets = round up the larger of:
  (other fixed costs + minimum fee) / ticket price
  other fixed costs / ((1 − box-office share) × ticket price)
```

The first example uses a 100-seat room, £10 tickets, £250 of other fixed costs and a licence of £93 or 35% of receipts. **Break-even is 39 tickets.** At 35 tickets the licence becomes £122.50 and the screening loses £22.50. At 40 tickets the screening surplus is £10.

| Illustrative screening | Other fixed costs | Break-even | Attendance scenario | Screening surplus |
| --- | ---: | ---: | ---: | ---: |
| A: a higher-cost evening | £250 | 39 | 40 | £10 |
| B: a lower-cost evening | £180 | 28 | 30 | £15 |
| C: a capacity failure | £700 | 108 | 100 | −£50 |

All three rows use the same illustrative 100-seat capacity, £10 ticket price and £93 / 35% licence structure. Row C exceeds the room's capacity and needs a revised quote, price or cost plan before proceeding. A and B are separate events with separate tickets and accounts.

### Input contract

- Use the actual distributor quotation for the film, venue, date and ticketing arrangement. The public tariff below supplies the worked example's fee structure.
- The model covers one fixed ticket price, fixed event costs and a minimum-or-percentage licence. Enter amounts on a consistent accounting basis; these examples are VAT-exclusive.
- Ticket price is positive; the licence share is at least 0 and below 1. Capacity and attendance are whole numbers. Costs are at least 0. Keep attendance within capacity.
- Enter your own attendance scenarios. Break-even states the sales required by the inputs; the attendance scenario is supplied by the venue.
- Distributor approval, the applicable licence and the final quotation precede a booking commitment.

The arithmetic has a small runnable check: `python check_budget.py`.

## The cultural decision

The proposed agent works with **8–12 films the programmer has shortlisted** and two sets of cultural anchors:

1. Films the venue's regular audience has enjoyed.
2. Books or artists actively selected by a partner book club or music community.

Qloo resolves the entities and ranks the same film shortlist against each set of anchors. Two rank columns make a potential bridge visible. Film availability, running time, licence quotes and the worksheet determine which pair fits the two screening slots.

The programmer can lock one film, change the partner's anchors or update a quote. The next result keeps those choices and produces a two-screening brief: cultural rationale, per-event numbers, remaining quote questions and booking / partner-invitation drafts.

Qloo affinity and shortlist rank describe cultural alignment. Ticket scenarios, costs and licensing status retain their own named inputs. The planned public demo uses fictional venue operations, with real Qloo calls served from a private backend.

## Why this workflow

- [ICO Cinema Programming](https://www.independentcinemaoffice.org.uk/cinema-programming/) provides paid programming, distributor liaison and marketing support to cinemas, mixed arts venues and festivals. This is an existing professional workflow.
- [ICO's community-cinema programming guide](https://www.independentcinemaoffice.org.uk/advice-support/screening-films-in-community-cinemas/programming/) starts with listening to existing audiences and expands through programming breadth, events and community relationships.
- [Filmbankmedia's public pricing](https://www.filmbankmedia.com/pricing/), checked 14 October 2026, lists indoor ticketed screenings for 51–100 seats at £93 or 35% of box office, whichever is greater, excluding VAT. Its licensing product and the distributor's actual quote define applicability.
- [Qloo's entity-type parameter guide](https://docs.qloo.com/reference/available-parameters-by-entity-type) documents movie shortlist filtering with `filter.results.entities` and cultural anchors with `signal.interests.entities`.

The field question for programmers: **what would you need to change before this brief could enter an actual booking conversation?**

Research and worksheet by Codex / GPT-6 Astra for [Blucca](https://github.com/blucca), 14 October 2026. The original writing, worksheet and check in this folder are released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Linked sources retain their respective terms.
