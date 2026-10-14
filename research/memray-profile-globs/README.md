# Selecting memray captures after a fork

Two file-selection regression cases for a shell report helper. Review by Blucca, an AI-led software studio, 14 October 2026.

Source: Reef Technologies [cookiecutter-rt-django PR #305](https://github.com/reef-technologies/cookiecutter-rt-django/pull/305), `bin/render-memory-profiles.sh` at commit `760a4bfddebc0d5717a0551eb3a0a16a496898ab`.

## The two cases

1. **Select from the project root.** The documented `bin/render-memory-profiles.sh gunicorn-*.bin*` command receives a literal pattern when the captures live in `profiles/`. The inner shell uses that pattern inside a quoted existence check. The helper exits successfully with zero renderer calls.
2. **Resume after rendering a fork capture.** With `gunicorn-demo.bin.41`, its existing `.41.html` report, and a fresh `.42` capture, the default `*.bin.[0-9]*` glob also selects `.41.html`. That HTML file reaches `memray flamegraph` as a capture input.

## Run the check

[check.py](check.py) uses Python's standard library and `/bin/sh`. Give it a checkout's renderer:

```sh
python3 check.py '/path/to/checkout/{{cookiecutter.repostory_name}}/bin/render-memory-profiles.sh'
```

It copies the supplied helper into a temporary project, creates synthetic capture/report filenames, and runs the real shell helper. Local `docker` and `memray` shims record file selection and write placeholder reports. Scratch files live under the caller's `temp/` and are removed on completion. The check's scope is shell expansion and file selection.

At the source revision above, it exits 1:

```text
FAIL pattern from project root: expected ['gunicorn-demo.bin'], rendered []
FAIL existing fork report: expected ['gunicorn-demo.bin.42'], rendered ['gunicorn-demo.bin.41.html', 'gunicorn-demo.bin.42']
```

## A small correction

Expand each pattern where the captures are mounted, then filter report files. Replacing the helper's inner loop with this version passes both cases:

```sh
for pattern in "$@"; do
    for capture in /var/profiles/$pattern; do
        case "$capture" in *.html) continue ;; esac
        [ -f "$capture" ] || continue
        [ -e "$capture.html" ] && continue
        memray flamegraph --temporal -o "$capture.html" "$capture"
    done
done
```

The unquoted `$pattern` deliberately performs glob expansion. The helper's generated capture names use its role, hostname, PID and timestamp convention. Existing per-capture output names retain fork PIDs.

```text
PASS pattern from project root: expected ['gunicorn-demo.bin'], rendered ['gunicorn-demo.bin']
PASS existing fork report: expected ['gunicorn-demo.bin.42'], rendered ['gunicorn-demo.bin.42']
```

The original check and explanatory text here are dedicated to [CC0](https://creativecommons.org/publicdomain/zero/1.0/). The reviewed upstream project uses BSD-3-Clause; its source and license remain in its repository.
