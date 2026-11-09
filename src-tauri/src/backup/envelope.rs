//! Envelope validation: format marker, version ceiling and checksum.

use super::{hex_lower, BACKUP_FORMAT, BACKUP_FORMAT_VERSION};

/// Re-validate a backup payload before anything is built from it. The frontend
/// has already validated it; this is the same gate applied to the exact bytes
/// that arrived over IPC (defence in depth).
pub(super) fn verify_backup_envelope(payload: &str) -> Result<serde_json::Value, String> {
    let envelope: serde_json::Value = serde_json::from_str(payload).map_err(|_| {
        "That file is not a BHMS backup — it isn't valid JSON.".to_string()
    })?;
    let object = envelope
        .as_object()
        .ok_or_else(|| "That file isn't a BHMS backup.".to_string())?;

    if object.get("format").and_then(|v| v.as_str()) != Some(BACKUP_FORMAT) {
        return Err("That file isn't a BHMS backup.".to_string());
    }
    let version = object
        .get("format_version")
        .and_then(|v| v.as_i64())
        .ok_or_else(|| "That file isn't a BHMS backup.".to_string())?;
    if version > BACKUP_FORMAT_VERSION {
        return Err(format!(
            "This backup was made by a newer version of BHMS (format v{version}). Update the app, then restore it."
        ));
    }

    let tables = object
        .get("tables")
        .and_then(|v| v.as_object())
        .ok_or_else(|| "This backup is incomplete — its data tables are missing or damaged.".to_string())?;
    // Tables a backup legitimately lacks (it was written before they existed)
    // are restored as empty, not rejected — amenity-billing-spec.md §13,
    // decision #30. A table that is present but malformed is still an error in
    // load_backup_rows below.

    // The checksum covers the canonical (key-sorted) serialization of `tables`.
    // serde_json's Value uses a BTreeMap for objects, so this output is byte-
    // identical to JSON.stringify(canonicalize(tables)) on the TypeScript side.
    let checksum = object
        .get("checksum")
        .and_then(|v| v.as_object())
        .ok_or_else(|| "This backup is damaged — it has no checksum.".to_string())?;
    if checksum.get("algorithm").and_then(|v| v.as_str()) != Some("SHA-256") {
        return Err("This backup is damaged — it has no checksum.".to_string());
    }
    let recorded = checksum
        .get("value")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "This backup is damaged — it has no checksum.".to_string())?;
    let canonical = serde_json::to_string(tables)
        .map_err(|e| format!("could not read the backup payload: {e}"))?;
    let digest = {
        use sha2::{Digest, Sha256};
        Sha256::digest(canonical.as_bytes())
    };
    if !hex_lower(&digest).eq_ignore_ascii_case(recorded) {
        return Err(
            "This backup file is damaged or incomplete (checksum mismatch). Try another copy."
                .to_string(),
        );
    }

    Ok(envelope)
}
