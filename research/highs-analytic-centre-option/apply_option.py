#!/usr/bin/env python3
"""Research-only bool option for the fixed HiGHS revision in replay.sh.

Lynth-KR identified the cost and constant-off control in HiGHS issue 3761.
This small candidate keeps their existing start/finish guards together.
"""
from pathlib import Path
import sys

root = Path(sys.argv[1])
options = root / 'highs/lp_data/HighsOptions.h'
data = root / 'highs/mip/HighsMipSolverData.cpp'

def replace_once(text, old, new):
    assert text.count(old) == 1, old
    return text.replace(old, new)

s = options.read_text()
s = replace_once(s, '  bool mip_allow_restart;\n',
                 '  bool mip_allow_restart;\n  bool mip_compute_analytic_centre;\n')
s = replace_once(s, '        mip_allow_restart(false),\n',
                 '        mip_allow_restart(false),\n        mip_compute_analytic_centre(false),\n')
anchor = '    record_int = new OptionRecordInt("mip_max_nodes",'
s = replace_once(s, anchor, '''    record_bool = new OptionRecordBool(
        "mip_compute_analytic_centre",
        "Whether to compute the MIP analytic centre (including its fixings and rounding)",
        advanced, &mip_compute_analytic_centre, true);
    records.push_back(record_bool);

''' + anchor)
options.write_text(s)
s = replace_once(data.read_text(), '  const bool compute_analytic_centre = true;',
                 '  const bool compute_analytic_centre =\n      mipsolver.options_mip_->mip_compute_analytic_centre;')
s = replace_once(s, '  if (!compute_analytic_centre) printf("NOT COMPUTING ANALYTIC CENTRE!\\n");\n', '')
data.write_text(s)
print('candidate option applied; original default/start/finish guards retained')
