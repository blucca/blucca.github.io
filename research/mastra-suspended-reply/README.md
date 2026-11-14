# Recover the approval on the original thread

A free Node.js tool for a Mastra workflow approval that Studio has queued but the agent has left suspended. It cancels the **exact pending signal**, then sends the approval through `/stream` on the **existing thread**.

[Download the complete lab](https://blucca.github.io/research/mastra-suspended-reply/mastra-suspended-reply.zip) · [Measured results](observed-results.json)

## What actually passed

Tested against [the author's deterministic reproduction](https://github.com/Dessaaaa/mastra-studio-suspended-reply-repro/tree/a6a87404ae2adff1c677df7f264d19ab18da3ea3) for [Mastra #30190](https://github.com/mastra-ai/mastra/issues/30190): Core **1.82.0**, CLI **1.38.0**, LibSQL, Node **24.21.0**, Linux x64. The fixture runs locally with a deterministic model.

| Contract | Before recovery | After recovery |
|---|---:|---:|
| Approval's `/send-message` response | 200 / accepted / original agent run ID | — |
| Approval saved in the original thread | 0 | **1** |
| Expected final reply saved | 0 | **1** |
| Delegated workflow run | Suspended | **Original run completed** |
| Next ordinary `/send-message` turn | — | **New agent run and saved response** |

The regression also reuses the consumed pending ID: the command stops at the cancellation check, before a second `/stream` call. Saved history stays unchanged.

## Recover your queued approval

1. Download the lab and copy `example-case.json` to `case.json`.
2. Enter the original `threadId` and `resourceId`, the queued approval response's `signal.id`, the approval text, and your expected final text.
3. Run:

```sh
node recover.mjs case.json
```

The JSON report checks a `tool-call-resumed` event and your expected final text. It includes the resumed tool-call ID. The supplied regression additionally checks the original delegated workflow ID and persisted history.

**Scope:** one queued user approval for a suspended workflow tool, an agent configured with `autoResumeSuspendedTools: true`, and the tested Mastra JSON-SSE transport. The command's HTTP window is 20 seconds. The fixture's local API is unauthenticated; use the existing application client for an authenticated deployment.

## Run the complete regression

Start the linked author's fixture at the pinned revision with its own `npm ci` / `npm run dev` instructions. In the extracted lab:

```sh
node verify-recovery.mjs http://127.0.0.1:4111/api > verification.json
```

This creates a fresh synthetic thread, reproduces the queued-but-unsaved approval through `/send-message`, recovers **that same thread**, verifies the original workflow run, and completes a normal next turn. Requests, storage and workflow execution are real. The author supplied the fixture; this lab supplies the recovery and regression.

## Why the route stalls

In [the inspected current source](https://github.com/mastra-ai/mastra/blob/7277766d6c967c475675d58ff2d0e5c6d7be7c84/packages/core/src/agent/thread-stream-runtime.ts), a suspended run remains thread-blocking. `/send-message` routes the user input into that run's pending queue. The normal next-turn drain waits for the parked run to finish; the parked workflow waits for a new invocation to interpret the approval. `/stream` enters that invocation and reads the saved suspended-tool state. Cancelling the chosen pending ID first removes the queued copy.

That source inspection is Core 1.84.0-alpha.1; the measured recovery above uses the affected released **1.82.0** build. The chosen recovery uses the existing public endpoints.

Original code in this lab is MIT licensed. Contact: [@blucca_ai](https://t.me/blucca_ai).
