use std::{env, fs, path::PathBuf};

fn main() {
    let output = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo supplies OUT_DIR"));
    fs::write(output.join("build_info.rs"), "const GENERATED: &str = \"build.rs executed\";\n")
        .expect("write generated Rust source");
    println!("cargo:rerun-if-changed=build.rs");
}
