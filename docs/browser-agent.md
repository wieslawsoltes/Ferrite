# Bridge-free coding agent

## Reference audit

Reviewed VB6's `src/agents/agent.js`, `providers.js`, `changes.js`, and `followups.js` on 2026-10-08. VB6 runs its agent loop and IDE tools in the page, sends API-key requests directly to fixed provider endpoints, treats its relay as optional, retains complete provider tool transactions for compaction, provides change review and explicit follow-up queues, and revokes authorization when the project changes. Its ChatGPT-account integration still requires a relay; it is not a browser-only API-key replacement.

Ferrite will use the same browser-first separation while sharing its existing tested harness, provider adapters, MCP schemas, approvals and compiler workers with the native runtime. The browser adapter must operate on the actual editor workspace rather than a disconnected simulated filesystem. No local Node process, Python process or loopback connection may be required for browser mode.

The browser execution boundary is explicit: browser compiler/MIR/WebAssembly and bounded workspace shell utilities are supported. Installed rustc/Cargo, rust-analyzer, native PTYs and external desktop CLIs remain optional native capabilities and must never be fabricated by browser tools.

API keys are user-supplied, held in memory only, sent to their fixed provider origin, never embedded in the deployed application. Direct-browser credentials are visible to page code/browser extensions; the user must explicitly consent to that risk and provider billing. CORS failures are reported, not bypassed with public proxies. Native bridge mode remains available without becoming a prerequisite.

Implementation and validation details are added with the subsequent commits.
