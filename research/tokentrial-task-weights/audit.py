#!/usr/bin/env python3
"""Audit a task-mixture sensitivity case using TokenTrial's actual report module.

Run with the unchanged upstream report.py and published Haiku records.jsonl.
Only the report's pricing/status import constants are supplied locally; no agent,
provider, tool hook, configuration or experiment runner is invoked.
"""
import ast
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

TOKEN_TYPES = ('input', 'cache_write_5m', 'cache_write_1h', 'cache_read', 'output')


def load_report(path):
    tree = ast.parse(Path(path).read_text(), filename=str(path))
    tree.body = [n for n in tree.body if not (
        isinstance(n, ast.ImportFrom) and (n.module or '').startswith('tokentrial.')
    )]
    ns = {'TOKEN_TYPES': TOKEN_TYPES,
          'FINAL_STATUSES': {'solved', 'unsolved', 'aborted_budget', 'timeout'}}
    exec(compile(tree, str(path), 'exec'), ns)
    return ns


def record(arm, task, repeat, cost, solved=True):
    return {'run_id': f'{task}__{arm}__r{repeat}', 'arm': arm, 'task': task,
            'repeat': repeat, 'status': 'solved' if solved else 'unsolved',
            'solved': solved, 'cost_usd': dict.fromkeys(TOKEN_TYPES, 0.0) |
            {'output': cost, 'total': cost}, 'cost_main_usd': cost,
            'usage': dict.fromkeys(TOKEN_TYPES, 0), 'num_turns': 0, 'duration_s': 0.0}


def grouped(records):
    g = defaultdict(lambda: defaultdict(list))
    for r in records:
        g[r['arm']][r['task']].append(r)
    return g


def pooled(tasks):
    runs = [r for pool in tasks.values() for r in pool]
    return sum(r['cost_usd']['total'] for r in runs) / sum(r['solved'] for r in runs)


def equal_task(tasks, support):
    # Ratio of task mean costs to task solve probabilities, not mean task CPS.
    costs = sum(sum(r['cost_usd']['total'] for r in tasks[t]) / len(tasks[t]) for t in support)
    solves = sum(sum(r['solved'] for r in tasks[t]) / len(tasks[t]) for t in support)
    return costs / solves


def compare(records, arm, control, all_tasks, support=None):
    g = grouped(records)
    a, b = g[arm], g[control]
    support = sorted(set(a) & set(b)) if support is None else sorted(support)
    assert set(support) <= set(a) & set(b)
    assert support, 'No observed common tasks: sensitivity calculation stops.'
    ac = {t: a[t] for t in support}
    bc = {t: b[t] for t in support}
    ea, eb = equal_task(a, support), equal_task(b, support)
    return {'arm': arm, 'control': control, 'common_tasks': support,
            'outside_common_support': sorted(set(all_tasks) - set(support)),
            'missing_from_arm': sorted(set(all_tasks) - set(a)),
            'missing_from_control': sorted(set(all_tasks) - set(b)),
            'runs_by_task': {t: [len(a.get(t, [])), len(b.get(t, []))] for t in all_tasks},
            'pooled_all_available_ratio': pooled(a) / pooled(b),
            'pooled_common_support_ratio': pooled(ac) / pooled(bc),
            'equal_task_common_support_ratio': ea / eb,
            'equal_task_cps': {'arm': ea, 'control': eb}}


def main(report_path, records_path, output_path):
    source = load_report(report_path)
    # A deterministic zero-effect case: every task has exactly the same cost and
    # success on both arms; only the number of repeats by task differs.
    unequal = []
    for arm, counts in [('baseline', (2, 1)), ('caveman', (1, 2))]:
        for task, cost, n in zip(('low', 'high'), (1.0, 3.0), counts, strict=True):
            unequal.extend(record(arm, task, r, cost) for r in range(n))
    fixture = compare(unequal, 'caveman', 'baseline', ['low', 'high'])
    native = source['summarize'](unequal, n_boot=100, seed=0)
    assert math.isclose(native['arms']['caveman']['vs_baseline']['point'] + 1,
                        fixture['pooled_all_available_ratio'])
    assert math.isclose(fixture['pooled_all_available_ratio'], 7 / 5)
    assert fixture['equal_task_common_support_ratio'] == 1.0

    balanced = [record(a, t, r, c) for a in ('baseline', 'caveman')
                for t, c in [('low', 1.0), ('high', 3.0)] for r in range(2)]
    bc = compare(balanced, 'caveman', 'baseline', ['low', 'high'])
    assert bc['pooled_all_available_ratio'] == bc['equal_task_common_support_ratio'] == 1.0
    failures = [record('baseline', 'x', 0, 1.0), record('baseline', 'x', 1, 1.0, False)]
    assert source['_cost_per_solved'](failures) == 2.0

    records = [json.loads(line) for line in Path(records_path).read_text().splitlines() if line.strip()]
    assert len(records) == len({r['run_id'] for r in records})
    tasks = sorted({r['task'] for r in records})
    assert len(records) == 810 and len(tasks) == 18
    assert all(r['status'] in source['FINAL_STATUSES'] for r in records)
    full = grouped(records)
    assert len(full) == 9 and all(set(at) == set(tasks) for at in full.values())
    assert all(len(pool) == 5 for at in full.values() for pool in at.values())
    full_native = source['summarize'](records, n_boot=100, seed=0)
    for arm, at in full.items():
        assert math.isclose(pooled(at), equal_task(at, tasks))
        assert math.isclose(pooled(at), full_native['arms'][arm]['cost_per_solved'])

    pairs = [('noop', 'baseline'), ('rtk', 'baseline'), ('rtk-v1.2.0', 'baseline'),
             ('caveman', 'noop-hook'), ('caveman-v4.1.0', 'noop-hook'),
             ('headroom', 'headroom-passthrough')]
    results = {'synthetic_zero_effect': fixture, 'balanced_control': bc,
               'failed_run_cost_counted': True, 'full_balanced_runs': len(records),
               'full_balanced_tasks': len(tasks), 'full_balanced_point_equivalence': True,
               'versions': {}}
    versions = sorted({r['claude_init']['claude_code_version'] for r in records})
    for v in versions:
        rr = [r for r in records if r['claude_init']['claude_code_version'] == v]
        native = source['summarize'](rr, n_boot=100, seed=0)
        comparisons = []
        for arm, control in pairs:
            c = compare(rr, arm, control, tasks)
            ns = native['arms']
            assert math.isclose(c['pooled_all_available_ratio'],
                                ns[arm]['cost_per_solved'] / ns[control]['cost_per_solved'])
            comparisons.append(c)
        results['versions'][v] = {'n_records': len(rr), 'comparisons': comparisons}
    # Version-to-version sensitivity uses the same tasks in both versions and arms.
    vg = {v: grouped([r for r in records if r['claude_init']['claude_code_version'] == v])
          for v in versions}
    results['cross_version_same_task_support'] = []
    for arm, control in pairs:
        support = set(tasks)
        for v in versions:
            support &= set(vg[v][arm]) & set(vg[v][control])
        c = {'arm': arm, 'control': control, 'common_tasks': sorted(support), 'versions': {}}
        for v in versions:
            rr = [r for r in records if r['claude_init']['claude_code_version'] == v]
            c['versions'][v] = compare(rr, arm, control, tasks, support)
        results['cross_version_same_task_support'].append(c)
    Path(output_path).write_text(json.dumps(results, indent=2) + '\n')
    for v, rr in results['versions'].items():
        print(v, rr['n_records'])
        for c in rr['comparisons']:
            print(f"  {c['arm']} / {c['control']}: "
                  f"pooled ALL {100*(c['pooled_all_available_ratio']-1):+.2f}% | "
                  f"pooled SAME {100*(c['pooled_common_support_ratio']-1):+.2f}% | "
                  f"equal-task SAME {100*(c['equal_task_common_support_ratio']-1):+.2f}% | "
                  f"support {len(c['common_tasks'])}/18")
    print('Same task support in both versions and arms:')
    for c in results['cross_version_same_task_support']:
        values = ' | '.join(f"{v}: pooled SAME {100*(r['pooled_common_support_ratio']-1):+.2f}% / equal SAME {100*(r['equal_task_common_support_ratio']-1):+.2f}%"
                            for v, r in c['versions'].items())
        print(f"  {c['arm']} / {c['control']}, {len(c['common_tasks'])}/18: {values}")
    print('PASS: unchanged report point replay, unequal zero-effect fixture, balanced controls, failed-cost inclusion.')


if __name__ == '__main__':
    main(*sys.argv[1:])
