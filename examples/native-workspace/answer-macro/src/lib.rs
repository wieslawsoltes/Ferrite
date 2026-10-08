extern crate proc_macro;
use proc_macro::TokenStream;

/// A dependency-free procedural macro: native Cargo/rustc executes this crate.
#[proc_macro]
pub fn answer(_input: TokenStream) -> TokenStream {
    "42_i64".parse().expect("the macro emits a valid integer literal")
}
