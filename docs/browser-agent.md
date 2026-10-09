# Bridge-free coding agent

Ferrite 0.8 runs the coding harness **inside the browser by default**. Open the hosted IDE and the Coding Agent tool window; it should say **Ready · browser**. There is no local Node/Python process, bridge token, localhost connection, or installation prerequisite for this mode. The model API still needs network access and a user-provided API key.

## Use it

1. Open **Coding Agent**, choose OpenAI, Anthropic, or Gemini, and press **API sign in**. Review the direct-browser credential and billing warning, enter your API key, and explicitly check the consent box. The API validates the key through model discovery before retaining it in memory.
2. Select a tool-capable model from the discovered catalog. Listing a model does not guarantee it supports this harness's generation/tool protocol.
3. Enter a task against the project already open in the editor. There is **no import/synchronization step** in browser mode: tools use that live project. Review the permission mode and press **Run task**.
4. Review edit previews and execution approvals. Watch **Chat**, **Trace**, **Context**, and **Tools**. Answer local questions in the agent panel. Use **Stop** to revoke the run; interrupted side effects are never automatically replayed.

**Use browser** re-enables the browser runtime after a disconnect or native session. **Connect** still selects the optional native bridge; it is not required for API sign-in in browser mode. Switching modes or replacing/importing the project cancels the previous browser runtime, clears its provider credentials, and opens a separate project-scoped journal. Selecting another example therefore cannot authorize late writes into that example.

Direct requests go only to fixed official provider origins, with cookies omitted, redirects rejected, response size/deadline limits, and abortable streams. Anthropic's documented browser-access opt-in header is included. CORS, network, account, model-access and quota failures remain visible. Ferrite does not bypass browser security, use a public proxy, change accounts, or silently switch to another billing method.

## Credential boundary

A key entered into a web page is accessible to code executing in that page and potentially browser extensions. Use browser mode only in a trusted copy of Ferrite and a trusted browser profile, preferably with a dedicated, restricted API key and provider-side spending limits. This personal bring-your-own-key mode is **not** a design for embedding a shared secret in a public application.

Keys are held in memory only. They are never stored in localStorage, sessionStorage, IndexedDB, the project, exported sessions, URL parameters, or terminal command arguments. Known secrets are redacted from persisted observations and artifacts. API sign-out cancels that provider's active runs and pending authentication; a late response cannot revive credentials or execute tools. A reload requires signing in again. Project source, task text, and tool observations are sent to the selected provider as needed to carry out an explicitly started task; treat those as sensitive information.

Consumer ChatGPT/Claude/Gemini subscriptions and installed CLI account logins are not API keys. This mode does not implement a relay-free consumer-account OAuth login or reuse credentials from those programs.

## Tools and actual execution

The browser runtime exposes **21 schema-validated tools**, shared with the native harness wherever their implementations are portable:

| Area | Tools |
| --- | --- |
| Live project | `workspace_list`, `workspace_read`, `workspace_search`, `workspace_apply`, `workspace_replace`, `workspace_patch` |
| Recovery/context | `checkpoint_list`, `checkpoint_restore`, `artifact_read`, `instructions_read` |
| Compiler and editor | `compiler_analyze`, `compiler_inspect`, `compiler_execute`, `rust_language`, `ide_inspect`, `ide_command` |
| Agent and shell | `plan_update`, `agent_delegate`, `user_question`, `browser_shell`, `cargo` |

Workspace writes require SHA-256 expected hashes, preview the exact operation, and commit to the actual editor model atomically after rechecking its revision. Multi-file creation, editing and deletion form a single undo transaction. Checkpoints are recorded before mutation and restored only when current file hashes still match the original outcome. Literal replacements preserve `$` characters verbatim and reject amplification beyond the file-size budget before allocating output. No fuzzy matching or blind overwrite is used.

Compiler operations run in an isolated, cancellable worker. That worker and the native agent worker call the **same CompilerOperation implementation**, with Ferrite's actual CompilerSession and MIR machine. Agent execution and tests do not run generated JavaScript in the page. The 21 real compiler stages, diagnostics, MIR execution, supported tests and WebAssembly output remain inspectable; IDE commands can control the existing source-linked visualizer/debugger. Edits cannot implicitly authorize native auto-check: select a browser backend before browser-agent edits when the IDE was previously configured for native compilation.

Browser Rust analysis derives results from tokens, AST, typed HIR, semantic symbols and binding identities. Its **13 supported methods** are `textDocument/documentSymbol`, `workspace/symbol`, `textDocument/hover`, `textDocument/definition`, `textDocument/references`, `textDocument/completion`, `textDocument/inlayHint`, `textDocument/foldingRange`, `textDocument/prepareRename`, `textDocument/rename`, `rust-analyzer/syntaxTree`, `rust-analyzer/viewHir`, and `rust-analyzer/viewMir`. The Rust-specific method names are compatibility dispatch names, **not an installed rust-analyzer server**. Rename returns a hash/revision-checked preview for resolved local/parameter bindings, including declarations and uses; module/import/function rename requires native analysis. Completion is labelled as an incomplete document candidate list, not guaranteed scope-aware completion. Positions are zero-based UTF-16.

In-page MCP JSON-RPC uses the same real tool registry, resources and prompts. There is **no HTTP listener or stdio process in browser mode**. An external desktop MCP client needs the optional native server; the in-page dispatcher is not advertised as a reachable network server.

## Review, follow-ups and permissions

**Changes** compares the current source with task-start or last-run checkpoints. It shows exact line differences and bounded replacement hunks, with file/hunk restore and unified patch export. Restoration rechecks current hashes and is disabled while any browser task is running. The review includes manual edits since the checkpoint; it does not claim exclusive agent attribution or Git staging. Large files retain complete checkpoint text while their UI diff is explicitly limited.

**Follow-ups** is a persistent per-task queue. Add, edit, reorder, remove, or load messages into the composer. Loading does not send; **Run task** is always an explicit next action. **Stop and prepare follow-up** cancels the run and fills the composer without granting permissions or making another API request. Queues enforce item versions, project identity, 16 messages and 200,000 total characters.

**Permissions** provides per-tool mode defaults, Ask, Allow, or Deny plus a 1–60 minute run lease. Ask prompts for mutations/execution; Auto-edit allows project edits but asks for execution; Read-only denies mutation/execution even if a per-tool rule says Allow. Full browser project access requires explicit local confirmation on **every run** and is still bounded by the selected tool rules and lease. Denying an operation stops the browser run rather than authorizing another way around the denial. Plans and answers grant no permissions. This authority covers browser project tools, not host filesystem access or native processes.

## Terminal and browser Cargo commands

The Terminal window runs the same bounded workspace utilities and pipelines as `browser_shell`. They work on a snapshot and commit the resulting file changes through the live workspace's conflict-checked checkpoint transaction. The user's shell and each agent shell have separate current directories, environment variables and history.

```sh
help
printf 'one\ntwo\n' | wc -l
find .
grep main src/main.rs
cargo check
cargo run
cargo test
cargo metadata
```

Browser `cargo` is an explicitly labelled command adapter to Ferrite's **documented Rust subset**. It supports check/build/run/test/metadata and the supported target/features options; it does not supply an installed Cargo binary, registry downloads, arbitrary build scripts, proc macros or full Rust. Unsupported native options such as `cargo install` or native `--jobs` fail explicitly. Full native Cargo and operating-system utilities are still available by deliberately selecting native mode.

The **same browser coding harness** also accepts terminal control commands; this is not a simulated desktop agent:

```sh
agent help
agent login openai
agent models
agent task "Read the program, fix the greeting, and verify its output."
agent status
agent approvals
agent approve APPROVAL_ID
agent questions
agent answer QUESTION_ID "Keep the existing public API."
agent stop
agent compact
agent sessions
agent resume SESSION_ID
agent fork
agent export
```

`agent login` opens the normal credential/consent dialog; never paste keys into shell commands. Text streaming, tool events, approvals, questions and completion are visible in the terminal and the agent workbench. `agent task` uses the same selected model and reviewed permission profile. Native PTYs and launching installed Codex/Claude/Gemini executables are **not browser capabilities**.

## Persistence, compaction and recovery

Sessions, full protocol transcripts, bounded public traces, checkpoints, review baselines, follow-up queues and artifacts are stored in a project-scoped IndexedDB namespace when IndexedDB and Web Locks are available. A Web Lock prevents two tabs from concurrently writing the same agent journal. A second tab receives an explicit ownership error and can still use its ordinary editor. Disconnect the owner before enabling its browser agent in another tab. Source snapshots use the IDE's existing local persistence independently of agent-journal storage.

When persistent storage or Web Locks are unavailable, the agent remains usable with explicitly labelled **memory-only sessions**; it does not write a potentially shared journal without ownership. Browser settings, eviction, quota, or private browsing can prevent durability. Export important projects and sessions. A storage failure is reported rather than treating a partial transaction as durably complete. Closing the runtime releases its lease even after a storage failure.

The existing shared harness preserves complete assistant/tool-result transactions through compaction, retains task constraints and recent directives, keeps the full transcript, supports model summarization with bounded fallback, and preserves provider-specific opaque continuation data. Context counts are estimates; provider-reported token usage is recorded separately. Switching models/providers creates an explicit summary boundary instead of forwarding signed continuation state to an incompatible model.

A durable tool ledger is written before side effects. Reloaded interrupted sessions report uncertain outcomes; inspect actual files before resuming. Tools are not automatically replayed after model retries. Reads may overlap, mutations are serialized, and read-only child delegation has bounded depth, cancellation and budget accounting. Closing/reloading the page stops its worker and requests; the agent does **not** continue working after the page is gone.

## VB6 architecture comparison

The reference audit covered VB6's `src/agents/agent.js`, `providers.js`, `changes.js`, and `followups.js` on 2026-10-08, at agents subtree `49d9d06029d531ece2b862691cf85204d4c6a083`. Ferrite adopts its browser-local tool loop, direct fixed-origin API transport, optional native relay separation, revision-safe project access, task/run change review, explicit follow-up queue, and project-bound permissions. Ferrite reuses its own existing harness/provider/MCP code and compiler workers rather than copying the VB6 designer/tool implementation. The two IDEs have different languages and capabilities; this is not a claim of bit-for-bit VB6 agent UI or every optional feature.

VB6's ChatGPT-account mode still requires a relay. Ferrite's bridge-free mode uses ordinary provider API keys and never claims to remove that account-authentication requirement.

## Validation

```sh
npm run check
npm test
npm run test:browser-agent
npm run test:agent:browser
npm run test:browser
npm run test:native
npm run test:repositories
```

`test:browser-agent` launches **only the static site and Chromium**, never an agent bridge. It exercises real visible UI, the live workspace, actual compiler worker and shell, approval/review/queue/question flows, the terminal harness, and all three provider wire formats using deterministic API fixtures. Normal HTTP mode additionally verifies Web Crypto hashing, IndexedDB reload recovery, credential non-persistence and cross-tab ownership. External account billing/authentication is not tested by fixtures.

Restricted environments may run `FERRITE_MEMORY_TEST=1`. This uses explicit test-only in-memory module delivery, a SHA-256 binding for the opaque document, and deterministic provider transport injection. It does **not** verify ordinary HTTP networking, IndexedDB, Web Locks or live provider CORS. Machine-readable results and screenshots identify which mode ran.
