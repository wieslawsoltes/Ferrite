# Ferrite native agent workbench

**Ferrite 0.8 defaults to a bridge-free browser agent.** Open the Coding Agent window and use API sign in without installing or starting anything locally. See [Browser agent](browser-agent.md) for that mode. The Node/Python/bridge requirements below apply only to optional **native** mode, chosen with Connect.

Ferrite 0.7 adds a local coding-agent runtime, a shared MCP tool server, and **Coding Agent** / **Terminal** tool windows. The static IDE remains usable without an agent, credentials, a server, or npm dependencies. Native tools operate on a persistent, explicitly selected checkout, not on a disposable copy.

## Start the workbench

Requirements: Node.js 22+, Python 3 for native POSIX terminals, and the native tools you intend to use. Install Cargo/rustc and rust-analyzer/rust-src for full Rust compilation and semantic analysis. macOS and Linux use the Python standard-library PTY helper; on Windows run the bridge inside WSL. No pretend Cargo implementation or simulated native process output is used.

```sh
# Terminal 1: serve the IDE from the Ferrite repository.
python3 -m http.server 8080

# Terminal 2: start the agent bridge on the actual project checkout.
node tools/agent-bridge.mjs \
  --workspace /absolute/path/to/project \
  --trust-workspace
```

Open `http://localhost:8080`, open **Coding Agent**, press **Connect**, and enter the loopback URL and bearer token printed by the bridge. Confirm the host-execution warning. Tokens remain in memory, not URL query parameters or browser storage.

For the deployed GitHub Pages IDE, explicitly allow its origin:

```sh
node tools/agent-bridge.mjs \
  --workspace /absolute/path/to/project \
  --trust-workspace \
  --origin https://wieslawsoltes.github.io
```

Repeat `--origin` for additional exact origins. Custom origins replace the default localhost:8080 allowlist. The bridge binds to 127.0.0.1, validates Host and Origin, and requires its bearer token. It is not a remotely exposed OAuth service. Browser local-network restrictions may require a permission prompt; using the local HTTP IDE avoids remote-page restrictions.

Choose OpenAI, Anthropic, or Gemini and **API sign in**. The bridge validates the key against the provider's model-list endpoint before retaining it in memory. **Models** refreshes that account's catalog. Select a model that supports tool calling; a listed model is not necessarily suitable for this harness. Nothing depends on guessed model identifiers. Environment variables `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) are also accepted. Do not put credentials in source files, task prompts, or MCP tool arguments.

Press **Import native workspace** only after saving/exporting important browser-only edits. This explicitly replaces the browser snapshot with supported native text files and enables bidirectional synchronization. Native tools can already use their checkout without importing it, but source-dependent IDE commands require synchronization. Outgoing changes carry expected SHA-256 hashes; incoming changes use a three-way baseline. Divergent edits, or edits typed while synchronization is in flight, become conflicts instead of being overwritten.

Enter a task and choose a permission mode:

| Mode | File reads | File changes | Native execution / Rust analysis |
| --- | --- | --- | --- |
| Ask | Allowed | Approve each operation | Approve each operation |
| Auto-edit | Allowed | Allowed | Approve each operation |
| Read-only | Allowed | Denied | Denied |
| Trusted | Allowed | Allowed | Allowed after explicit mode confirmation |

An approval is bound to a single operation, can be denied or cancelled, and expires. File mutations show before/after previews. Compiler commands that may invoke native builds are execution-gated. rust-analyzer also requires execution permission because native project loading can run build scripts/procedural macros. The browser MIR worker is bounded, but native execution is **not an operating-system sandbox**.

## Harness, recovery and context

The provider-neutral harness streams responses, executes tool calls, feeds back outcomes, and continues until the model finishes or an explicit budget/stop condition fires. Read tools can run concurrently; mutations are serialized in a turn. Retryable provider failures use bounded exponential backoff and Retry-After. Authentication and malformed output fail visibly. Incomplete streamed tool arguments are never dispatched.

Sessions retain the original task, latest human directive, pinned constraints, visible plan, full transcript, current compacted messages, usage, tool ledger and bounded audit journal. New/load/resume/stop/fork/export work from the IDE. A process lease prevents two runtimes from writing the same state directory. State defaults to `~/.local/state/ferrite/<checkout-hash>` and can be changed with `--state`; it must be outside the source workspace. Directories are private and state files are written using private temporary files, fsync and rename.

A tool ledger is saved **before** a side effect starts. On restart, a tool recorded as started without a durable outcome is reported as uncertain; the harness does not automatically replay it. Recovery must inspect the workspace or process outcome. This is not a claim of exactly-once external effects across arbitrary crashes. Native PTYs do not survive bridge process termination, although their recorded events remain in the session journal.

On normal shutdown the state lease is released. After SIGKILL/power loss, a `runtime.lock` may remain. Its JSON contains the recorded PID. Stop any other owner and verify that PID is no longer running before manually removing the lock. Do not delete it just to make a second runtime start. Use a distinct `--state` for an independent CLI instance, or connect external clients to the running bridge.

Compaction runs before the configured context budget is exhausted and is also available explicitly in **Context**. It removes only complete assistant-tool/result groups, preserves the latest task directives and pinned constraints, and retains recent complete transactions. It attempts model summarization with a bounded deterministic fallback; summary failure does not erase the full transcript. Older details can still be read from exported history/artifacts. Compaction is intentionally lossy, not lossless arbitrary-memory compression.

Context usage is labeled as an estimate (UTF-8 size heuristic), not a provider tokenizer. Actual provider input/output/cached usage is recorded separately. Defaults include 32,768 context tokens, 4,096 output reserve, 40 model turns and 300 tool calls per run. Configure budgets in **Context** or with CLI flags. A repeated identical tool batch terminates rather than looping forever. Plans, child research agents, model retries, approvals and compactions appear in the execution trace. The durable trace is bounded to 1,000 events/approximately 2 MB; live text deltas are not duplicated into that journal.

Provider-native reasoning/signature data needed for continuation is preserved in protocol history. The UI shows task execution and tool events, not a claim to expose private model reasoning. Changing provider/model starts a compatible summarized boundary instead of forwarding another provider's signed state.

## Shared MCP and IDE tools

The same schema-validated registry supplies the built-in agent, HTTP tools, and MCP. It includes native terminal lifecycle/interaction tools, a Rust-language dispatcher with **44 allowed LSP/Rust methods** and an IDE dispatcher with **21 explicit commands**. Discovery returns the actual schemas and annotations. No arbitrary browser JavaScript execution is exposed.

| Area | Tools |
| --- | --- |
| Workspace | `workspace_list`, `workspace_read`, `workspace_search`, `workspace_apply`, `workspace_replace`, `workspace_patch` |
| Recovery/context | `checkpoint_list`, `checkpoint_restore`, `artifact_read`, `instructions_read` |
| Native execution | `process_exec`, `cargo`, `git_inspect` |
| PTY lifecycle | `terminal_open`, `terminal_list`, `terminal_read`, `terminal_input`, `terminal_resize`, `terminal_signal`, `terminal_close` |
| Interactive TUI / ncurses | `terminal_screen`, `terminal_wait`, `terminal_key`, `terminal_paste`, `terminal_mouse` |
| Compiler/Rust | `compiler_analyze`, `compiler_inspect`, `compiler_execute`, `rust_language` |
| IDE/agent | `ide_inspect`, `ide_command`, `plan_update`, `agent_delegate` |

`compiler_analyze` / `compiler_inspect` expose the existing Ferrite compiler's real 21-stage outputs, including tokens, AST/HIR, symbols/types, traits/ownership, generic instances, MIR/CFG, optimizations, call graphs, WebAssembly and generated JavaScript. `compiler_execute` runs bounded MIR or supported tests. These are the **documented browser Rust subset**, not a new full rustc implementation. Use `cargo` for full native Rust. Large results are retained as paged artifacts rather than silently inserted in full into model context.

`rust_language` routes installed rust-analyzer requests: completion/resolve, hover, definition/declaration/type-definition/implementation, references, symbols, signatures, prepare-rename/rename, formatting, actions/lenses/inlay hints and resolution, folding/selection ranges, semantic tokens, call/type hierarchies and Rust-specific syntax/HIR/MIR/macro/crate views. Positions are zero-based UTF-16 LSP positions. Returned edits are previews and are not automatically applied. Support depends on the installed server and its capabilities; unavailable methods fail explicitly rather than fabricating results.

`ide_command` supports editor open/select/state, panel open/move/float, layout reset, compiler check/build/run/test/debug/stop, visualizer stage/instance, debugger step/step-line/continue/pause/breakpoints and workspace search. Use `ide_inspect` and pass `expectedRevision` for source-dependent operations. State is heartbeated, so an intervening edit can correctly reject a stale request. Only one live browser owns the IDE bus; ownership, timeouts, disconnect and replies are checked.

`agent_delegate` starts a bounded read-only child with the parent's provider/model, charges child usage to the parent and propagates cancellation. Children cannot edit, launch native processes, or delegate recursively. This is not an unlimited autonomous swarm.

MCP transports implement newline-delimited stdio and authenticated loopback Streamable HTTP. Protocol handling covers legacy **2025-11-25** initialization/notifications and **2026-07-28** per-request metadata/server discovery. Tools, workspace/IDE/capability resources, resource templates and review/compiler prompts are discoverable. Unadvertised optional features (such as resource subscriptions/server-initiated sampling) are not claimed. HTTP GET is 405 because no long-lived notification stream is advertised.

### External coding agents: reuse the connected bridge

The stdio proxy lets external clients use the running IDE, its checkout and approval UI. Configure the token privately and keep it out of repository-level config. For Claude Code / Gemini CLI, the equivalent server entry is:

```json
{
  "mcpServers": {
    "ferrite": {
      "command": "node",
      "args": ["/absolute/path/to/Ferrite/tools/agent-mcp.mjs", "--bridge", "http://127.0.0.1:8790"],
      "env": {"FERRITE_AGENT_TOKEN": "<private bridge token>"}
    }
  }
}
```

For Codex, use its TOML MCP configuration, not the preceding JSON:

```toml
[mcp_servers.ferrite]
command = "node"
args = ["/absolute/path/to/Ferrite/tools/agent-mcp.mjs", "--bridge", "http://127.0.0.1:8790"]
env_vars = ["FERRITE_AGENT_TOKEN"]
tool_timeout_sec = 660
```

Set `FERRITE_AGENT_TOKEN` in the environment that launches the MCP client. Alternatively, point an HTTP-capable MCP client at `http://127.0.0.1:8790/mcp` with `Authorization: Bearer <token>`. Ferrite's bridge token authenticates local tools; it is not a model-provider API key or consumer-account login token.

For a standalone headless MCP server, with no live browser IDE, use:

```sh
node tools/agent-mcp.mjs --workspace /absolute/checkout --trust-workspace
# Add --allow-writes and/or --allow-exec only when intentionally granting those capabilities.
```

## Terminal and headless agent

**New native** launches a real `/bin/sh -i` PTY in the chosen checkout. Terminal state, stdin, job control, foreground signals, resize, exit codes, Unicode output, cursor movement, alternate screen and bracketed paste are implemented. Select installed Codex, Claude or Gemini CLIs, or their available login launcher, from the terminal menu. Those applications must be installed separately. Their own authentication is separate from Ferrite API sign-in: launching `codex login`, `claude auth login` or interactive `gemini` does not repurpose consumer-account credentials for Ferrite provider calls.

Agent PTYs have explicit ownership; another agent cannot read/input a user's terminal. Output is bounded and cursor gaps are reported. Terminal control strings are rendered as text/state, never inserted as HTML or executed as browser code. OSC clipboard commands are not executed. The native renderer is pinned xterm.js 6.0.0, backed by the same headless engine even without a browser. It supports ncurses alternate screens, ACS line drawing, colors, Unicode, keyboard/mouse protocols and resize; scoped MCP screen/wait/key/paste/mouse tools operate the same applications. Reconnection restores sequence-stamped buffers and protocol state, not arbitrary truncated escape fragments. Terminals idle for 30 minutes are closed. See [Terminal and ncurses](terminal.md) for the complete contract, reproducible assets, API examples, security limits and validation.

The separate **Browser shell** provides bounded utilities over the in-memory editor workspace: `help`, `pwd`, `cd`, `ls`, `cat`, `echo`, `printf`, `head`, `tail`, `wc`, `grep`, `find`, `sort`, `uniq`, `cut`, `tr`, `touch`, `mkdir`, `rm`, `cp`, `mv`, `basename`, `dirname`, `clear`, `history`, `true`, `false`, `date`, `env`, `export`, `which`. Quoting, variables, pipes, conditionals and redirection are supported with an explicitly limited option surface. It is not a POSIX/GNU implementation, OS emulator, network shell or Cargo runtime. Full installed Unix commands run through native PTYs / `process_exec`.

The same coding harness also runs as a real CLI:

```sh
# Keep the provider key in the environment, not the command arguments/history.
node tools/agent.mjs --workspace /absolute/checkout --trust-workspace \
  --provider openai --models

node tools/agent.mjs --workspace /absolute/checkout --trust-workspace \
  --provider openai --model YOUR_TOOL_CAPABLE_MODEL \
  "Inspect the failing test, propose a fix, and verify it."

node tools/agent.mjs --workspace /absolute/checkout --trust-workspace \
  --resume SESSION_ID
```

Interactive CLI approval prompts use the real terminal. Noninteractive execution denies operations that need an unanswered interactive approval. Use `--mode`, `--context`, `--output`, `--steps`, `--sessions`, and `--state` as documented by `--help`. Do not start a second writer against a running bridge's state directory.

## Security and operational limits

Native commands have the host user's filesystem and network privileges. File-tool path/symlink/credential restrictions are defense in depth, **not containment of shell commands, Cargo build scripts, rust-analyzer or installed coding agents**. Use a disposable user/container/VM when code is untrusted. User-approved native processes may execute arbitrary programs; Ferrite does not claim to sandbox them.

API keys are redacted from observations and artifacts; known revoked keys remain in the in-memory redaction set until shutdown. Spawned child environments strip model keys and bridge-token variables. Do not assume this hides credentials from other processes of the same OS user or from a shell explicitly loading its own credential files. API sign-out removes active provider credentials, but exported transcripts may contain sensitive source/task text. Treat state and session exports accordingly.

Text tools intentionally bound file size, snapshots, result sizes, process duration/output, subprocess count, terminal history, active sessions and transcript storage. Native checkout content is not reduced to the IDE's text snapshot for Cargo: Cargo.lock, `.cargo`, local/git/registry dependencies, build scripts, incrementals and full argument vectors such as `--jobs 8` remain native. File discovery skips a fixed set of generated/credential directories; it is not a complete gitignore evaluator.

This implementation supplies a working integrated harness and MCP surface, not full feature parity with every commercial coding agent, all MCP optional extensions, every terminal protocol or all Rust IDE features. Provider wire behavior is tested with deterministic fixtures; real billing/authentication across live accounts requires the corresponding account and API entitlement. Current tests do not prove all 44 installed rust-analyzer method/version combinations.

## Validation

```sh
npm run check
npm test
npm run test:agent
npm run test:native
npm run test:browser
npm run test:agent:browser
```

Node tests cover provider stream fragmentation/signature preservation, incomplete-output rejection, secret redaction, retry/error behavior, compaction, ledger recovery, state ownership, schema validation, checkpoints/patches, workspace synchronization races, MCP lifecycle/metadata/authentication, real processes/PTYS, VT rendering and browser utility semantics. Browser acceptance drives real visible controls and a real local bridge with deterministic provider API fixtures; it verifies edits and approval previews, compiler execution, source synchronization, the trace/context/tool explorer, revision-checked IDE commands, native terminal input, actual ncurses keyboard/Unicode/mouse/resize/tab/reconnect interactions, alternate-screen restoration, fork and sign-out. CI additionally exercises installed Cargo/rust-analyzer and normal HTTP browser networking.

For restricted test environments, `FERRITE_MEMORY_TEST=1` loads the same browser source in memory. In agent acceptance, that mode explicitly injects only HTTP transport through a Python binding; it does **not** establish that normal browser loopback/CORS networking works. Screenshots and machine-readable results are retained under `artifacts/agent-browser`.

## Protocol references

Implementation references (reviewed 2026-10-08):

- [MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28), [legacy MCP](https://modelcontextprotocol.io/specification/2025-11-25).
- [OpenAI Responses/function calling](https://developers.openai.com/api/docs/guides/function-calling), [Codex MCP](https://developers.openai.com/codex/mcp).
- [Anthropic streaming](https://platform.claude.com/docs/en/build-with-claude/streaming), [Claude Code MCP](https://code.claude.com/docs/en/mcp).
- [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling), [Gemini CLI MCP](https://geminicli.com/docs/tools/mcp-server/).
- [LSP 3.17](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/), [rust-analyzer extensions](https://rust-analyzer.github.io/book/contributing/lsp-extensions.html).
- [Python PTY](https://docs.python.org/3/library/pty.html).
