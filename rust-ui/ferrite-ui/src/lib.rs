//! A standard-rustc UI runtime. Generic state stays in Rust; only bounded view
//! descriptions and owned event snapshots cross the versioned Wasm host ABI.
//! Callbacks are `Fn + 'static`; rustc, not a JavaScript checker, owns lifetimes.
//!
//! ```compile_fail
//! use ferrite_ui as ui;
//! fn invalid() -> ui::Node {
//!     let borrowed = String::from("local");
//!     ui::on_click(ui::text("click"), || println!("{borrowed}"))
//! }
//! ```
mod abi;
mod hooks;
mod node;
mod session;
pub use ferrite_ui_macro::view;
pub use hooks::*;
pub use node::*;
pub use session::Session;
#[doc(hidden)]
pub use abi::{start, render, commit, dispatch, dispose};

/// Export one application per Wasm instance. Multiple hosts use separate instances.
#[macro_export]
macro_rules! export_app {
    ($app:path) => {
        #[no_mangle] pub extern "C" fn ferrite_ui_abi() -> u32 { 1 }
        #[no_mangle] pub extern "C" fn ferrite_start() { $crate::start($app); }
        #[no_mangle] pub extern "C" fn ferrite_render() { $crate::render(); }
        #[no_mangle] pub extern "C" fn ferrite_commit() { $crate::commit(); }
        #[no_mangle] pub extern "C" fn ferrite_dispatch(id: u32) { $crate::dispatch(id); }
        #[no_mangle] pub extern "C" fn ferrite_dispose() { $crate::dispose(); }
    };
}
