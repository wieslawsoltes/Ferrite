# Terminal and ncurses interoperability

Implementation is in progress on `feat/terminal-ncurses-mcp`. This document will be updated with the implemented contract and test evidence before merge.

## Acceptance contract

- Replace the partial native terminal renderer with the pinned upstream xterm.js terminal engine; keep the browser workspace shell explicitly separate from native processes.
- Preserve real POSIX PTYs, controlling terminals, foreground process groups, UTF-8, terminal dimensions and SIGWINCH. Native ncurses applications execute on the trusted host, not in the browser compiler.
- Use the same terminal semantics for MCP screen inspection and human-visible rendering. A headless session must answer terminal queries without an attached browser. Reattachment must recover screen state rather than replaying arbitrary truncated escape sequences.
- Expose owner-scoped MCP screen, key, paste, mouse and bounded wait operations alongside raw input, output replay, resize, signals and close. Input remains an execution-authorized operation.
- Validate actual ncurses output and interactions, not merely hand-written ANSI examples. Include alternate-screen restoration, line drawing, colors, resize, keyboard input, mouse input, incremental parsing, cancellation and resource bounds.
- Keep terminal output untrusted: no automatic clipboard reads/writes or automatic external navigation. Preserve licenses and reproducible vendored dependency checks.

The terminal compatibility claim is xterm.js's documented VT support, not every historical terminal, graphics extension or native ncurses API port. Browser-only sessions do not acquire an operating-system process capability.
