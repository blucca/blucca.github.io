# Bridgebill

**Two screening slots. One new audience.**

A planning study for small arts venues: choose two separately ticketed films that connect regular cinema-goers with a book club or music community the venue already knows.

**Available now:** an editable [screening budget](screening-budget.csv), a sourced [12-film working shelf](film-shelf.csv) and a [distributor enquiry brief](booking-request.md). The Qloo-powered programming agent is in research and API-access preparation.

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

## A working shelf, with a route to the next question

This research pool mixes city life, literary discussion, concerts and stage performance. Each audience comparison will use the complete pool. The source manifest includes directors, edition notes and enquiry status; [download the CSV](film-shelf.csv) to work with your own shortlist.

| Film / official identity source | Year | Planning minutes | Enquiry destination |
| --- | ---: | ---: | --- |
| [La Haine](https://www.bfi.org.uk/bfi-film-releases/la-haine-30th-anniversary) | 1995 | 98 | [BFI Distribution](https://www.bfi.org.uk/form/bfi-distribution-enquiry) |
| [Network](https://parkcircus.com/film/102251-Network) | 1976 | 122 | [Park Circus](https://parkcircus.com/form) |
| [Daisies](https://www.secondrundvd.com/release_daisiesBD.html) | 1966 | 76 | [Second Run — rights referral](https://www.secondrundvd.com/contact_mailinglist.php) |
| [Before Sunrise](https://parkcircus.com/film/109869-Before-Sunrise) | 1995 | 101 | [Park Circus](https://parkcircus.com/form) |
| [Bright Star](https://parkcircus.com/film/117306-Bright-Star) | 2009 | 119 | [Park Circus](https://parkcircus.com/form) |
| [Wings of Desire](https://www.bfi.org.uk/film/d9c6238e-5b38-58ff-b7f7-5e0a85ffd3b5/wings-of-desire) | 1987 | 128 | [Curzon Film](https://film.curzon.com/about/) |
| [Inside Llewyn Davis](https://parkcircus.com/film/114676-Inside-Llewyn-Davis) | 2013 | 104 | [Park Circus](https://parkcircus.com/form) |
| [The Red Shoes](https://parkcircus.com/film/104483) | 1948 | 135 | [Park Circus](https://parkcircus.com/form) |
| [Singin' in the Rain](https://parkcircus.com/film/115238-Singin%27-in-the-Rain) | 1952 | 103 | [Park Circus](https://parkcircus.com/form) |
| [The Last Waltz](https://parkcircus.com/film/101829-The-Last-Waltz) | 1978 | 117 | [Park Circus](https://parkcircus.com/form) |
| [Cabaret](https://whatson.bfi.org.uk/Online/default.asp?BOparam%3A%3AWScontent%3A%3AloadArticle%3A%3Apermalink=cabaret-2026) | 1972 | 123 | [Park Circus](https://parkcircus.com/latest/P2812-movie-musicals-collection) |
| [Chicago](https://parkcircus.com/film/107444-Chicago) | 2002 | 113 | [Park Circus](https://parkcircus.com/form) |

Planning durations belong to the editions named in [coverage-input.json](coverage-input.json). Daisies uses Second Run's Blu-ray identity record and starts with a UK public-screening rights referral. Wings of Desire uses BFI's title duration and Curzon's dedicated screening-enquiry route. The distributor's supplied copy fixes the final running time and format.

Each film needs its own venue/date/territory approval and written quotation. The £93 / 35% worksheet example comes from Filmbankmedia's separate tariff. Enter the selected film's actual terms when its distributor replies.

**Take the next step:** copy the [booking enquiry](booking-request.md), add your venue, date, seats, ticket price and supported format, then use the film's enquiry destination. Its reply table brings the quote, version, reporting deadline and remaining question back into your plan.

## The cultural decision

The proposed agent works with **8–12 films the programmer has shortlisted** and two sets of cultural anchors:

1. Films the venue's regular audience has enjoyed.
2. Books or artists actively selected by a partner book club or music community.

Qloo resolves the entities and ranks the same film shortlist against each set of anchors. Two rank columns make a potential bridge visible. Film availability, running time, licence quotes and the worksheet determine which pair fits the two screening slots.

The programmer can lock one film, change the partner's anchors or update a quote. The next result keeps those choices and produces a two-screening brief: cultural rationale, per-event numbers, remaining quote questions and booking / partner-invitation drafts.

Qloo affinity and shortlist rank describe cultural alignment. Ticket scenarios, costs and licensing status retain their own named inputs. The planned public demo uses fictional venue operations, with real Qloo calls served from a private backend.

### Fixed inputs for the first live coverage check

The fictional scenario uses three declared-taste groups. [The input manifest](coverage-input.json) links every anchor to an official film, publisher or artist source.

| Group | Three example anchors |
| --- | --- |
| Regular cinema audience | Amélie; Cinema Paradiso; The Grand Budapest Hotel |
| Partner book club | Mrs Dalloway — Virginia Woolf; White Teeth — Zadie Smith; Norwegian Wood — Haruki Murakami |
| Alternative record-shop partner | Talking Heads; David Bowie; Nina Simone |

Book identity uses title and author; the linked Penguin pages describe their individual editions. The communities and their selections are fictional demonstration inputs.

The [stdlib probe](probe_qloo.py) prepares 21 entity searches and three shortlist-ranking requests. With Python 3.9+, `QLOO_API_KEY` set in the environment and `PRIVATE_QLOO_DIR` pointing to a private directory outside the published repository:

```sh
python probe_qloo.py check
python probe_qloo.py search --out "$PRIVATE_QLOO_DIR"
```

Inspect the saved search responses. Match films by title, year and director, books by title and author, and artists by their official identity. Fill `entity-ids.json` with the chosen Qloo UUIDs; unresolved films retain `null`.

```sh
python probe_qloo.py insights --out "$PRIVATE_QLOO_DIR" \
  --ids "$PRIVATE_QLOO_DIR/entity-ids.json"
```

The three requests hold `filter.results.entities` fixed and change `signal.interests.entities`. `bias.trends=off` keeps the comparison focused on the chosen anchors. Successful responses are reused while their request parameters match; changed inputs use a fresh output directory. Raw responses and resolved identity maps stay in that private directory.

**Pass conditions, set before live calls:**

1. At least 10 of the 12 films have reviewed identities; all nine anchors resolve in their intended domains.
2. All three responses contain at least 10 common, unique shortlisted films with finite affinity scores in the documented 0–1 range. Returned IDs stay within the requested shortlist.
3. Switching the book club to the record shop changes the partner's top-three membership through a strict score ordering. Boundary ties are recorded separately.

Save the returned ranks, scores and missing entities alongside the inputs. A failed first pass gets one documented revision of the shelf or anchors. A second failed pass ends this product slice's build attempt. The next application milestone depends on a successful live check.

**Current evidence:** public-source identities and local input/query-shape checks are complete; live Qloo calls: **0**. Request fields follow [Search Entities](https://docs.qloo.com/reference/get-search) and the [movie parameter guide](https://docs.qloo.com/reference/available-parameters-by-entity-type).

## Why this workflow

- [ICO Cinema Programming](https://www.independentcinemaoffice.org.uk/cinema-programming/) provides paid programming, distributor liaison and marketing support to cinemas, mixed arts venues and festivals. This is an existing professional workflow.
- [ICO's community-cinema programming guide](https://www.independentcinemaoffice.org.uk/advice-support/screening-films-in-community-cinemas/programming/) starts with listening to existing audiences and expands through programming breadth, events and community relationships.
- [Filmbankmedia's public pricing](https://www.filmbankmedia.com/pricing/), checked 14 October 2026, lists indoor ticketed screenings for 51–100 seats at £93 or 35% of box office, whichever is greater, excluding VAT. Its licensing product and the distributor's actual quote define applicability.
- [Qloo's entity-type parameter guide](https://docs.qloo.com/reference/available-parameters-by-entity-type) documents movie shortlist filtering with `filter.results.entities` and cultural anchors with `signal.interests.entities`.

The field question for programmers: **what would you need to change before this brief could enter an actual booking conversation?**

Research and worksheets by Codex / GPT-6 Astra for [Blucca](https://github.com/blucca), 14 October 2026. The original writing, source manifest, worksheets and code in this folder are released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Linked sources retain their respective terms.
