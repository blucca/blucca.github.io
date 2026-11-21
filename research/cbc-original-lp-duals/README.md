# Original LP prices after CBC bound strengthening

A focused replay and minimal default fix for [@miguelortegamier’s CBC #861](https://github.com/coin-or/Cbc/issues/861). The supplied restricted master has **six continuous variables and five covering rows**. Its unique optimum is `17141/70`; original shadow prices are `(1/2, 1/2, 1/3, 1/7, 1/10)`.

## Full native result

PuLP **4.3.1**, Python **3.13.5**, CBC master **87e3a7d** and four pinned companion libraries; Linux x86-64, shared release builds. [Complete observations](observed-results.json) include every original row/column, primal and dual feasibility, stationarity, complementary slackness, and primal–dual gap. All eleven CBC invocations exited successfully.

| Solver / mode | Original row prices | Original LP dual gap |
|---|---|---:|
| Official CBC 2.10.13 | `(1/2,1/2,1/3,1/7,1/10)` | < `1e-6` |
| Master default | `(0,0,0,1/7,0)` | `240.3` |
| Master: presolve off + preprocess off | Same as default | `240.3` |
| Master: both bound controls off | Correct original prices | `0` |
| Minimal LP-only candidate, default | Correct original prices | `0` |

Increasing only the first RHS from `310` to `311` raises the optimum by **0.5** in all measured modes. The default master still reports that row’s price as zero; the two-option control and candidate return `0.5` and pass the full original-model KKT contract.

The original issue reports three zero prices and a retained final price, corresponding to gap **230**. This pinned native run puts all four singleton-row prices at zero. Both observations are retained separately in the [exact rational certificate](certificate.json).

## Immediate PuLP control

For this current-master LP path, put both options before `-initialSolve`:

```python
solver = pulp.COIN_CMD(
    path="/path/to/cbc", mip=False,
    options=["boundPropLevel off", "singletonBounds off"],
)
```

The CBC pre-LP phase directly adds lower bounds. A basic variable can then carry its cost in a new bound multiplier, while the original row price becomes zero. Clp’s postsolve sees those new bounds as its input. Presolve/preprocess settings control separate stages.

## Minimal default fix

[The patch](lp-only-explicit-force.patch) changes one condition in `runSolveContinuous`: normal LP commands leave original-model presolve/postsolve to Clp. Existing `rowReductions force` remains the explicit strengthened-root-LP benchmark mode, and the branch-and-bound phase stays unchanged.

Candidate default and RHS+1 runs pass every original-model KKT check. A one-integer-variable B&B control (`min x`, `x >= 1.2`, integer `x`) returns `x=2`, objective `2`, with official 2.10.13, stock master, and candidate. Candidate and stock shared libraries were kept in separate prefixes. The linked source patch is supplied for upstream review; these observations describe the tested candidate.

## Replay

```sh
python3 check_original_lp.py                 # exact Fraction certificate
# In an environment with PuLP 4.3.1:
export LD_LIBRARY_PATH="$PWD/master-prefix/lib"
python3 run_mre.py master /path/to/stock/cbc
python3 run_mre.py old /path/to/release-2.10.13/cbc
```

`run_mre.py` writes fresh native records below `native-results/`. Archived records are below [`observed/`](observed/). The original author’s matrix, nonnegative bounds, continuous types, and PuLP 4 API are preserved. Native comparisons use absolute tolerance `1e-6`; the rational certificate uses exact arithmetic.

The actual build and candidate-run scripts are included for a source-level replay with [`companion-pins.json`](companion-pins.json). They use an isolated prefix, two build jobs, and the existing open-source dependencies. Run them from a disposable copy of this directory. The patch is applied only to the pinned CBC source. See their commands for stock/candidate library paths.

Prepared by Blucca’s Codex agent. The original bug report and MRE are credited to @miguelortegamier. Independent replay scripts use MIT; the CBC source patch follows the upstream EPL-2.0 license.


For the complete stock/candidate source replay (Linux with a C++ compiler, make and pkg-config):

```sh
mkdir -p official-release
curl -fL 'https://github.com/coin-or/Cbc/releases/download/releases/2.10.13/Cbc-releases.2.10.13-x86_64-ubuntu24-gcc1330-static.tar.gz' | tar -xz -C official-release
python3 build_master.py
python3 build_candidate.py
python3 run_candidate_native.py
```

The companion pins are loaded from the supplied snapshot. The portable native script was also run once against the actual candidate and passed its full original-model KKT check.
