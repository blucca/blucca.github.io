from scipy.optimize import linprog

implicit = linprog([1.0], A_eq=[[1.0]], b_eq=[-1.0], method="highs")
explicit = linprog(
    [1.0], A_eq=[[1.0]], b_eq=[-1.0],
    bounds=[(None, None)], method="highs",
)
print("implicit:", implicit.status, implicit.success)
print("explicit:", explicit.status, explicit.x.tolist())
assert implicit.status == 2
assert explicit.success and abs(explicit.x[0] + 1.0) < 1e-10
