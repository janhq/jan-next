//! Runtime grants for the asset protocol.
//!
//! `tauri.conf.json` allows nothing statically: a `**/*` scope let any script
//! in the window read every file on disk, the data folder's settings and keys
//! included. The window only streams files the user picked in the open dialog
//! (the chat image, audio and video pickers) through `convertFileSrc`, and each
//! is granted here when it is picked ([`allow_picked_file`]).

use std::path::Path;

use tauri::{AppHandle, Manager, Runtime};

/// Grant one file the user just picked, so the renderer can `fetch` it
/// through the asset protocol (the chat image, audio and video pickers).
pub fn allow_picked_file<R: Runtime>(app: &AppHandle<R>, path: &Path) {
    if let Err(e) = app.asset_protocol_scope().allow_file(path) {
        log::warn!("asset scope: could not allow {}: {e}", path.display());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::test::mock_app;

    #[test]
    fn nothing_is_served_until_granted() {
        let app = mock_app();
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.png");
        std::fs::write(&file, b"x").unwrap();
        assert!(!app.asset_protocol_scope().is_allowed(&file));
    }

    #[test]
    fn a_picked_file_is_served_but_not_its_siblings() {
        let app = mock_app();
        let dir = tempfile::tempdir().unwrap();
        let picked = dir.path().join("photo.png");
        let sibling = dir.path().join("secret.txt");
        std::fs::write(&picked, b"x").unwrap();
        std::fs::write(&sibling, b"x").unwrap();
        allow_picked_file(app.handle(), &picked);
        assert!(app.asset_protocol_scope().is_allowed(&picked));
        assert!(!app.asset_protocol_scope().is_allowed(&sibling));
    }
}
