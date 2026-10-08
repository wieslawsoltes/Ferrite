# Ferrite — Interactive Rust-like Compiler Lab

Ferrite is a dependency-free educational compiler playground written in JavaScript. Edit a limited subset of Rust syntax, inspect tokens, AST, type checking and generic instantiations, a simplified MIR view, and generated JavaScript, then execute inside a time-limited Web Worker.

**Live demo (once GitHub Pages is enabled):** https://wieslawsoltes.github.io/Ferrite/

## Features

- Lexer, recursive-descent parser and expression precedence
- Generic functions with a simplified `Display` constraint
- Basic type checking for `u32`, `f64`, and `&str`
- Reachable generic instance collection
- Simplified MIR visualization (not actual rustc MIR)
- JavaScript code generation and Worker execution
- Per-pass browser timing

## Run locally

Open `index.html` in a modern browser, or serve the directory:

```sh
python3 -m http.server 8080
```

Then open http://localhost:8080.

## Deploy

The `.github/workflows/pages.yml` workflow deploys the root directory to GitHub Pages on each push to `main`. In repository **Settings → Pages**, choose **GitHub Actions** as the build and deployment source. The deployment workflow uses `actions/configure-pages`, `actions/upload-pages-artifact`, and `actions/deploy-pages`.

## Scope and limitations

This is **not** a complete Rust compiler. It supports a small educational subset only; there is no real borrow checker, trait solver, LLVM backend, WASM backend, cargo integration, or native binary output. The displayed MIR is a pedagogical representation. Compilation and execution of arbitrary snippets should be treated as experimental; Worker isolation and timeouts are not a security boundary against malicious input.

## License

No license has been selected. Copyright holders retain applicable rights unless a license is added.
