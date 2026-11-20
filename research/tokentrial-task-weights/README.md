# After filtering a balanced benchmark, check the task mix

An independent, provider-free replay of [TokenTrial v0.3](https://github.com/bishtashish708/tokentrial/blob/3ae22864e90e5444940a9bf2bde29f9ba9427e29/results/v0.3/FINDINGS.md), using its published Haiku records and report functions. Reviewed 20 November 2026.

**The full balanced result passes.** All 810 records, nine arms, 18 tasks and five repeats per task/arm reproduce the original cost-per-solved points. Costs of unsuccessful runs stay in the numerator, and caveman retains its matched `noop-hook` control.

**The useful extra check is in the version split:** filtering the balanced matrix leaves different task frequencies within each arm. A same-task, equal-weight sensitivity separates those realized frequencies from the point comparison. For example, old-version headroom versus pass-through changes from **+6.04% pooled to −4.36% equal-task on all 18 tasks**. Both numbers describe the same existing records with different task weights.

## Replay in one command

Download [the small replay bundle](https://blucca.github.io/research/tokentrial-task-weights/tokentrial-task-weights.zip), extract it and fetch the author's pinned numeric records (7.39 MB):

```sh
curl -L --fail https://raw.githubusercontent.com/bishtashish708/tokentrial/3ae22864e90e5444940a9bf2bde29f9ba9427e29/results/v0.3-haiku/raw/records.jsonl -o records.jsonl
python3 audit.py upstream-report.py records.jsonl results.json
```

Python 3.10+; standard library only. The program executes the pinned report's body after supplying its two static pricing/status imports. It invokes `summarize()` to check point agreement; its small bootstrap draws are discarded. The replay performs a six-run zero-effect control, a balanced control, failed-cost inclusion and the actual-record comparisons. [Observed results](observed-results.json) include the task/arm count tables and every support list. The dataset stays at its author's source; the bundle contains the analysis and pinned report module.

## Which quantity is being compared?

For arm `a` and task `i`, let `n_ai` be the remaining number of runs, `c_ai` their mean cost **including failures**, and `p_ai` their solve fraction.

```text
pooled CPS_a       = sum_i(n_ai * c_ai) / sum_i(n_ai * p_ai)
equal-task CPS_a   = sum_i(c_ai) / sum_i(p_ai)
relative change   = CPS_tool / CPS_control - 1
```

The equal-task estimator is a **ratio of means** over one specified common task set. Each task contributes its observed mean cost and solve rate, including tasks with zero observed successes. A positive total solve rate gives a finite CPS. Averaging task-level CPS would define a different quantity and creates infinities for zero-success tasks.

When repeats are equal across tasks within each arm, these two CPS values agree. That is exactly the complete v0.3 Haiku matrix. After filtering on Claude Code version, the original shared task bootstrap still resamples each selected task's remaining `n_ai` runs in each arm: shared task labels preserve pairing, while the arm-specific counts remain.

## Actual version-specific point sensitivity

**Positive means more expensive; negative means cheaper.** `ALL` is each arm's available filtered run stream. `SAME` keeps only tasks observed in both arms at that version. Compare the final two columns to isolate the weight change on identical support.

| Claude Code | Tool / control | SAME tasks | Pooled ALL | Pooled SAME | Equal-task SAME |
|---|---|---:|---:|---:|---:|
| 2.1.252 | `noop` / `baseline` | 17/18 | -6.96% | -7.18% | +4.13% |
| 2.1.252 | `rtk` / `baseline` | 18/18 | +6.63% | +6.63% | +12.73% |
| 2.1.252 | `rtk-v1.2.0` / `baseline` | 17/18 | +5.24% | +3.41% | +8.87% |
| 2.1.252 | `caveman` / `noop-hook` | 18/18 | -4.23% | -4.23% | -10.09% |
| 2.1.252 | `caveman-v4.1.0` / `noop-hook` | 18/18 | -12.64% | -12.64% | -10.63% |
| 2.1.252 | `headroom` / `headroom-passthrough` | 18/18 | +6.04% | +6.04% | -4.36% |
| 2.1.322 | `noop` / `baseline` | 17/18 | +22.66% | +16.00% | +0.62% |
| 2.1.322 | `rtk` / `baseline` | 17/18 | +0.45% | -0.88% | -4.84% |
| 2.1.322 | `rtk-v1.2.0` / `baseline` | 17/18 | +11.07% | +10.04% | +6.04% |
| 2.1.322 | `caveman` / `noop-hook` | 18/18 | -16.75% | -16.75% | -16.52% |
| 2.1.322 | `caveman-v4.1.0` / `noop-hook` | 18/18 | -4.81% | -4.81% | -9.50% |
| 2.1.322 | `headroom` / `headroom-passthrough` | 14/18 | -5.48% | -13.44% | +9.31% |

Tasks outside the within-version common support:

- 2.1.252, `noop` / `baseline`: `c-ring-buffer`.
- 2.1.252, `rtk-v1.2.0` / `baseline`: `py-pytest-cart-pricing`.
- 2.1.322, `noop` / `baseline`: `log-link-failure`.
- 2.1.322, `rtk` / `baseline`: `read-audit-writer`.
- 2.1.322, `rtk-v1.2.0` / `baseline`: `read-config-precedence`.
- 2.1.322, `headroom` / `headroom-passthrough`: `git-config-forensics`, `js-lru-ttl-cache`, `py-cli-json-output`, `py-cron-tz`.

An empty task/arm/version cell has unknown cost and solve means. This replay uses observed common support, with the omitted task names explicit. In particular, new-version `noop`'s +22.66% ALL → +16.00% SAME change removes a task; +16.00% → +0.62% then changes only the weights.

## Comparing versions on one fixed task target

Use the **four-way intersection**: tasks observed for both arms in both versions. Each cell below is **pooled SAME → equal-task SAME** on that identical target.

| Tool / control | Tasks in both versions | 2.1.252 | 2.1.322 |
|---|---:|---:|---:|
| `noop` / `baseline` | 16/18 | -5.40% → +5.00% | +13.63% → -1.80% |
| `rtk` / `baseline` | 17/18 | +8.71% → +13.32% | -0.88% → -4.84% |
| `rtk-v1.2.0` / `baseline` | 16/18 | +4.69% → +9.51% | +8.86% → +4.04% |
| `caveman` / `noop-hook` | 18/18 | -4.23% → -10.09% | -16.75% → -16.52% |
| `caveman-v4.1.0` / `noop-hook` | 18/18 | -12.64% → -10.63% | -4.81% → -9.50% |
| `headroom` / `headroom-passthrough` | 14/18 | +10.66% → -8.01% | -13.44% → +9.31% |

For headroom, the four-way target omits `git-config-forensics`, `js-lru-ttl-cache`, `py-cli-json-output` and `py-cron-tz`. The 14-task old-version row has a different target from its 18-task row above. Full support and all per-task counts are saved in the results file.

## A six-run zero-effect control

All runs solve; the two arms have exactly the same costs within each task.

| Task | Cost per run | Baseline repeats | Tool repeats |
|---|---:|---:|---:|
| low | 1 | 2 | 1 |
| high | 3 | 1 | 2 |

Pooled baseline CPS is `5/3`, tool CPS `7/3`: **+40%**. Equal-task CPS is `2` on both arms: **0%**. Setting both repeat counts to `2,2` gives **0% under both metrics**. These deterministic controls isolate task weights without model sampling or tool effects.

## Interpretation and suggested addition

The author already disclosed the 447/363 version split, seeded shuffled schedule and wide version-specific intervals. Under an outcome-independent cutoff, the realized task-count imbalance can be finite-sample allocation noise from that randomized schedule. Equal-task cell means retain run-level sampling noise, especially in cells with one or two runs.

This note reports **point-estimate sensitivity**. The original intervals belong to the original pooled estimator; the original complete balanced headline and matched-control conclusions remain intact. Caveman v4.0.1, for example, stays in the same point direction on all 18 tasks under both weightings in both versions. The Sonnet experiment and Caveman's separate Sol benchmark are outside this Haiku replay.

A useful methods-table addition is: **show task/arm repeat counts, name the task target, and give the pooled and equal-task sensitivity on that same common support.** Keep the pooled statistic for the actual run stream. For any uncertainty analysis of the equal-task target, aggregate bootstrapped task means with equal task weights and specify whether the target is the fixed tasks or a task distribution.

## Attribution

TokenTrial and its original measurements: **Ashish Bisht**, MIT; pinned revision `3ae22864e90e5444940a9bf2bde29f9ba9427e29`. `upstream-report.py` is copied unchanged and covered by [UPSTREAM-LICENSE](UPSTREAM-LICENSE). Independent note, replay and synthetic controls: **Blucca**, [MIT](LICENSE). This review responds to the author's [public methods-review invitation](https://github.com/JuliusBrussee/caveman/issues/1519#issuecomment-6851851638).
