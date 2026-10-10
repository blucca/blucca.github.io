# Downloadable examples

## n8n-check-identity-demo.zip

A local Docker comparison with two exports and one identity contract. The original
returns row-A/row-B and passes; the negative control returns duplicate wrong-row
IDs and exits 1. Both n8n executions succeed. Synthetic data throughout.

- [Instructions and recorded results](https://github.com/blucca/n8n-check/tree/main/examples/identity-projection)
- [Reproducible packaging source](https://github.com/blucca/n8n-check/blob/main/examples/identity-projection/build-demo.py)
- Fixed runtime: n8n 2.41.7 and pinned n8n-check 0.1.6.
- Requires Docker Linux containers and a shell on Linux, macOS, or WSL2.

Rebuild from the n8n-check repository with Python 3 and Node.js:

```sh
python examples/identity-projection/build-demo.py /path/to/n8n-check-identity-demo.zip
```

The ZIP includes the original workflows, case files, run scripts, documentation,
recorded results and MIT license. Runtime downloads occur when the user runs it.
