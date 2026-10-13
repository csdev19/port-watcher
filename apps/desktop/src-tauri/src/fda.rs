//! Full Disk Access (FDA) detection.
//!
//! macOS has no API to ask "does this app have Full Disk Access?". The
//! standard workaround is to try opening a file only FDA-holders can read.
//! The user's TCC database is such a file: without FDA the open fails with
//! EPERM; with it, it succeeds. A denied open is silent — it never shows a
//! permission prompt, so this is safe to run repeatedly.

use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// How long a cached answer is trusted by hot paths (port enrichment).
/// Short enough that a freshly granted permission shows up within a poll
/// or two, long enough that a scan of many ports probes the disk once.
const CACHE_TTL: Duration = Duration::from_secs(3);

static CACHE: Mutex<Option<(Instant, bool)>> = Mutex::new(None);

/// A file that only processes with Full Disk Access can open.
fn probe_path(home: &Path) -> PathBuf {
    home.join("Library/Application Support/com.apple.TCC/TCC.db")
}

/// Decision logic, with the probe injected so it is testable without a TCC
/// database. Only a successful open counts as granted; EPERM, a missing
/// file, or any other error means "not granted" (the safe default: we keep
/// skipping protected folders).
pub fn decide(probe: impl FnOnce() -> io::Result<()>) -> bool {
    probe().is_ok()
}

fn probe_real() -> bool {
    let Some(home) = std::env::var_os("HOME") else {
        return false;
    };
    let path = probe_path(Path::new(&home));
    // Read-only open, closed immediately on drop.
    decide(|| std::fs::File::open(path).map(|_| ()))
}

/// Probes now and refreshes the cache. Used by the setup window's poll.
pub fn check_now() -> bool {
    let granted = probe_real();
    *CACHE.lock().unwrap() = Some((Instant::now(), granted));
    granted
}

/// Cached answer, re-probed at most every [`CACHE_TTL`].
pub fn cached() -> bool {
    cached_with(&CACHE, CACHE_TTL, Instant::now(), probe_real)
}

fn cached_with(
    cache: &Mutex<Option<(Instant, bool)>>,
    ttl: Duration,
    now: Instant,
    probe: impl FnOnce() -> bool,
) -> bool {
    let mut guard = cache.lock().unwrap();
    if let Some((at, value)) = *guard {
        if now.saturating_duration_since(at) < ttl {
            return value;
        }
    }
    let value = probe();
    *guard = Some((now, value));
    value
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn successful_open_means_granted() {
        assert!(decide(|| Ok(())));
    }

    #[test]
    fn permission_denied_means_not_granted() {
        assert!(!decide(|| Err(io::Error::from(
            io::ErrorKind::PermissionDenied
        ))));
    }

    #[test]
    fn any_other_error_means_not_granted() {
        assert!(!decide(|| Err(io::Error::from(io::ErrorKind::NotFound))));
    }

    #[test]
    fn probe_path_lives_under_home() {
        assert_eq!(
            probe_path(Path::new("/Users/x")),
            PathBuf::from("/Users/x/Library/Application Support/com.apple.TCC/TCC.db")
        );
    }

    #[test]
    fn cache_reuses_value_within_ttl_and_reprobes_after() {
        let cache = Mutex::new(None);
        let t0 = Instant::now();
        let ttl = Duration::from_secs(3);
        assert!(!cached_with(&cache, ttl, t0, || false));
        // Within the TTL the probe must not run again.
        assert!(!cached_with(
            &cache,
            ttl,
            t0 + Duration::from_secs(1),
            || { panic!("probed inside the TTL") }
        ));
        // After the TTL the new answer is picked up.
        assert!(cached_with(
            &cache,
            ttl,
            t0 + Duration::from_secs(4),
            || true
        ));
    }
}
