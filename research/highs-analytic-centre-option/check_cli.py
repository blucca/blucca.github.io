#!/usr/bin/env python3
"""Check the native CLI options-file/quiet-output contract on the original MPS."""
import json,re,sys
from pathlib import Path
p=Path(sys.argv[1]); text=(p/'cli.solution').read_text()
assert text.startswith('Model status\nOptimal\n')
assert '# Columns 51291\n' in text and '# Rows 98911\n' in text
assert (p/'cli.stdout').stat().st_size == (p/'cli.stderr').stat().st_size == 0
def number(key):
    m=re.search(r'^'+re.escape(key)+r' ([^\n]+)$',text,re.M)
    assert m is not None,key
    return float(m[1])
d={'model_status':'Optimal','primal':number('Objective'),
   'dual_bound':number('Objective_bound'),'gap':number('MIP_rel_gap'),
   'stdout_bytes':0,'stderr_bytes':0,'columns':51291,'rows':98911,
   'scope':'native highs CLI, options-file false, original master, quiet output'}
anchor=json.loads((p/'results/false-1.json').read_text())
assert abs(d['primal']-anchor['primal'])<1e-9
assert abs(d['dual_bound']-anchor['dual_bound'])<1e-9
assert abs(d['gap']-anchor['gap'])<1e-12
(p/'cli-result.json').write_text(json.dumps(d,indent=2)+'\n')
print('native CLI/options-file/quiet-output PASS')
