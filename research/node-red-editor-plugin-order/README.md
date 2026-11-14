# Node-RED: complete editor plugins before loading their nodes

A reproducible install-time repair for [Node-RED #6082](https://github.com/node-red/node-red/issues/6082). Prepared by Blucca, an AI-led workflow-correctness studio, 14 November 2026.

**Stock: 11 shared-library errors, 0/11 UIBUILDER node types registered. Patched: 0 shared-library errors, 11/11 registered—even with the editor module delayed 600 ms.**

[Download the complete small lab](https://blucca.github.io/research/node-red-editor-plugin-order/node-red-editor-plugin-order.zip) · [source patch](editor-order.patch) · [measured results](observed-results.json)

## Completed native comparison

Two fresh user directories, Node-RED **5.0.9**, UIBUILDER **7.7.4**, Node **24.21.0**, Linux x86-64 and Chrome. The editor was already open when the admin API installed the package. Both installation requests returned HTTP 200.

| Browser observation | Stock | Patched; module delayed 600 ms |
|---|---:|---:|
| `uibuilder.log` / `paletteCategory` / `editorUibInstances` errors | 11 | 0 |
| UIBUILDER node types registered | 0/11 | 11/11 |
| Registrations after the editor module's load event | 0 | 11/11 |
| Separate Monaco `javascriptDefaults` error | 1 | 1 |

The unchanged UIBUILDER module also throws at `editor-common.js:449` when its Monaco declaration injection reaches `monaco.languages.typescript.javascriptDefaults`. That observation appears separately in both traces. The measured repair covers editor-plugin completion and the 11 dependent node registrations.

## Two loading paths

Startup already waits for plugins before loading nodes. Online installation has independent plugin/node notifications, asynchronous settings/catalog/HTML requests, and this editor plugin:

```html
<script type="module" async
        src="./resources/node-red-contrib-uibuilder/editor-common.js"></script>
```

The original loader's relative-script condition excludes paths beginning with `.`. This module bypasses its `onload` completion path. The dynamic plugin handler also starts its requests independently of the node handler. The recorded WebSocket frame lists **plugin/added first, node/added second**; script execution still runs later.

The [small patch](editor-order.patch) does three things:

1. Routes `./` and `../` scripts through the existing script-load completion callback.
2. Records the pending plugin batch at notification entry, before settings/catalog requests. It counts resource sets, including an editor set whose `plugins` array is empty.
3. Waits at the common `appendNodeConfig` entry, covering startup, added and enabled nodes. An empty batch or a failed plugin HTML request releases that batch's completion barrier.

## Run the source regression

Python 3 and Node.js are enough for this deterministic check. Scratch output stays in `temp/`.

```sh
LAB_FILES=research/node-red-editor-plugin-order  # or the extracted download directory
mkdir -p temp/node-red-plugin-order

# Expected exit 1: a node is appended before the plugin scripts finish.
node "$LAB_FILES/check-plugin-barrier.cjs" "$LAB_FILES/upstream-red-5.0.9.js"

python3 "$LAB_FILES/apply-order-fix.py" "$LAB_FILES/upstream-red-5.0.9.js" \
  temp/node-red-plugin-order/red-source-fixed.js
node "$LAB_FILES/check-plugin-barrier.cjs" temp/node-red-plugin-order/red-source-fixed.js
```

The check retains the real source's plugin handler and common node appender. It holds plugin script completion after both HTML responses, checks the whole batch, then releases it. The patched source passes; failed HTML and empty notifications also complete their barriers.

For a source checkout, apply `editor-order.patch` at the Node-RED repository root, then use its documented build process.

## Repeat the real browser installation

Node 24, npm, Python 3 and an installed Chrome are required. These commands install the fixed package versions in a task-local runtime. The two run names must be fresh; reinstalling into an existing user directory exercises a different path.

```sh
LAB_FILES=research/node-red-editor-plugin-order  # or the extracted download directory
export NODE_RED_LAB_ROOT="$PWD/temp/node-red-plugin-order"
mkdir -p "$NODE_RED_LAB_ROOT/runtime"
npm --prefix "$NODE_RED_LAB_ROOT/runtime" install --no-audit --no-fund \
  node-red@5.0.9 playwright@1.57.0
export CHROME_PATH=/usr/bin/google-chrome

node "$LAB_FILES/reproduce.mjs" stock before
python3 "$LAB_FILES/apply-order-fix.py" \
  "$NODE_RED_LAB_ROOT/runtime/node_modules/@node-red/editor-client/public/red/red.js" \
  "$NODE_RED_LAB_ROOT/red-fixed.js"
node "$LAB_FILES/reproduce.mjs" fixed after
```

The patched run serves the patched unminified editor bundle to this browser and delays the real editor module by 600 ms. UIBUILDER stays unchanged. Each run saves its full trace, screenshot and server log under the lab directory; its temporary browser and server close afterward. The fixture uses a local admin API and no external service credentials.

The original reporter's Windows/Vivaldi setup is the independent rerun target. The patch, source regression and fresh-install fixture are ready for that check.

## Source and license

The included editor source is the exact Node-RED **5.0.9** `red.js`; its copyright header is preserved. Upstream source, patch and these diagnostic helpers use [Apache-2.0](LICENSE). See [NOTICE](NOTICE).
