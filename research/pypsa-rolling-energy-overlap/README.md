# PyPSA rolling-horizon energy: retained snapshots and future bounds

Complete native replay of [FabianHofmann's original #2073](https://github.com/PyPSA/PyPSA/issues/2073), plus one same-topology capacity control. The author's overlap diagnosis and proposed direction remain attributed to the author. This independent review separates **retained-prefix accounting** from **the achievable future production envelope**.

**10 native runs pass the study's assertions: 7 complete feasible witnesses and 3 expected native infeasibilities.** Source: PyPSA master [`7dee89a`](https://github.com/PyPSA/PyPSA/tree/7dee89a06b945d3c65acbce0b587110672a695b3), unchanged throughout. The issue reported an earlier unreleased master; this replay uses the pinned newer master.

## The two complete networks

Both have six unit-weight snapshots, one bus, load `0.5` at every snapshot, a nonnegative backup generator (`p_nom=10`, cost `1`), and the tracked generator with costs `[10,9,8,7,6,5]`. Rolling horizon is `3`; overlap is `1` unless stated.

- **Original:** tracked `p_nom=1`, `e_sum_min=1.5`.
- **Exact-capacity control:** same topology/costs; tracked `p_nom=0.5`, `e_sum_min=3`.

Every successful output has all six generator/backup values checked against bus balance, both capacities and the whole energy minimum. Costs below are illustrative model units.

| Semantics | Original | Exact-capacity E3 |
|---|---|---|
| Full horizon | feasible, **10.5** | feasible, **22.5** |
| Stock, overlap 0 | feasible, **10.5** | feasible, **22.5** |
| Stock, overlap 1 | final window infeasible | outside the fixed replay |
| Retained prefix; future from original window end | feasible, **10.5** | first window infeasible |
| Retained prefix; future from commitment cutoff | final window infeasible | feasible, **22.5** |
| Retained prefix; cutoff plus actual bus-load cap | feasible, **10.5** | outside the fixed replay |

The complete original successes dispatch the tracked generator `[0,0,0,.5,.5,.5]`; E3 successes dispatch `.5` at every snapshot. Failed runs retain their actual partial ledgers; whole witness, total energy and whole cost are absent. All ten runs restore the original `e_sum_min`.

## Why the variants differ

Let `end` be the look-ahead window end and `cutoff` its commitment boundary. The final window keeps its full remaining tail. A retained-prefix constraint uses energy from `[start,cutoff)` and subtracts already committed energy plus a bound on later production.

**1. Keep the original `later[end:]` while restricting the left-hand side.** This passes the original example. In the exact-capacity E3 control, however, the first kept prefix can produce only `2 × .5 = 1`; its required amount is `3 - 3 × .5 = 1.5`. Native infeasibility is immediate, while both full-horizon and stock-overlap-0 are feasible.

**2. Move later production to `later[cutoff:]`.** This gives the correct uncommitted-snapshot ledger and passes the exact-capacity control. In the original example, the future envelope still uses `p_nom=1`, while bus balance and nonnegative backup make actual production at most `.5`. At window `[2,5)`, the kept-prefix target becomes `1.5 - 2 × 1 = -.5`: nothing is committed. The final two snapshots then face target `1.5` with actual capacity `1.0`, so native solve fails.

**3. Use the achievable `.5` future cap in this one-bus control.** The retained-prefix target at `[2,5)` is `.5`; it is committed at snapshot 3. The last window supplies the remaining `1.0`, yielding the complete feasible cost `10.5`. This manually supplied bound is valid for this non-exporting network. General network coupling, storage and ramping require their own future-envelope contract.

These results support treating the prefix ledger and future-envelope contract separately when agreeing a repair. The code is a focused research callback, with production PyPSA unchanged.

## Reproduce

[Complete program](replay.py), [all unrounded results/traces](native/results.json), [native log](native.log), and [core versions](native/versions.json). The log includes successful solves and actual infeasible conditions. No solver ties are needed: generator costs strictly decrease and all exceed backup cost.

```sh
# Work in your project root; all generated files stay in temp/.
git clone --filter=blob:none https://github.com/PyPSA/PyPSA temp/PyPSA
git -C temp/PyPSA checkout 7dee89a06b945d3c65acbce0b587110672a695b3
uv venv --python 3.13 temp/env
uv pip install --python temp/env/bin/python -e temp/PyPSA \
  linopy==0.10.1 highspy==1.16.0 numpy==2.5.5 scipy==1.18.1 \
  pandas==3.1.1 xarray==2026.9.0
OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 \
  taskset -c 0,1 temp/env/bin/python -B replay.py --out temp/own-replay
```

Measured host: Linux/Python3.13.5, two-CPU affinity, HiGHS one thread, 3GiB address-space limit; full study process peak RSS `440276 KiB`. The raw `n.objective` on a rolling run is **last-window only** (e.g. `5.5` or `9`); whole six-snapshot costs are recomputed independently as `10.5` or `22.5`.

## Attribution and scope

Original report/network and repair direction: [FabianHofmann](https://github.com/FabianHofmann), PyPSA issue #2073. Library source: [PyPSA contributors, MIT](https://github.com/PyPSA/PyPSA/blob/7dee89a06b945d3c65acbce0b587110672a695b3/LICENSE). Independent study software: MIT, built and executed by Codex with Blucca.

Coverage is these two complete six-snapshot, generator-only networks. A production repair is left for an agreed retained-prefix/future-envelope scope with the maintainer.
