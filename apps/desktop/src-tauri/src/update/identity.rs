//! The Developer ID gate (spec §3.6). The updater plugin trusts its minisign
//! key alone; before chapay lets it install anything, the downloaded app must
//! also carry chapay's own Apple code signature. A forged update then needs
//! both the updater key and chapay's Developer ID certificate.
//!
//! The plugin installs an archive by dropping each entry's first path
//! component into a temp folder that becomes the new bundle. This module
//! refuses any archive that is not exactly one `chapay.app` tree, unpacks the
//! same bytes the same way, and asks `codesign` whether the result satisfies
//! chapay's designated requirement. Because the archive is a single
//! `chapay.app` tree, what is checked here is byte-for-byte what the plugin
//! then installs.

use std::io::Cursor;
use std::path::{Component, Path};

/// The requirement macOS already uses to recognise chapay across versions:
/// bundle id, Apple's Developer ID chain, and Team ID K9TKC5GG76. It names
/// the team, not one certificate, so a renewed certificate still passes.
/// Copied from `codesign -d -r-` on the shipped 0.1.0 app; the release
/// workflow checks every build against the same text.
pub const DESIGNATED_REQUIREMENT: &str = concat!(
    r#"identifier "dev.csdev19.portwatcher" and anchor apple generic"#,
    r#" and certificate 1[field.1.2.840.113635.100.6.2.6]"#,
    r#" and certificate leaf[field.1.2.840.113635.100.6.1.13]"#,
    r#" and certificate leaf[subject.OU] = K9TKC5GG76"#,
);

/// The only top-level entry an update archive may have.
pub const BUNDLE_NAME: &str = "chapay.app";

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum ArchiveError {
    #[error("the update archive is empty")]
    Empty,
    #[error("the update archive has an unexpected entry: {0}")]
    UnexpectedEntry(String),
    #[error("the update archive has an unsupported entry type at {0}")]
    UnsupportedEntryType(String),
    #[error("could not read the update archive: {0}")]
    Unreadable(String),
}

/// Checks one entry's path: relative, no `..`, and inside `chapay.app`.
pub fn check_entry_path(path: &Path) -> Result<(), ArchiveError> {
    let unexpected = || ArchiveError::UnexpectedEntry(path.display().to_string());
    let mut components = path.components();
    match components.next() {
        Some(Component::Normal(first)) if first == BUNDLE_NAME => {}
        _ => return Err(unexpected()),
    }
    if components.all(|c| matches!(c, Component::Normal(_))) {
        Ok(())
    } else {
        Err(unexpected())
    }
}

/// What `codesign --verify -R=…` said about the extracted app.
#[derive(Debug, PartialEq, Eq)]
pub enum CodesignVerdict {
    /// Valid signature that satisfies chapay's designated requirement.
    Chapay,
    /// Validly signed, but by someone else (exit status 3).
    WrongIdentity(String),
    /// Unsigned, tampered, or `codesign` could not run.
    Invalid(String),
}

/// Reads `codesign`'s exit status: 0 passes, 3 means the signature is valid
/// but fails the requirement, anything else (or a signal) is a broken or
/// missing signature.
pub fn interpret_codesign(status: Option<i32>, stderr: &str) -> CodesignVerdict {
    let detail = stderr.trim().to_string();
    match status {
        Some(0) => CodesignVerdict::Chapay,
        Some(3) => CodesignVerdict::WrongIdentity(detail),
        _ => CodesignVerdict::Invalid(detail),
    }
}

/// Unpacks `archive` (a `.app.tar.gz`) under `dest`, refusing anything but a
/// single `chapay.app` tree of plain files, folders and symlinks. Returns the
/// path of the unpacked bundle.
pub fn unpack(archive: &[u8], dest: &Path) -> Result<std::path::PathBuf, ArchiveError> {
    use tar::EntryType;
    let unreadable = |e: std::io::Error| ArchiveError::Unreadable(e.to_string());

    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(Cursor::new(archive)));
    let mut count = 0usize;
    for entry in tar.entries().map_err(unreadable)? {
        let mut entry = entry.map_err(unreadable)?;
        let path = entry.path().map_err(unreadable)?.into_owned();
        check_entry_path(&path)?;
        match entry.header().entry_type() {
            EntryType::Regular | EntryType::Directory | EntryType::Symlink => {}
            _ => {
                return Err(ArchiveError::UnsupportedEntryType(
                    path.display().to_string(),
                ))
            }
        }
        // `unpack_in` also refuses to write through a symlink that points
        // outside `dest`.
        if !entry.unpack_in(dest).map_err(unreadable)? {
            return Err(ArchiveError::UnexpectedEntry(path.display().to_string()));
        }
        count += 1;
    }
    if count == 0 {
        return Err(ArchiveError::Empty);
    }
    Ok(dest.join(BUNDLE_NAME))
}

/// Runs `codesign` against chapay's requirement on an unpacked bundle.
#[cfg(target_os = "macos")]
pub fn verify_bundle(bundle: &Path) -> CodesignVerdict {
    let output = std::process::Command::new("/usr/bin/codesign")
        .arg("--verify")
        .arg("--strict")
        .arg("--deep")
        // A requirement argument that starts with "=" is literal requirement
        // text (codesign(1), "Requirement arguments").
        .arg("-R")
        .arg(format!("={DESIGNATED_REQUIREMENT}"))
        .arg(bundle)
        .output();
    match output {
        Ok(out) => interpret_codesign(out.status.code(), &String::from_utf8_lossy(&out.stderr)),
        Err(e) => CodesignVerdict::Invalid(format!("could not run codesign: {e}")),
    }
}

#[cfg(not(target_os = "macos"))]
pub fn verify_bundle(_bundle: &Path) -> CodesignVerdict {
    CodesignVerdict::Invalid("the Developer ID check only exists on macOS".into())
}

/// The whole gate: unpack into a fresh temp folder, then check the signature.
pub fn check_update_archive(archive: &[u8]) -> Result<(), String> {
    let dir = tempfile::Builder::new()
        .prefix("chapay-update-check")
        .tempdir()
        .map_err(|e| format!("could not create a temp folder: {e}"))?;
    let bundle = unpack(archive, dir.path()).map_err(|e| e.to_string())?;
    match verify_bundle(&bundle) {
        CodesignVerdict::Chapay => Ok(()),
        CodesignVerdict::WrongIdentity(detail) => Err(format!(
            "signed by someone other than chapay's developer: {detail}"
        )),
        CodesignVerdict::Invalid(detail) => Err(format!("invalid code signature: {detail}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn the_requirement_pins_bundle_id_and_team() {
        assert!(DESIGNATED_REQUIREMENT.starts_with(r#"identifier "dev.csdev19.portwatcher""#));
        assert!(DESIGNATED_REQUIREMENT.ends_with("certificate leaf[subject.OU] = K9TKC5GG76"));
        // Developer ID Application marker (leaf) and intermediate marker.
        assert!(DESIGNATED_REQUIREMENT.contains("1.2.840.113635.100.6.1.13"));
        assert!(DESIGNATED_REQUIREMENT.contains("1.2.840.113635.100.6.2.6"));
    }

    #[test]
    fn entries_must_live_inside_chapay_app() {
        assert!(check_entry_path(Path::new("chapay.app")).is_ok());
        assert!(check_entry_path(Path::new("chapay.app/Contents/MacOS/chapay")).is_ok());
        for bad in [
            "other.app/Contents/MacOS/chapay",
            "chapay.app/../evil",
            "/chapay.app/Contents",
            "./chapay.app/Contents",
            "Contents/Info.plist",
        ] {
            assert!(
                matches!(
                    check_entry_path(&PathBuf::from(bad)),
                    Err(ArchiveError::UnexpectedEntry(_))
                ),
                "{bad} should be refused"
            );
        }
    }

    #[test]
    fn codesign_exit_status_is_read_correctly() {
        assert_eq!(interpret_codesign(Some(0), ""), CodesignVerdict::Chapay);
        assert_eq!(
            interpret_codesign(
                Some(3),
                "test-requirement: code failed to satisfy specified code requirement(s)\n"
            ),
            CodesignVerdict::WrongIdentity(
                "test-requirement: code failed to satisfy specified code requirement(s)".into()
            )
        );
        assert_eq!(
            interpret_codesign(Some(1), "code object is not signed at all"),
            CodesignVerdict::Invalid("code object is not signed at all".into())
        );
        assert!(matches!(
            interpret_codesign(None, ""),
            CodesignVerdict::Invalid(_)
        ));
    }

    fn archive(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        let mut builder = tar::Builder::new(gz);
        for (path, data) in entries {
            let mut header = tar::Header::new_gnu();
            header.set_size(data.len() as u64);
            header.set_mode(0o644);
            header.set_entry_type(tar::EntryType::Regular);
            // `append_data` would refuse `..`; write the raw name instead.
            header.as_gnu_mut().unwrap().name[..path.len()].copy_from_slice(path.as_bytes());
            header.set_cksum();
            builder.append(&header, *data).unwrap();
        }
        builder.into_inner().unwrap().finish().unwrap()
    }

    #[test]
    fn unpacks_a_single_chapay_app_tree() {
        let dir = tempfile::tempdir().unwrap();
        let bytes = archive(&[("chapay.app/Contents/Info.plist", b"<plist/>")]);
        let bundle = unpack(&bytes, dir.path()).unwrap();
        assert_eq!(bundle, dir.path().join("chapay.app"));
        assert_eq!(
            std::fs::read(bundle.join("Contents/Info.plist")).unwrap(),
            b"<plist/>"
        );
    }

    #[test]
    fn refuses_a_second_top_level_entry() {
        let dir = tempfile::tempdir().unwrap();
        let bytes = archive(&[
            ("chapay.app/Contents/Info.plist", b"ok"),
            ("evil.app/Contents/MacOS/chapay", b"payload"),
        ]);
        assert!(matches!(
            unpack(&bytes, dir.path()),
            Err(ArchiveError::UnexpectedEntry(_))
        ));
    }

    #[test]
    fn refuses_path_traversal() {
        let dir = tempfile::tempdir().unwrap();
        let bytes = archive(&[("chapay.app/../../escape", b"x")]);
        assert!(unpack(&bytes, dir.path()).is_err());
        assert!(!dir.path().join("../escape").exists());
    }

    #[test]
    fn refuses_an_empty_or_corrupt_archive() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(unpack(&archive(&[]), dir.path()), Err(ArchiveError::Empty));
        assert!(matches!(
            unpack(b"not a gzip", dir.path()),
            Err(ArchiveError::Unreadable(_))
        ));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn an_unsigned_bundle_fails_the_gate() {
        let bytes = archive(&[("chapay.app/Contents/Info.plist", b"<plist/>")]);
        let err = check_update_archive(&bytes).unwrap_err();
        assert!(err.contains("invalid code signature"), "{err}");
    }

    /// Runs the gate on real archives, which cannot live in the repository.
    /// `CHAPAY_SIGNED_ARCHIVE` is a `chapay.app.tar.gz` of a released build
    /// and must pass; `CHAPAY_FOREIGN_ARCHIVE`, if set, is any other signed
    /// or tampered `chapay.app` archive and must fail. See releasing.mdx.
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "needs CHAPAY_SIGNED_ARCHIVE; run with --ignored"]
    fn real_archives_pass_or_fail_the_gate() {
        let signed = std::env::var("CHAPAY_SIGNED_ARCHIVE").expect("set CHAPAY_SIGNED_ARCHIVE");
        check_update_archive(&std::fs::read(signed).unwrap()).unwrap();
        if let Ok(foreign) = std::env::var("CHAPAY_FOREIGN_ARCHIVE") {
            let err = check_update_archive(&std::fs::read(foreign).unwrap()).unwrap_err();
            eprintln!("foreign archive refused: {err}");
        }
    }
}
