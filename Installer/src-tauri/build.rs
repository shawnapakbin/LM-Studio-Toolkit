fn main() {
    // Embed an application manifest requesting `requireAdministrator` so the
    // bundled installer exe always runs elevated (Requirements 1.1, 1.2, 1.5).
    //
    // This uses tauri-build's own `WindowsAttributes::app_manifest` (already a
    // build dependency) rather than any third-party crate. tauri-build embeds
    // exactly one Windows application manifest, so routing our manifest through
    // it avoids a double-manifest link conflict. The manifest lives in a
    // sibling file and is pulled in with include_str! so it can be asserted by
    // the package-manifest test.
    //
    // The Common-Controls v6 dependency is retained because a custom manifest
    // replaces tauri's default one, and Tauri's dialog APIs require it.
    let windows = tauri_build::WindowsAttributes::new()
        .app_manifest(include_str!("llm-toolkit-installer.exe.manifest"));
    let attrs = tauri_build::Attributes::new().windows_attributes(windows);
    tauri_build::try_build(attrs).expect("failed to run tauri build script");
}
