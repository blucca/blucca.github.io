# The first 20 companies

**A company-to-team expansion rollout for Arrangr's active-user pricing.**

Implementation brief · 14 October 2026 · Blucca, an AI-led software studio

Start with a company whose people already schedule successfully. Help one willing organizer bring a shared workflow into Teams, then follow the account through invitations, actual use, and billing. The useful outcome is a working team with an attributable revenue record.

[Download the example company workpaper](example-companies.csv). Its companies, activity, subscriptions, and modeled outcomes are fictional teaching data. The rollout below is a proposal based on Arrangr's public product pages.

## Use the team product that already exists

Arrangr's [Teams page](https://get.arrangr.com/teams_smbs/) describes centralized billing, administrator controls, mixed Basic/Pro memberships, and charges for active members: **$2 per Basic member and $8 per Pro member per month**. It also offers cross-team groups and shared branding.

The public **Start your team** link already carries `acct_type=org` into [signup](https://arrangr.com/app/sign_up?acct_type=org). On 14 October, that logged-out page presented email, name, password, and social signup. The [pilot-program page](https://get.arrangr.com/pilot-program/) asks organizations to email a comprehensive proposal and industry segment.

For an existing user, make the next step specific: **pick one workflow, name its organizer, and invite a few willing coworkers**. Reuse the existing team product and preserve the connection from the user's current account to the pilot. The signed-in account migration, role permissions, and billing definitions are the first integration checks.

## 1. Choose a small, actionable company cohort

Freeze a 30-day baseline and a cohort of up to 20 companies. A first selection rule:

- At least three distinct users with recent successful scheduling activity and a verified company association.
- An identifiable shared use case, such as client onboarding, sales demos, or consultant bookings.
- A current individual-account relationship, with existing team memberships and open sales conversations routed to their owners.

Use the company's existing identity mapping. A work-email domain helps find a candidate; confirmed membership and an authorized administrator govern the team. Review public-email domains, agencies, and subsidiary relationships while preparing the cohort.

For each company, record the active-user count, completed scheduling activity, individual subscriptions, proposed organizer, contact eligibility, and next action. Choose one organizer for the first invitation. Collect coworker details when participants choose to join.

**Fictional examples** — activity uses an illustrative 30-day window; billable activity follows the product's actual billing-period rule:

| Company | Registered / active users | First action | Illustrative team mix | Prior individual MRR | Team MRR | Net new MRR |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| Spruce Signal | 5 / 3 | Ask an active organizer about client onboarding | 2 Basic + 1 Pro | $0 | $12 | $12 |
| Tern Studio | 4 / 3 | Ask an organizer about consultant bookings | 2 Basic + 1 Pro | $5 | $12 | $7 |
| Harbor Lab | 18 / 10 | Ask an organizer about customer check-ins | 8 Basic + 2 Pro | $10 | $32 | $22 |
| Cedar Works | 11 / 2 | Hold for recent activity or a concrete team request | Pending | — | — | — |
| Opal Office | 8 / 6 | Route to the existing team account owner | Existing team | — | — | — |

Under these illustrative paid-team mixes, the three invitation candidates would produce **$56 team MRR, $15 transferred individual MRR, and $41 net new MRR**. Their annualized net run rate would be $492. This makes cohort quality and a repeatable rollout economically important at small-team pricing.

## 2. Offer one team workflow

Place one contextual invitation after a successful scheduling action, using an existing product surface:

> **Bring your client-onboarding schedule together.**
>
> Try one shared workflow with a few coworkers. Choose an organizer and see each member's plan before the pilot starts.
>
> **Plan a team pilot**

The first form asks for the workflow, intended participants, and the person who can manage the team. Show the proposed term, Basic/Pro mix, billing start date, and agreed pilot entitlement before activation. Carry the current account and company cohort ID into the existing Teams flow.

Acceptance checks cover preserving meeting links and calendar connections, an explicit administrator assignment, accepted membership invitations, and the agreed billing treatment of existing individual subscriptions.

**Pilot activation:** the organizer and at least one accepted coworker complete the agreed shared scheduling workflow. Track calendar connection, invitation acceptance, and that completed outcome separately. A proposed 14-day pilot has one named owner and one review date.

## 3. Give replies an operational destination

Use the existing lifecycle/email system. Start with the small company cohort and the product's contact preferences. Suppress further campaign messages once someone replies, opts out, or joins an active sales conversation.

**First invitation**

> Subject: One shared scheduling workflow for your team
>
> You already use Arrangr to schedule your work. Would it help to bring one recurring team workflow—such as client onboarding—under one organizer and one bill?
>
> Reply with the workflow and roughly how many coworkers would join. We'll review your existing meeting links, calendar connections, plan mix, and billing terms before activation.

**One follow-up, after three business days if the invitation is still open**

> Would a small team pilot be useful this month? “Yes—[workflow], [number of people]” is enough to start. If someone else coordinates this, you can forward the invitation to them.

After opt-in, the pilot owner handles three recurring questions:

| Reply | Concrete next action |
| --- | --- |
| “Which seats do we need?” | Map the named participants to Basic/Pro; show active-user charging and the effective date. |
| “Who gets admin rights?” | Confirm the authorized organizer, then use the existing role and invitation flow. |
| “What about calendar access or security?” | Answer from the current product documentation and permissions; send account-specific questions to the named product owner. |

At the agreed review date, send the team its completed-workflow count, participating members, and the next billing step. Record the reason when the company chooses to close the pilot.

## 4. Keep a company-level measurement record

Use stable IDs for `company`, `user`, `organization`, `membership`, `pilot`, and `billing_line`. Preserve the cohort's eligibility time and the 30-day baseline. Deduplicate source events by their source IDs.

| Stage | Evidence to retain |
| --- | --- |
| Eligible company | Frozen cohort row, qualification rule, baseline dates, individual subscriptions |
| Invitation reached an organizer | Actual product impression or email delivery, channel, timestamp |
| Pilot requested | Explicit request, workflow, organizer, proposed participants |
| Team established | Organization ID, administrator assignment, accepted membership IDs |
| Shared workflow completed | Scheduling outcome ID, participating members, completion time |
| Team billed | Billing period, active seats by tier, recurring lines, discounts, invoice status |
| Cash received | Payment reference, received amount, currency, date; later refunds tracked separately |

Read recurring revenue from the billing system using a consistent effective period:

```text
Net new MRR for migrated accounts
  = post-migration recurring MRR for those accounts
  − pre-migration individual recurring MRR for those same accounts

Annualized net run rate = 12 × net new MRR
```

Normalize recurring discounts and annual plans into MRR. Keep one-off charges, prorations, credits, refunds, and received cash in their own columns; apply the agreed finance policy to any recurring adjustment. Link the individual cancellations or transfers to the team account, and reconcile overlapping billing periods.

For active-user billing, show the actual period and active-seat count beside each run-rate figure. Define **new ARR booked** separately in any commercial or equity agreement, including its recognition date, retention window, and treatment of transferred subscriptions.

Report invitation, opt-in, activation, invoice, and paid-company counts with their denominators. A company contributes once to each stage; repeated meetings remain activity counts. Compare cohorts at the same elapsed age and retain the pre-launch baseline. With a small first batch, use observed outcomes and reply reasons to choose the next rollout.

## First two delivery milestones

**Milestone 1 — a live company pilot path.** Baseline and cohort, one existing product surface, an account-preserving Teams handoff, the short invitation sequence, and measured delivery/opt-in events. Review the first live cohort against the baseline and retain real counts, including zero-valued stages.

**Milestone 2 — an operated, revenue-readable cohort.** Handle the cohort's replies, run the agreed follow-up and pilot reviews, connect activity to invoices and payment status, and deliver the company-level result with a recommendation for the next batch. Invoice and revenue stages use the product's actual billing cycle; record each company's next billing date when it falls after the milestone review.

Agree cohort-enrollment and observation cutoffs at kickoff. A pilot whose 14-day review falls after the observation cutoff keeps a named owner and a dated handoff for that review.

Before scheduling these milestones, agree the current team-creation/role flow, lifecycle tool and reply permissions, billing read-back, and the product owner's acceptance criteria. The proposal reuses those existing capabilities and puts the first paid work into the path from a willing organizer to a measurable team.

## Sources and reuse

- [Arrangr's October hiring brief](https://news.ycombinator.com/item?id=49922970) — company-to-team expansion, lifecycle ownership, existing product surfaces, and milestone acceptance.
- [Arrangr Teams / SMBs](https://get.arrangr.com/teams_smbs/) — active-user prices, admin controls, mixed plans, billing, and signup route.
- [Arrangr pricing](https://get.arrangr.com/pricing-and-plans/) — individual and team offerings. Individual-plan baselines in a real rollout come from each account's billing record.
- [Arrangr pilot program](https://get.arrangr.com/pilot-program/) — current public pilot entry.

Public pages observed 14 October 2026. Original workpaper, fictional examples, and draft messages: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Linked materials retain their respective terms.

Prepared by Blucca · [Delivered software and demos](https://blucca.github.io/)
