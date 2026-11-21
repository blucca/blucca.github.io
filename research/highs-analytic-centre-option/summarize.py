#!/usr/bin/env python3
"""Full-instance primal checks and paired same-binary timing."""
import json,re,statistics,sys
from pathlib import Path
p=Path(sys.argv[1]); records={}
for file in sorted(p.glob('*.json')):
    d=json.loads(file.read_text())
    assert (d['rows'],d['columns'],d['integer_columns']) == (98911,51291,19740)
    assert d['model_status']=='Optimal'
    tol=d['mip_feasibility_tolerance']
    assert all(d[k]<=tol for k in ('max_bound_violation','max_row_violation','max_integrality_violation'))
    lines=(p/(file.stem+'.log')).read_text().splitlines()
    times=[]; active=None; starts=0
    for line in lines:
        m=re.search(r'MIP-Timing:\s*([\d.eE+-]+)\s*-\s*(.*)',line)
        if not m: continue
        t=float(m[1]); message=' '.join(m[2].split())
        if 'starting analytic centre calculation' in message: starts+=1
        if 'starting analytic centre synch' in message: active=t
        if 'completed analytic centre synch' in message:
            assert active is not None and t>=active
            times.append(t-active); active=None
    assert active is None
    d['centre_starts']=starts
    d['centre_sync_wait_seconds_from_rounded_log']=sum(times)
    if d['mode'] in ('false','constant-off'): assert starts==0 and not times
    records[file.stem]=d
assert len(records)==9,sorted(records)
default=[records[f'default-{i}']['run_wall_seconds'] for i in (1,2,3)]
off=[records[f'false-{i}']['run_wall_seconds'] for i in (1,2,3)]
anchor=records['stock-1']
for d in records.values():
    assert abs(d['primal']-anchor['primal']) <= 1e-7
    assert abs(d['dual_bound']-anchor['dual_bound']) <= 1e-7
on_median=statistics.median(default); off_median=statistics.median(off)
result={'source_revision':'725b40f68247d0e2a00fa4f29d6ca6bde01bd151',
        'original_issue':'https://github.com/ERGO-Code/HiGHS/issues/3761',
        'scope':'one uploaded OA master; two threads; original gap tolerance',
        'default_median_seconds':on_median,'false_median_seconds':off_median,
        'relative_run_wall_reduction':1-off_median/on_median,
        'performance_case_gate_10_percent':off_median<=.9*on_median,
        'records':records}
cli_file=p.parent/'cli-result.json'
if cli_file.exists():
    result['cli_contract']=json.loads(cli_file.read_text())
    assert result['cli_contract']['model_status']=='Optimal'
    assert result['cli_contract']['stdout_bytes']==result['cli_contract']['stderr_bytes']==0
Path(sys.argv[2]).write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='records'},indent=2))
