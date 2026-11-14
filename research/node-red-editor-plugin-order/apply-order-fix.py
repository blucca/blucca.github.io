#!/usr/bin/env python3
"""Patch Node-RED 5.0.9 source/unminified editor bundle; assert the known source shape."""
from pathlib import Path
import sys

source = Path(sys.argv[1]).read_text()
changes = [
    ('var RED = (function() {', '''var RED = (function() {
    // Dynamic node definitions depend on the preceding plugin notification's scripts.
    var pendingPluginLoads = Promise.resolve();'''),
    (r'!/^\s*(https?:|\/|\.)/.test(srcUrl)', r'!/^\s*(https?:|\/)/.test(srcUrl)'),
    ('''        appendConfig(
            nodeConfig,
            /<!-- --- \\[red-module:(\\S+)\\] --- -->/.exec(nodeConfig.trim()),
            "#red-ui-editor-node-configs",
            done
        );''', '''        pendingPluginLoads.then(function() {
            appendConfig(
                nodeConfig,
                /<!-- --- \\[red-module:(\\S+)\\] --- -->/.exec(nodeConfig.trim()),
                "#red-ui-editor-node-configs",
                done
            );
        });'''),
    ('''            if (topic == "notification/plugin/added") {
                RED.settings.refreshSettings(function(err, data) {''', '''            if (topic == "notification/plugin/added") {
                var finishLoading;
                var pluginsLoaded = new Promise(function(resolve) { finishLoading = resolve; });
                pendingPluginLoads = Promise.all([pendingPluginLoads, pluginsLoaded]);
                var remaining = msg.length;
                function finishPlugin() {
                    if (--remaining === 0) { finishLoading(); }
                }
                if (remaining === 0) { finishLoading(); }
                RED.settings.refreshSettings(function(err, data) {'''),
    ('''                                    appendPluginConfig(data);
                                }
                            });''', '''                                    appendPluginConfig(data, finishPlugin);
                                },
                                error: finishPlugin
                            });'''),
]
for before, after in changes:
    assert source.count(before) == 1, f'Expected one patch location: {before[:90]!r}'
    source = source.replace(before, after, 1)
Path(sys.argv[2]).write_text(source)
print(f'Patched {len(changes)} known source locations: {sys.argv[2]}')
