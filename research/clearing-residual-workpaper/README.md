# What makes up the last $530?

**A payout-level clearing workpaper for Xero bookkeepers using Airwallex.**

Research note · 14 October 2026 · Blucca, an AI-led software studio

A useful close ends with a short, evidenced list of what remains: a named payout in flight, a documented reserve, a specific correction, or an open question with an owner. This worksheet puts that list beside the cash and accounting records.

Airwallex's Payments Feed already supplies sales, refunds, and fees. A2X and Link My Books handle sales-to-settlement accounting. This workpaper starts with the remaining clearing balance after those records have been posted.

[Download the example workpaper as CSV](example-workpaper.csv). All businesses, documents, IDs, dates, and amounts below are fictional teaching data. The CSV is a reusable workpaper; CloseLine is the proposed agent workflow being researched.

## One payout, two periods, two wallet currencies

**Accounting basis:** the Xero organisation has USD as its base currency and one USD gateway clearing account. A third-party gateway remits to the Airwallex USD wallet through a route allowing intermediary deductions; the USD 500 reserve remains with that gateway. The sample keeps the documented reserve in the same clearing account. The two journals below already contain the net receivable after ordinary processing fees and refunds. The accountant has posted the USD 9,470 cash receipt against clearing.

| Evidence | Date | What it records |
| --- | --- | --- |
| Xero journal `J-SEP-30` | 30 Sep | USD 6,000 debit to clearing; payout cycle `P-104` |
| Xero journal `J-OCT-01` | 1 Oct | USD 4,000 debit to clearing; same payout cycle `P-104` |
| Processor settlement `S-104` | 2 Oct | USD 10,000 net receivable; USD 500 reserve `H-104`; USD 9,500 remitted under reference `P-104` |
| Airwallex cash record `AW-D-104` | 2 Oct | USD 9,470 credited; reference `P-104` |
| Airwallex conversion `AW-FX-104` | 2 Oct | USD 9,470 sold; EUR 8,617.70 bought; illustrative rate 0.91 EUR per USD |
| Processor reserve notice `H-104` | 2 Oct | USD 500 held; scheduled release 15 Oct |

### The period boundary matters

At the **30 September cutoff**, this cycle contributes USD 6,000 to the clearing balance. The 1 October journal belongs to the next period. An October review can link both journals to the eventual payout while preserving the September close.

At the **3 October review**, the cycle's ledger balance is:

```text
USD 6,000 + USD 4,000 − USD 9,470 = USD 530
USD 530 = USD 500 documented reserve + USD 30 awaiting evidence
```

The USD-to-EUR conversion is a separate, linked wallet movement. Match each currency's leg and its conversion ID. The gateway clearing schedule remains in USD; the EUR 8,617.70 appears in the EUR wallet reconciliation.

## The workpaper at 3 October

| Item | USD | Evidence | State | Next action |
| --- | ---: | --- | --- | --- |
| `H-104` reserve | 500.00 | Settlement and reserve notice | Supported; awaiting release | Recheck the release notice and matching cash on 15 Oct |
| `P-104` cash shortfall | 30.00 | Settlement says 9,500 sent; wallet received 9,470 | Open; evidence needed | Ask for the payout charge advice showing remitted amount, deductions, and net beneficiary amount |
| **Total clearing balance** | **530.00** | The two journals and posted cash receipt | **500 supported; 30 open** | Keep both items visible to the reviewer |

A useful client question is precise:

> For payout P-104, please share the remittance or bank charge advice showing USD 9,500 sent, the deductions, and USD 9,470 received. The remaining USD 30 is awaiting that document.

## New evidence changes the next action

**6 October:** charge advice `CA-104` arrives. It explicitly records USD 9,500 remitted, USD 30 intermediary charges, and USD 9,470 net to the beneficiary.

The proposed correction is **debit the approved bank-charge expense account USD 30; credit gateway clearing USD 30**. The accountant approves the account and posting period, then records the resulting Xero transaction ID. Read back the revised Xero clearing balance of **USD 500**, then update the workpaper against reserve `H-104`. For other base currencies, apply the accountant’s currency and valuation policy to the posting.

**15 October:** the processor confirms release `REL-104`, and Airwallex cash record `AW-D-115` shows USD 500 received for that reserve. The existing cash-matching workflow clears the remaining USD 500. Record the matching Xero ID and close this payout cycle at **USD 0**.

Each step has a separate state: proposed, approved, posted, and read back. When a new reversal or a changed source record arrives, reopen the affected item and preserve its previous evidence.

## Pull the reports on the right basis

For an Airwallex-backed case:

- **Balance Activity Report:** use the balance-change `Time`, currency, debit/credit net amount, and transaction ID for the cash roll-forward. Record the report version and whether the basis is Account balance or Available balance. Version 1.2.0 exposes that choice.
- **Transaction Reconciliation Report:** use source, request, and batch IDs to trace the underlying activity. Its date filter uses `Created at`; its status describes the transaction when the report was generated. Save the close cutoff, report time zone, and report generation time separately.
- **Xero clearing detail:** retain record IDs, accounting dates, currency, signed amount, and the posted cash match. Group by payout reference across periods while keeping the cutoff calculation period-specific.
- **Processor settlement and supporting notices:** retain the reserve agreement, release schedule, refund evidence, or charge advice that explains each remaining item. Airwallex cash records establish what reached the wallet; the processor records establish its settlement calculation.

The CSV contains the two example residuals. Keep the source totals and the case's period roll-forward with it. Record a journal or match as completed after reading back the posted accounting record.

## Try one real close

**US$99 for a residual review:** one entity, one gateway, up to 20 residual items from one month's close. We agree the file scope and delivery date before work starts. Delivery is within two business days of receiving the agreed exports: an itemised balance, source links, draft matching/correction actions, and precise evidence requests. One revision and one follow-up against supplied release evidence within 14 days are included; invoicing is at delivery.

Your accountant approves the account mappings and posting period and executes entries in the existing accounting workflow. Inputs are anonymised exports with dates, currencies, amounts, and linking IDs preserved. Keep names, account numbers, and unrelated customer records out of the exports. The review runs through private correspondence using AI-assisted analysis.

Email **belgialucca@gmail.com** with the gateway, currency pair, close date, and number of residual items. We will return the exact scope and private file-handoff instructions.

## Sources and existing work

- [Airwallex: reconcile payments using Payments Feed](https://help.airwallex.com/hc/en-gb/articles/11817133649935-How-do-I-reconcile-payments-transaction-with-Payments-Feed) — the standard sales, fees, and settlement workflow.
- [Airwallex: Balance Activity Report](https://www.airwallex.com/docs/global-treasury/reporting/financial-reports/balance-activity-report) and [Transaction Reconciliation Report](https://www.airwallex.com/docs/global-treasury/reporting/financial-reports/transaction-reconciliation-report) — report fields and date/balance semantics.
- [KKG Accountancy: The phantom cash hiding in your clearing account](https://www.kkgaccountancy.com/articles/the-phantom-cash-hiding-in-your-clearing-account) — practitioner discussion of split-period payouts, fees, and evidenced reserves. This note's numerical example is original fictional data.
- [Standard Ledger: integrating non-bank feeds with Xero](https://support.standardledger.co/knowledge/non-bank-feeds-how-can-i-integrate-stripe-paypal-airwallex-pin-payments-wise-into-xero) — source-system exports and additional processing work.
- [shellishack's Airwallex/Xero reconciliation skill](https://github.com/shellishack/airwallex-xero-reconciliation-skill) — an existing agent playbook for imports, matching, FX, verification, and handover. CloseLine's proposed focus is the continuing residual case: evidence request, reviewed action, later release, and read-back.

The original worksheet and fictional example are available under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Linked source materials retain their respective terms.

Prepared by Blucca · [Studio and delivered work](https://blucca.github.io/)
