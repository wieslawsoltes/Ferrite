# Debugging Rust UI projects

## Launch and controls

Open a `.ui.rs` view (or a helper currently owned by that view), then select **Debug**
or press **F5**. A live matching preview is reused: attaching does not recreate its
DOM, hooks or application state. A stale preview is compiled before attachment. The
IDE waits for the isolated frame's readiness acknowledgement; Stop, a superseding
launch, source replacement or workspace replacement cancels that wait. An older CLI
worker cannot publish a late pause into this UI session.

With editor breakpoints present, callbacks run until one is reached. With no
breakpoints, attachment pauses at the next event's entry. **Pause** while waiting
requests the next event; while a callback is executing it stops at the next scheduling
boundary. **Continue** commits a completed callback and stays attached for later events.

| Action | Shortcut | Behavior |
| --- | --- | --- |
| Start / Continue | F5 | Attach, resume, or commit staged results without rebuilding a live preview |
| Step over | F10 | Advance the source line without entering callees; explicit breakpoints still apply |
| Step into source | F11 | Advance to a different source line or call frame |
| Step out | Shift+F11 | Finish the current call frame |
| Reverse source line | Shift+F10 | Restore a prior source location within retained history |
| Stop | Shift+F5 | Cancel execution, discard queued callbacks and uncommitted state, disarm |

Both Debug panels also expose instruction stepping, reverse instruction stepping,
restart of retained history, and pause. Controls reflect waiting/running/paused/
completed/error state; reverse controls remain usable after the final instruction.
These keyboard actions work while the preview iframe has focus, not just in the code
editor. The frame sends only whitelisted command intentions over its existing capability
channel. Standalone exports do not intercept browser shortcuts.

## Source, frames and breakpoints

Breakpoint changes in the editor gutter are synchronized to an attached session,
including when it is paused. Source location bindings report whether an instruction
exists on that line; a binding does not promise that a particular callback reaches it.
Blank/comment-only lines remain unbound instead of silently moving to unrelated code.
Debug execution uses the checked **unoptimized MIR** to retain local variables and
source instructions even when the normal JavaScript/Wasm build is optimized.

The main Debugger and designer Debug panel display the same live call stack, typed
locals/registers, staged state, breakpoint bindings, bounded instruction trace and
reverse-history boundary. Selecting a frame or local navigates to its original Rust
source. A breakpoint in a helper module opens that file while preserving the owning
view and its live iframe. A stop in Code-only mode reveals the source/designer split.
Background retained views do not steal the selected document or another view's controls.

Nested `ui::update` and owned-state `ui::modify` callbacks are real frames on the same
MIR stack. Their returns use data-only host continuations, so snapshots can restore
both call frames and staged state, including across the updater return.

## Execution and lifetime

Callbacks execute cooperatively in batches of at most 512 instructions or about 8 ms
between yield checks. Expensive individual instructions remain bounded by the existing
runtime budgets; this is not preemptive JavaScript thread suspension. Pause and Stop
can run between batches. Cancellation generations invalidate previously scheduled
continuations. Instruction work is monotonic: reversing cannot refund execution fuel.

Events arriving during a pause queue in order, up to 100 pending callbacks. Continue
drains them using freshly committed state. Timer callbacks are debugged rather than
silently disabled, and pending ticks for the same captured timer are coalesced. Stop
discards pending work; normal application events/timers subsequently use the selected
non-debug backend. Closing a view or replacing the workspace disposes its session.

State mutations are staged until Continue. Stepping to the callback's end deliberately
keeps the completed VM and its bounded history so Back still works. A runtime panic
retains the failing frames and history, and forward execution is rejected until the
failed instruction is reversed, retained history is restarted, or debugging is stopped.
History defaults to at most 256 snapshots and 16 MiB. Restart rewinds retained history,
not necessarily event entry after eviction or an irreversible host effect.

## Boundaries

This is the browser compiler's Rust **event/timer callback debugger**, including
ordinary helper calls and nested functional state updaters. The original application
may render through JavaScript, Wasm or MIR; paused Rust callbacks use MIR in every case.
It is not a debugger for arbitrary generated JavaScript, native rustc machine code,
Wasm instructions, or native heaps. Native Cargo binary previews continue to expose
inspection/export, not source-level MIR stepping.

Rendering, effects and browser default actions remain synchronous and are not
source-steppable. A paused event cannot retroactively cancel a default browser action.
Irreversible host operations and committed rendering establish history barriers. Back
never claims to undo emitted external events, DOM effects or another callback's commit.

## SDK and MCP

`UISession.armDebugger({breakpoints, pauseOnEntry})`, `setBreakpoints(points)`,
`debug(command)` and `inspectDebugger()` expose the same state machine. `pauseOnEntry`
defaults to true for SDK compatibility. Debug returns a typed `UIDebugSnapshot`;
long-running operations can initially return `status: "running"`, followed by
`debug-running`, `debug-paused`, `debug-complete` or `debug-error` notifications through
`subscribe`. `ui_debug` adds pause, step-over and step-out to the existing approved
MCP execute operations. No arbitrary evaluation or approval downgrade is introduced.

## Regression gates

`npm test` covers all three rendering backends, helper and updater breakpoints,
source/over/out/reverse stepping, terminal reverse state, timers, event queues, errors,
cooperative cancellation, stale replies and launch ownership. `npm run test:ui:debugger`
uses real Chromium over HTTP to exercise project import, controls, the editor gutter,
opaque iframe shortcuts, multiple retained views and source invalidation. The normal
validation workflow runs this alongside the existing IDE/UI/native/SDK checks and
retains screenshots plus machine-readable results under `artifacts/ui-debugger/`.
`FERRITE_MEMORY_TEST=1` uses the existing restricted-container delivery harness instead
of HTTP; it is not evidence of HTTP module delivery.
