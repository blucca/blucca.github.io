/* SPDX-License-Identifier: Apache-2.0
 * Independent native replay of JALin2000's OSQP issue #798.
 * Uses licensed OSQP internal algebra only to observe its actual norms/scaling.
 */
#include <math.h>
#include <stdio.h>
#include "osqp.h"
#include "algebra_matrix.h"
#include "algebra_vector.h"
#include "types.h"

static int failures = 0;

/* Deliberately limited to the four two-column fixtures below. */
static void norm_case(const char* name, OSQPInt m, OSQPInt n, OSQPInt nz,
                      OSQPFloat* values, OSQPInt* indices, OSQPInt* indptr,
                      OSQPInt symmetric, const OSQPFloat* expected) {
    OSQPCscMatrix csc = {m, n, indptr, indices, values, nz, -1, 0};
    OSQPMatrix* M = OSQPMatrix_new_from_csc(&csc, symmetric);
    OSQPVectorf* result = OSQPVectorf_malloc(n);
    if (!M || !result) { failures++; return; }
    OSQPMatrix_col_norm_inf(M, result);
    OSQPFloat* actual = OSQPVectorf_data(result);
    int pass = 1;
    for (OSQPInt j = 0; j < n; ++j)
        if (fabs(actual[j] - expected[j]) > 1e-12) pass = 0;
    printf("{\"kind\":\"norm\",\"case\":\"%s\",\"symmetric\":%d,"
           "\"actual\":[%.17g,%.17g],\"expected\":[%.17g,%.17g],\"pass\":%s}\n",
           name, (int)symmetric, actual[0], actual[1], expected[0], expected[1],
           pass ? "true" : "false");
    failures += !pass;
    OSQPVectorf_free(result);
    OSQPMatrix_free(M);
}

static void solve_case(OSQPInt scaling, int swapped) {
    OSQPFloat px[] = {swapped ? 101. : 1., 10., swapped ? 1. : 101.};
    OSQPInt pi[] = {0, 0, 1}, pp[] = {0, 1, 3};
    OSQPFloat ax[] = {1., 1.}, q[] = {1., 1.}, l[] = {-1., -1.}, u[] = {1., 1.};
    OSQPInt ai[] = {0, 1}, ap[] = {0, 1, 2};
    OSQPCscMatrix P = {2, 2, pp, pi, px, 3, -1, 0};
    OSQPCscMatrix A = {2, 2, ap, ai, ax, 2, -1, 0};
    OSQPSettings settings;
    osqp_set_default_settings(&settings);
    settings.verbose = 0;
    settings.scaling = scaling;
    OSQPSolver* solver = NULL;
    OSQPInt setup = osqp_setup(&solver, &P, q, &A, l, u, 2, 2, &settings);
    if (setup || !solver) { printf("{\"kind\":\"setup_error\",\"code\":%d}\n", (int)setup); failures++; return; }
    OSQPFloat d0 = 1., d1 = 1., c = 1.;
    if (solver->work->scaling) {
        OSQPFloat* d = OSQPVectorf_data(solver->work->scaling->D);
        d0 = d[0]; d1 = d[1]; c = solver->work->scaling->c;
    }
    OSQPInt ret = osqp_solve(solver);
    OSQPFloat x0 = solver->solution->x[swapped ? 1 : 0];
    OSQPFloat x1 = solver->solution->x[swapped ? 0 : 1];
    int pass = !ret && solver->info->status_val == OSQP_SOLVED &&
               fabs(x0 + 1.) < .01 && fabs(x1 - 9. / 101.) < .01;
    /* One Ruiz step is checkable directly from the full dense KKT matrix. */
    if (scaling == 1) {
        OSQPFloat expected_d0 = 1. / sqrt(swapped ? 101. : 10.);
        OSQPFloat expected_d1 = 1. / sqrt(swapped ? 10. : 101.);
        OSQPFloat expected_c = 1. / ((1. + 10. / sqrt(1010.)) / 2.);
        pass &= fabs(d0 - expected_d0) < 1e-12 && fabs(d1 - expected_d1) < 1e-12 &&
                fabs(c - expected_c) < 1e-12;
    }
    printf("{\"kind\":\"solve\",\"scaling\":%d,\"swapped\":%s,"
           "\"D\":[%.17g,%.17g],\"c\":%.17g,\"iter\":%d,\"status\":%d,"
           "\"x_original_order\":[%.17g,%.17g],\"pass\":%s}\n",
           (int)scaling, swapped ? "true" : "false", d0, d1, c,
           (int)solver->info->iter, (int)solver->info->status_val, x0, x1,
           pass ? "true" : "false");
    failures += !pass;
    osqp_cleanup(solver);
}

int main(void) {
    OSQPInt pi[] = {0, 0, 1}, pp[] = {0, 1, 3};
    OSQPFloat p[] = {1., 10., 101.}, expected[] = {10., 101.};
    norm_case("issue798_original", 2, 2, 3, p, pi, pp, 1, expected);
    OSQPFloat ps[] = {101., 10., 1.}, expected_s[] = {101., 10.};
    norm_case("issue798_permuted", 2, 2, 3, ps, pi, pp, 1, expected_s);
    OSQPInt ai[] = {0, 2, 0, 1, 2}, ap[] = {0, 2, 5};
    OSQPFloat a[] = {1., -4., 2., 3., -8.}, expected_a[] = {4., 8.};
    norm_case("rectangular_nonsymmetric", 3, 2, 5, a, ai, ap, 0, expected_a);
    OSQPInt di[] = {0, 1}, dp[] = {0, 1, 2};
    OSQPFloat d[] = {1., 101.}, expected_d[] = {1., 101.};
    norm_case("symmetric_diagonal", 2, 2, 2, d, di, dp, 1, expected_d);
    for (OSQPInt scaling = 0; scaling <= 10; scaling += (scaling ? 9 : 1)) {
        solve_case(scaling, 0);
        solve_case(scaling, 1);
    }
    printf("{\"kind\":\"summary\",\"failed_checks\":%d}\n", failures);
    return failures ? 1 : 0;
}
