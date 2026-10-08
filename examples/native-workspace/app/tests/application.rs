#[test]
fn runs_without_interactive_input() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_native-lab"))
        .arg("--no-input")
        .output()
        .expect("run native executable");
    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).expect("UTF-8 output");
    assert!(stdout.contains("total=42, asset=4 bytes, build.rs executed"));
    assert!(stdout.contains("nested Cargo configuration loaded"));
}
