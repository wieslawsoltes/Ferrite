# Terminal and ncurses

Ferrite's native terminal uses pinned **xterm.js 6.0.0** in the browser and on the bridge. The Python helper supplies an actual POSIX pseudo-terminal, controlling terminal and foreground process group. ncurses applications execute against the host's ncurses/terminfo installation; Ferrite renders their terminal protocol. This is not a JavaScript port of the native ncurses API or a browser operating-system emulator.

## Run a native application

Start the [trusted native bridge](agent-workbench.md#start-the-workbench), connect the IDE, open **Terminal**, and choose **New native**. Run an installed application such as `vim`, `less`, `top`, or an application using Python `curses`. Nothing installs these applications automatically. Node.js 22+ and Python 3 are required on the bridge. Linux and macOS use POSIX; on Windows run the bridge in WSL. Native ConPTY is not implemented.

The launcher starts `/bin/sh -i` by default. A terminal tool may choose a different executable and argument vector. The environment advertises `TERM=xterm-256color` and `COLORTERM=truecolor`, preserves an explicitly configured locale and otherwise selects a UTF-8 locale. Install an appropriate terminfo entry and fonts on the host/client for your applications.

The separate **Browser shell** is still a bounded workspace utility shell. It does not gain native process execution just because it uses the same visual terminal component. Native PTYs persist when the browser disconnects while the bridge remains alive; they do not survive termination of the bridge process.

## Rendering and interaction

The browser delegates VT parsing, rendering, selection, scrollback, keyboard translation, composition input, paste and mouse tracking to the upstream engine. Both engines use Unicode 11 width tables. Normal/alternate buffers, cursor movement/appearance, erase/insert/delete operations, margins, ANSI/256/RGB colors, SGR attributes, DEC special-graphics line drawing, application cursor/keypad modes, focus reports and bracketed paste are supported within xterm.js's documented sequence set.

Each session has its own terminal surface and ordered input queue. Switching tabs never redirects an in-flight input or close to another session. The toolbar provides selection copy, search (Enter next; Shift+Enter previous), font zoom, local scrollback clear, interrupt, close, optional WebGL rendering and an explicit screen-reader toggle. The default renderer does not require WebGL. GPU activation failures or context loss fall back to the regular renderer. Physical GPU performance is not established by the automated tests.

Screen-reader mode is opt-in because xterm's accessibility event path differs from ordinary insert-text/emoji input handling. Standard terminal input uses upstream keyboard/composition events rather than a custom key-to-ASCII layer. Copy is an explicit user gesture; terminal output cannot silently populate the clipboard.

## One authoritative screen

A PTY owns one headless xterm instance for its entire lifetime. Output is decoded incrementally as UTF-8, parsed in order, then published to a bounded sequence-stamped event log. The headless instance answers device attributes, cursor-position reports and supported terminal queries even when no browser or MCP reader is attached. Browser replicas suppress those query responses, preventing duplicate replies from corrupting application input.

A resize is acknowledged by the PTY helper, applied to the headless screen as an ordered barrier and recorded before completion. Native applications receive `SIGWINCH`. The browser crosses the barrier with a fresh state instead of applying old-dimension output after a local-only resize.

Recovery uses the serialized normal/alternate buffers and an additional data-only checkpoint for margins, tab stops, saved cursor/attributes, charset banks, current attributes, Unicode join state and pending-wrap cursor position. `XtermStateAdapter` isolates the deliberately pinned xterm 6.0.0 internal ABI needed for state that the public SerializeAddon does not preserve. Payloads are bounded and validated completely before mutation. The serializer also receives a read-only, column-bounded buffer view: alternate-screen backing lines can remain wider after shrink, and serializing those hidden cells would erase the last visible column. Upgrading xterm requires passing differential continuation tests, not just changing a version string.

`TerminalFramer` uses the pinned engine's actual VT500 transition table to publish only complete control-sequence boundaries. An unfinished CSI/OSC/DCS token is held until completion; snapshots therefore cannot omit an escape prefix and later render its suffix as text. Ordinary printable output is not held. A control token exceeding 64 KiB is discarded through its closing boundary, with a `TERMINAL_CONTROL_LIMIT` event; incomplete tokens at process exit are not rendered. The terminal log is consequently a UTF-8, bounded, safe replay stream, not a byte-for-byte forensic transcript.

## MCP tools and resources

All tools use the existing schema-validated registry, cancellation and permission model. The twelve terminal tools are:

| Tools | Purpose | Permission |
| --- | --- | --- |
| `terminal_open` | Start an executable with argv, cwd and terminal dimensions | Execute |
| `terminal_list`, `terminal_read` | List owned sessions and read sequence-stamped replay; optional bounded long polling | Read |
| `terminal_screen` | Inspect visible lines, cursor, dimensions, input modes and optional styled cells | Read |
| `terminal_wait` | Wait for literal screen text, new output or exit, with deadline and cancellation | Read |
| `terminal_input` | Send literal UTF-8 input, including control characters | Execute |
| `terminal_key` | Send a mode-aware named key, modifiers and bounded repetition | Execute |
| `terminal_paste` | Send text with EOL normalization and bracketed-paste protection | Execute |
| `terminal_mouse` | Send one-based cell-coordinate mouse events using negotiated tracking/encoding | Execute |
| `terminal_resize`, `terminal_signal`, `terminal_close` | Resize, signal the foreground job or terminate the session | Execute |

`terminal_screen.startRow` is zero-based. `cursorPosition.row` and `.column`, and mouse coordinates, are one-based. Styled cells include text, width, foreground/background palette or RGB color, bold, dim, italic, underline, inverse, invisible and strike flags. A zero-width cell is the continuation of a wide glyph. `cursor` at the result root is an event sequence, not the cursor's column.

Use this sequence of MCP `tools/call` arguments to operate a TUI (substitute the returned id; the executable must be installed):

```json
{"name":"terminal_open","arguments":{"executable":"vim","args":["src/main.rs"],"cols":100,"rows":30}}
{"name":"terminal_screen","arguments":{"id":"RETURNED_ID"}}
{"name":"terminal_key","arguments":{"id":"RETURNED_ID","key":"ArrowDown","count":3}}
{"name":"terminal_paste","arguments":{"id":"RETURNED_ID","text":"text to insert"}}
{"name":"terminal_wait","arguments":{"id":"RETURNED_ID","until":"text","contains":"expected visible text","timeoutMs":5000}}
```

These are individual calls, not one JSON document, and pasted text follows the application's current mode: for example Vim must first be in an appropriate insertion mode. Prefer `terminal_key` over guessed escape strings. Supported keys include arrows, Home/End, PageUp/PageDown, Insert/Delete, Enter/Tab/Backspace/Escape, F1–F12, keypad keys and individual Unicode characters, with modifiers. Mouse supports legacy byte, UTF-8, SGR and URXVT encodings. Pixel-coordinate extensions require deliberate raw input rather than the cell-coordinate tool. Unsupported/disabled tracking returns `accepted:false`.

Resources `ferrite://terminals` and `ferrite://terminal/{id}` provide the owned-session list and rendered screen. Ownership is enforced on tools and resources: one MCP/agent session cannot inspect or control another session's PTY. Direct authenticated human bridge endpoints operate under the existing explicitly trusted host-access capability. No new unauthenticated process endpoint is introduced.

`terminal_wait` returns `matched`, `timedOut`, `reason`, replay events and, by default, a separately sequence-stamped screen. It uses literal matching, not attacker-supplied regular expressions. Cancellation removes the waiter without killing the process. Input, paste, keys, mouse, resize and signals are execution-gated because they can cause arbitrary native side effects.

## Bounds and security

Defaults are 8 active PTYs, 16 retained exited sessions, 2,000 scrollback lines, 4,000 replay events / 2,000,000 log characters, 64 KiB per encoded input, and 256 KiB per browser input queue. Recovery retains at most 1,000 history lines and reduces history when the ANSI state exceeds 2,000,000 characters; the active screen is not silently truncated. Dimensions are 2–500 columns and 2–200 rows. Styled snapshots allow at most 20,000 cells per request; use row ranges for larger screens. Waits allow 0–30,000 ms and at most 32 concurrent waiters per PTY. Idle sessions close after 30 minutes.

Output backpressure pauses the helper pipe rather than accepting unlimited unparsed output. Input queues reject congestion. Control strings never enter `innerHTML`. OSC 8 links and OSC 52 clipboard access are disabled. Known provider/bridge credential variables are removed from child environments. Native programs still run with the host user's filesystem and network privileges: this is not a sandbox.

Foreground signals target the actual foreground process group instead of interrupting both the job and its interactive shell. Closing requests termination of both the foreground job and session shell, followed by bounded forced cleanup. An intentionally daemonized process is not an OS-container containment boundary.

Compatibility is the pinned xterm VT protocol surface, not every historical terminal, arbitrary graphics extension, Sixel/Kitty/iTerm image protocol, or every Unicode/grapheme/OS input-method combination. Optional image addons and native Windows ConPTY are not supplied. App-specific compatibility and font/locale differences should be tested with the intended host applications.

## Reproducible assets and validation

There is no CDN dependency, runtime npm install or package lifecycle script. The retained MIT distributions and licenses live under `src/vendor/xterm`. `manifest.json` pins each npm tarball by SHA-512 SRI and each retained file by SHA-256. `npm run vendor:terminal` refetches the exact versions with `npm pack --ignore-scripts`, verifies them, and reproduces the assets. `npm run check` verifies retained hashes offline in addition to syntax and deterministic worker bundles.

```sh
npm run check
npm test
npm run test:terminal
npm run test:agent:browser
```

Native tests use a real Python/ncurses fixture, not only hand-authored ANSI. They cover line drawing/color/Unicode, alternate buffers, keyboard/function keys, mouse, resize, query replies with no browser, foreground signals, ownership/approvals, binary input, wait cancellation, replay gaps and recovery between escape fragments. Differential checkpoint tests resume margins, saved cursors/attributes, charsets, tabs, origin mode, combining text and pending wraps. Oversized controls and malformed checkpoint payloads have bounded rejection tests.

Chromium acceptance drives the real IDE and bridge: ncurses keyboard/Unicode input, mouse coordinates, resizing, tab switching, live reconnection and normal-buffer restoration on exit. It also preserves the existing agent/approval/IDE integration acceptance. Screenshots and results are retained in `artifacts/agent-browser`; CI uses normal HTTP/CORS. `FERRITE_MEMORY_TEST=1` is a restricted-environment fallback with injected loopback transport and does **not** validate browser networking. Real OS-specific IME engines and physical GPU throughput require device testing.

Upstream references: [xterm.js 6.0.0](https://github.com/xtermjs/xterm.js/releases/tag/6.0.0), [supported terminal sequences](https://xtermjs.org/docs/api/vtfeatures/), [xterm API](https://xtermjs.org/docs/api/terminal/classes/terminal/), [Python curses](https://docs.python.org/3/library/curses.html).
