use std::fs;
use std::path::Path;

fn main() {
    println!("cargo:rerun-if-changed=../branding.json");

    let branding_path = Path::new("../branding.json");
    if branding_path.exists() {
        let content = fs::read_to_string(branding_path).expect("failed to read branding.json");
        let branding: serde_json::Value =
            serde_json::from_str(&content).expect("invalid branding.json format");
        let name = branding["name"].as_str().unwrap_or("Island");
        let identifier = branding["identifier"]
            .as_str()
            .unwrap_or("local.island.app");
        println!("cargo:rustc-env=ISLAND_APP_NAME={}", name);
        println!("cargo:rustc-env=ISLAND_APP_IDENTIFIER={}", identifier);
    }

    tauri_build::build();
}
