# Native Git repositories, local workspaces, and crates

## Execution boundary

Ferrite's JavaScript compiler remains a Rust subset. A **native repository session**
uses installed Git, Cargo, rustc, and optionally rust-analyzer in a real checkout.
It does not import crates.io source into the subset compiler and pretend to compile
full Rust. Native binaries run on the bridge machine. The IDE shows their logs,
diagnostics and stdin, not an embedded native desktop window or a PTY.

Remote means **the source Git repository** is remote. This bridge is loopback-only;
it is not a remote-host/cloud-build service.

## Start and connect

Requires Node.js 22+, Git, and a Rust/Cargo toolchain. For semantic tooling install
rust-analyzer and rust-src. Registry/network access and platform libraries must be
available on the bridge machine when a project needs them.

```sh
node tools/cargo-bridge.mjs \
  --trust-projects \
  --origin https://wieslawsoltes.github.io \
  --port 8787 \
  --allow-root /absolute/path/to/your/repositories \
  --max-jobs 8
```

Repeat `--allow-root` for additional authorized directories. No local directories
are authorized by default. For a locally hosted IDE use its actual origin, for
example `--origin http://localhost:8080`. Use the printed IPv4 loopback address and
bearer token in **Native bridge**. Browser local-network permissions still apply;
Ferrite does not bypass browser or organizational policies.

In **Repositories**, choose:

- **Remote**: HTTPS URL, `ssh://git@host/path`, or `git@host:path`, with optional
  branch, tag or commit and optional recursive submodules. Git resolves a commit
  and checks it out detached. The resolved HEAD is shown. Existing local Git
  credentials/SSH agent configuration are used; URL passwords, token query strings,
  interactive Git credential prompts, file/ext transports, and unknown SSH host
  prompts are not accepted. Set up trusted SSH known_hosts outside the IDE first.
- **Local**: absolute path inside an authorized root. Both Git working trees and
  plain Cargo directories work. An existing working tree is not reset, cleaned,
  checked out to another revision, or deleted.

Select the repository-relative manifest, e.g. `apps/desktop/Cargo.toml`. Build
processes run from that manifest's directory with its absolute manifest path, so
nested `.cargo/config.toml` and `rust-toolchain.toml` discovery retain their normal
Cargo meaning. IDE paths remain relative to the selected repository root.

Opening is an explicit trust/replace action. It replaces the browser workspace;
export unsynchronized edits before switching. **Remote clones are temporary**:
closing their session or stopping the bridge deletes that managed clone and its
build cache. Export text edits, copy the displayed checkout directory, or use local
Git to save changes before closing. A local checkout and its cache remain on disk.
Browser refresh/sample changes may detach the UI, but an open bridge session can
be found with **List bridge sessions**, resumed, or explicitly closed. Session IDs
and bearer credentials are not saved in project snapshots or browser storage.

## Build and run complete Cargo applications

The native target list comes from `cargo metadata --no-deps --format-version 1`,
not the subset TOML parser. Workspace inheritance, registries, Git/path dependencies,
patches, build scripts, procedural macros, toolchain files, and assets are handled
by the real installed toolchain. Metadata failure is displayed and does not
prevent viewing a checkout; build failures are never relabeled as success.

Choose a package and a binary/example target in **Cargo**. Build controls expose
jobs, profiles (use `release` for a release build), toolchain, target triple,
workspace/all-target builds, features, offline/locked flags, keep-going and timings.
`run` retains the selected package/target rather than incorrectly forwarding
workspace/all-target build switches. Program/test arguments use a JSON string
array and are forwarded after `--`, without a shell. For further Cargo flags use
**Native Cargo arguments** in Search Everywhere. Job and manifest overrides belong
in their dedicated controls; program arguments named `--jobs` are still allowed.

Run output is streamed, including prompts without newlines. **Send input** writes
a line; **Close stdin** sends EOF. Stop cancels the operation and waits for process
cleanup before the workspace can be reused. Commands default to a 120-second
process deadline; the IDE can select 1–3600 seconds. Clones have a separate ten-minute
deadline. This is piped input, not a terminal emulator with job control, ANSI screen
management, or native GUI embedding. Process-tree cancellation uses POSIX groups;
Windows descendant-process behavior has not been validated here.

The build cache is the checkout's real Cargo target directory and the toolchain's
normal registry/Git caches, not a new temporary project on every edit. Custom target
directories are respected by Cargo. The editor's cache directory omission policy
recognizes `target` and `target-ra`; projects using a different output directory
should select an appropriately scoped root if it makes file discovery too large.

## Crates tool

**Crates** builds literal `cargo add`/`cargo remove` arguments. It supports crates.io
or a configured registry, version constraints, Git URLs/revisions, local paths,
renaming, optional dependencies, default-feature selection, named features and
normal/development/build dependency sections. The chosen workspace package is
passed explicitly. Local dependency paths follow Cargo's working-directory rules
and can refer to siblings not shown in the editor; these are trusted native builds.

Cargo—not a string replacement routine—edits manifests and resolves dependencies.
Use the manifest/config editor for target-specific dependencies, workspace
inheritance, Git branch/tag selectors, `[patch]`, `[replace]`, source replacement,
vendoring configuration, and other Cargo syntax. Credential-management and publish
commands remain intentionally excluded. There is no Git commit/push UI in this
change; use your local Git client for VCS mutations.

## Synchronization and source identity

The editor gets a bounded UTF-8 text projection: at most 1,000 files, 8 MiB total,
1 MiB per file, with at most 50,000 directory entries scanned. Manifests are
prioritized. Binary assets, symlinks, cache directories, `.git`, common secret files
and files exceeding editor limits are omitted from that projection, **not removed
from the checkout**. The UI reports omitted counts/reasons. Native Cargo still
sees the full checkout. The browser-only folder importer copies text and cannot
preserve binary assets for standalone browser builds.

Each session has a monotonically advancing revision and a single writer/operation.
Only changed editor files are written. All original byte preimages are checked
before any replacement; unseen assets cannot be overwritten just by introducing
a text file with the same name. Replacements are staged, then individually renamed;
failures attempt rollback. This is not a filesystem-wide atomic transaction and
cannot lock out unrelated native programs editing the same directory.

Cargo-generated lockfile/manifest/formatting changes are merged against the
submitted text and the latest editor revision. Newer independent editor changes
survive. Conflicting edits are not silently overwritten; export and reload are
required. A process-start or post-build failure invalidates the native session
revision even if source synchronization already happened. Stale clients must reload.
Cancellation/stream loss also requires the initiating editor to reload because a
build could have generated files after its response was lost.

Native diagnostics resolve paths against the actual process directory, then check
that they belong to the selected root and editable files. External dependency
filenames cannot accidentally select a same-named local file. UTF-8 byte offsets
are converted to UTF-16 editor ranges. Omitted/external files have no fabricated
source mapping. Rust-analyzer borrows the checkout with in-memory Rust overlays;
hover/rename preview does not write or delete source files. Run a native command to
synchronize edited manifests before depending on their language-server semantics.

## API and limits

Authenticated POST routes under `/v1/repository/` are `open`, `run`, `reload`, `list`,
`close`, `language`, `input`, and `cancel`. Operation routes stream NDJSON `started`,
`log`, `result` or `error` records. Cancellation uses the opaque operation ID;
stdin uses the session ID and text (`null` means EOF). Every read/write route uses
the bridge's bearer, exact-Origin and loopback-Host checks. Limits include four
live sessions, eight active operation streams, 12 MiB JSON requests, 32 MiB streams,
4 MiB stream backpressure, and 64 KiB stdin writes.

These access rules protect the editor file API. They do **not** sandbox native
Cargo, build scripts, procedural macros, configured helpers, or applications.
Trusted code can access your machine with your permissions. Clones are timeout
bounded but not disk-quota sandboxed. Authorize only sources you trust.

## Acceptance

`npm test` covers real filesystem/session conflicts, real Node HTTP transport,
real child-process stdin/EOF, weighted job admission, protocol validation, and UI
contracts with injected Cargo/Git runners. Injected runners do not establish native
Cargo or remote network compatibility.

`npm run test:repositories` additionally requires actual installed Cargo and Git.
It builds a fixture with a Git dependency from a local origin, an external path
procedural-macro crate, build.rs, binary assets and stdin. It cleans between jobs=1
and jobs=2 builds, compares runtime output, and requires actual Cargo timing reports.
It also tests `examples/native-workspace`. The main browser acceptance suite has a
separately labeled simulated repository transport case and real parser workers;
`FERRITE_NATIVE_TEST=1` enables native browser integration in an HTTP-capable environment.

The authoring environment had no Cargo/rustc or network and blocked browser localhost
navigation. Native-toolchain and real HTTP browser acceptance must therefore pass
in CI or on a development machine before treating this change as release-validated.

References: [Cargo dependencies](https://doc.rust-lang.org/cargo/reference/specifying-dependencies.html),
[cargo add](https://doc.rust-lang.org/cargo/commands/cargo-add.html),
[cargo build](https://doc.rust-lang.org/cargo/commands/cargo-build.html).

For an additional live registry acceptance run, explicitly enable
`FERRITE_REGISTRY_TEST=1 npm run test:repositories`. This resolves and runs the
checked-in serde/serde_json example and may download crates. That optional network
case was not executed in the offline authoring environment.
