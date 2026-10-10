# Anthropic coding-agent integration

The browser and native agent share `AnthropicProvider` and the Messages response accumulator in `AnthropicMessage`. Model IDs come from the provider's models API; no guessed model aliases are required by this fix. Direct browser use still requires explicit key-exposure/billing consent and the Anthropic browser opt-in header. Keys are memory-only; workspace and execution approvals remain in force.

## Response and editing contract

A streamed tool starts with an object-valued `input`, usually `{}`. A no-argument tool can emit no JSON deltas, empty-only deltas, or serialized `{}`. Empty fragments must not replace the initial object. Nonempty fragments are accumulated independently for each content index and parsed once, after the complete response has arrived.

`content_block_stop` is not sufficient to authorize execution: the terminal `message_delta` can subsequently report `max_tokens` or `model_context_window_exceeded`. The adapter classifies those statuses before attempting to decode unfinished source edits. Missing terminal events, malformed/non-object inputs, duplicate tool identifiers, unclosed blocks and inconsistent tool/stop states cannot become successful tool calls. No tools from a rejected response enter the execution ledger. Previously completed turns are not rolled back or repeated.

Replay preserves signed thinking, redacted thinking, citations and tool-use identifiers. Empty text blocks are omitted from outbound history without mutating the durable session. Adjacent results for parallel tools are combined into the immediately following user message; error results retain `is_error` so the model can repair a bad tool invocation. Tool results are untrusted context, not new user permissions.

## Recovering a failed task

After updating the app, reload, sign into Anthropic again, select the failed session, and use **Resume**. Keys are intentionally not restored from browser storage.

An **output limit** error means that no tools from that response executed. In the **Context** tab, increase **Output reserve**, then resume explicitly. A context-window error instead requires compaction or a new session. Malformed tool input requests a fresh response on resume; the adapter never guesses missing JSON or executes a partially reconstructed edit. Temporary overload/rate/API errors and incomplete transport streams use the harness's bounded retries; permanent authentication errors do not.

## Regression coverage

`npm run test:agent` includes fragmented UTF-8/CRLF SSE, empty arguments, interleaved content indices, signatures/citations, replay ordering, malformed input, JSON fallback, terminal status, cancellation, error sanitization, schema-error correction, hash-protected edits, real UI compilation, output-limit resume and retry idempotence.

`npm run test:browser-agent` also runs `tools/anthropic-agent-acceptance.py` against the actual HTTP IDE in Chromium. It opens the Timer sample and exercises six Messages turns: discovery, parallel source reads, approved atomic two-file editing, compiler-worker analysis, approved preview and final response. The test then clicks the generated increase/decrease buttons, checks 0–30-second bounds, verifies both source diffs and checks real IndexedDB/local/session storage for key leakage. Screenshots and machine-readable evidence are retained in `artifacts/anthropic-agent/` by the normal validation workflow.

Provider responses are deterministic protocol fixtures. These tests validate Ferrite's real agent, compiler, workspace, approvals and UI execution, not a paid account's current model entitlement, billing, latency or stochastic coding quality. The Chromium test needs HTTP navigation and browser storage; environments that prohibit localhost browser navigation must run it in normal CI instead of treating in-memory module injection as equivalent validation.

Protocol references: [Messages streaming](https://platform.claude.com/docs/en/build-with-claude/streaming), [handling tool calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls), and [stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons).
