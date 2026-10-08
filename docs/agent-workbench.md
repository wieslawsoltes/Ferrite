# Agent workbench

This change adds an opt-in, local agent bridge alongside the existing Cargo bridge. The browser remains a static application; provider credentials and real processes belong to the local bridge.

## Contracts

- One schema-validated tool registry serves the built-in coding harness and external MCP clients.
- File edits use expected-content hashes and previewable transactions. Native execution is explicitly trusted, not advertised as a sandbox.
- The harness journals messages, tool outcomes, approvals, usage and compaction boundaries. Recovery never silently repeats an interrupted side effect.
- Context compaction retains complete tool-call/result groups, task constraints and recent turns; full transcripts remain inspectable.
- Provider keys stay in bridge memory or the process environment, never browser storage, workspace files or model context. Model identifiers are discovered from provider APIs rather than guessed.
- Native terminals use real PTYs on POSIX; browser-only utilities have an explicitly bounded command surface and never pretend to be Cargo or an operating system.
- IDE commands are routed to a connected IDE with revision checks, deadlines and explicit capability discovery.

Implementation and validation details will be recorded here with the source changes. Compatibility with every feature of commercial coding agents is not implied.
