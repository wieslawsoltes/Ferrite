use serde::Serialize;

#[derive(Serialize)]
struct BuildSummary {
    app: &'static str,
    crates: Vec<&'static str>,
    answer: u32,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let summary = BuildSummary { app: "Ferrite native repository", crates: vec!["serde", "serde_json"], answer: 42 };
    println!("{}", serde_json::to_string_pretty(&summary)?);
    Ok(())
}
