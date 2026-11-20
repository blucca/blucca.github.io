# OSQP symmetric Ruiz scaling: independent native review

[JALin2000's issue #798](https://github.com/osqp/osqp/issues/798) identifies a
symmetric-storage regression and supplies the two-backend fix. This review
runs that **author-proposed fix** against OSQP's actual builtin C library.

| Check | Stock | Author's fix |
|---|---|---|
| Full symmetric column norms, `P=[[1,10],[10,101]]` | `[1,101]` | `[10,101]` |
| One Ruiz step, `D` | `[1,0.0995037190]` | `[0.3162277660,0.0995037190]` |
| One-step cost scale, `c` | `1` | `1.5213077546` |
| Default solve, original / swapped order | 50 / 25 iterations | 25 / 25 iterations |
| Native regression checks | 8/10 pass | 10/10 pass |

All six solves return `OSQP_SOLVED`; solutions agree with the analytic
constrained optimum within 0.01 in each coordinate. This case demonstrates a
scaling and iteration-count improvement. The recorded results concern this
small fixture and this builtin build.

## Reproduce

Requires Git, CMake, a C compiler, Python 3, and network access. From this folder:

```sh
sh replay.sh /absolute/path/to/temp/osqp798
```

Use a fresh work directory. The script fetches the pinned OSQP and QDLDL
sources, builds stock, applies the credited patch, builds fixed, and checks
the paired native results. It uses two build jobs and writes every generated
file to the supplied work directory.

To inspect the **recorded** runs without building:

```sh
python3 check_pair.py native-stock.jsonl native-fixed.jsonl
```

## Mechanism and scope

The CSC representation stores only the upper triangle of symmetric `P`.
Its off-diagonal entry contributes to both columns of the full symmetric
matrix. `csc_row_norm_inf_sym_triu` already implements exactly that mirrored
contribution. For a symmetric matrix, row and column infinity norms coincide.
The proposed symmetry branch also preserves the existing path for a general
rectangular matrix.

The common API is used twice in `scale_data`: for the KKT column norms and
for cost normalization after equilibration. Both are checked by the one-step
`D` and `c` oracle. Here `A=I`, `q=[1,1]`, and `l/u=±1`, so the full KKT
variable-column norms are `[10,101]`. After one Ruiz step, the column norms of
scaled `P` are `[10/sqrt(1010),1]`; their mean gives
`c=2/(1+10/sqrt(1010))`.

The native fixtures cover original and permuted symmetric `P`, a rectangular
nonsymmetric matrix with signed values, and a symmetric diagonal matrix.
The six public-API solves cover scaling 0, 1 and 10 in both orders. The paired
check verifies mapped `D`, cost scaling, iteration counts and solutions, and
preserves the scaling-0 control.

- OSQP: `1572ae068e9ce9ca723cf8223548ade1ff7acc29`.
- QDLDL v0.1.8: `138fdac58b9cd1c4137ff1b99152c8108a6cff5b`.
- Observed host: Linux x86-64, GCC 16.2.1, builtin Release, double precision,
  64-bit indices, default solver settings except `verbose=0` and the specified
  number of scaling steps.
- Both builtin and MKL source branches use the same common CSC helper.
  **Runtime coverage is builtin.** MKL's symmetry dispatch was reviewed in
  source; CUDA and MKL were outside this native run.
- The harness reads pinned internal algebra/scaling fields for observation;
  `osqp_setup` and `osqp_solve` are the real public solver calls.

## Credit and license

The original report, input and proposed fix are by **JALin2000**. OSQP source
is Apache-2.0, copyright the OSQP developers. This independent harness,
paired check and replay script are by Blucca and licensed Apache-2.0. The patch
contains the original author's proposed two-backend change; it is included
for reproducibility. Upstream attributions are preserved in [NOTICE](NOTICE). This is an independent
review, with the original report as the upstream contribution thread.
