//! Local temperature history: 5-minute buckets, peak events and daily
//! summaries in one SQLite file owned by Rust (ADR 0009). The renderer never
//! opens it; it only sees what the `thermal_*` commands return.
//!
//! Opening follows the hub's local-store-migration rules 6 and 7: a file that
//! is itself unusable (corrupt, not a database, newer schema) is moved aside
//! and replaced, while any other failure (busy, permission, I/O) leaves the
//! file untouched. The schema version is read inside the write transaction,
//! because two chapay processes (dev build and installed app) can race.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, ErrorCode, TransactionBehavior};
use serde::{Deserialize, Serialize};

/// The schema version this build writes. Steps are appended, never edited.
const SCHEMA_VERSION: i64 = 1;

/// How long a writer waits for another process holding the lock.
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

/// Schema step 1, verbatim from the spec. Never edit a shipped step.
const STEP_1: &str = "
CREATE TABLE buckets (
  start_s INTEGER PRIMARY KEY,
  min_c REAL NOT NULL, avg_c REAL NOT NULL, max_avg_c REAL NOT NULL,
  max_c REAL NOT NULL,
  worst_state INTEGER NOT NULL,
  samples INTEGER NOT NULL
);
CREATE TABLE peaks (
  id INTEGER PRIMARY KEY,
  at_s INTEGER NOT NULL, avg_c REAL NOT NULL, max_c REAL NOT NULL,
  state INTEGER NOT NULL,
  processes TEXT NOT NULL
);
CREATE INDEX peaks_at ON peaks(at_s);
CREATE TABLE days (
  day TEXT PRIMARY KEY,
  min_c REAL NOT NULL, max_c REAL NOT NULL,
  sum_c REAL NOT NULL, samples INTEGER NOT NULL,
  serious_minutes INTEGER NOT NULL
);
";

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("database schema version {found} is newer than this build supports ({supported})")]
    FutureVersion { found: i64, supported: i64 },
}

impl StoreError {
    /// Whether the file itself is unusable, the only case where it is moved
    /// aside (rule 6). Busy, permission and I/O errors are not.
    fn is_busy(&self) -> bool {
        matches!(
            self,
            StoreError::Sqlite(rusqlite::Error::SqliteFailure(e, _))
                if matches!(e.code, ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked)
        )
    }

    fn file_is_unusable(&self) -> bool {
        match self {
            StoreError::FutureVersion { .. } => true,
            StoreError::Sqlite(rusqlite::Error::SqliteFailure(e, _)) => {
                matches!(e.code, ErrorCode::DatabaseCorrupt | ErrorCode::NotADatabase)
            }
            _ => false,
        }
    }
}

/// One 5-minute aggregate. `worst_state` is 0 (nominal) to 3 (critical).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bucket {
    pub start_s: i64,
    pub min_c: f64,
    pub avg_c: f64,
    pub max_avg_c: f64,
    pub max_c: f64,
    pub worst_state: i64,
    pub samples: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeakProcess {
    pub pid: u32,
    pub name: String,
    pub cpu: f32,
    pub ports: Vec<u16>,
}

/// A hot moment with the processes that were busiest at the time.
/// `id` is `None` until the row is first stored.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Peak {
    pub id: Option<i64>,
    pub at_s: i64,
    pub avg_c: f64,
    pub max_c: f64,
    pub state: i64,
    pub processes: Vec<PeakProcess>,
}

/// A daily summary; it outlives the 90-day retention of buckets and peaks.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Day {
    pub day: String,
    pub min_c: f64,
    pub avg_c: f64,
    pub max_c: f64,
    pub serious_minutes: i64,
}

pub struct Store {
    conn: Connection,
}

impl Store {
    /// Open (creating and migrating if needed) the store at `path`.
    ///
    /// If the file is corrupt, not a database, or from a newer schema, it is
    /// renamed to `<name>.corrupt-<unix-seconds>` (with its `-wal`/`-shm`
    /// siblings), a warning is logged, and a fresh file is opened once. Any
    /// other error is returned and the file is left as it was.
    pub fn open(path: &Path) -> Result<Store, StoreError> {
        match Self::try_open_while_busy(path) {
            Err(e) if e.file_is_unusable() => {
                let moved = move_aside(path)?;
                log::warn!(
                    "thermal store at {} is unusable ({e}); moved to {}",
                    path.display(),
                    moved.display()
                );
                Self::try_open_while_busy(path)
            }
            other => other,
        }
    }

    /// `try_open`, retried while another connection holds the lock. SQLite
    /// returns SQLITE_BUSY without calling the busy handler in some paths
    /// (switching to WAL, and a read lock that cannot upgrade to write), so
    /// two chapay processes starting together could otherwise lose history
    /// for the session. Never retried past `BUSY_TIMEOUT`.
    fn try_open_while_busy(path: &Path) -> Result<Store, StoreError> {
        let deadline = std::time::Instant::now() + BUSY_TIMEOUT;
        let mut wait = Duration::from_millis(10);
        loop {
            match Self::try_open(path) {
                Err(e) if e.is_busy() && std::time::Instant::now() < deadline => {
                    std::thread::sleep(wait);
                    wait = (wait * 2).min(Duration::from_millis(200));
                }
                other => return other,
            }
        }
    }

    fn try_open(path: &Path) -> Result<Store, StoreError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut conn = Connection::open(path)?;
        // The timeout first, so the WAL switch and the migration both wait
        // for a second process instead of failing with "database is locked".
        conn.busy_timeout(BUSY_TIMEOUT)?;
        conn.query_row("PRAGMA journal_mode=WAL", [], |r| r.get::<_, String>(0))?;
        migrate(&mut conn)?;
        Ok(Store { conn })
    }

    /// Store a bucket and fold it into its day, atomically. Re-storing the
    /// same `start_s` replaces the bucket but adds to the day again, so the
    /// sampler writes each closed bucket once.
    pub fn insert_bucket(
        &self,
        b: &Bucket,
        local_day: &str,
        serious_minutes: i64,
    ) -> Result<(), StoreError> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "INSERT OR REPLACE INTO buckets
               (start_s, min_c, avg_c, max_avg_c, max_c, worst_state, samples)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                b.start_s,
                b.min_c,
                b.avg_c,
                b.max_avg_c,
                b.max_c,
                b.worst_state,
                b.samples
            ],
        )?;
        tx.execute(
            "INSERT INTO days (day, min_c, max_c, sum_c, samples, serious_minutes)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(day) DO UPDATE SET
               min_c = min(min_c, excluded.min_c),
               max_c = max(max_c, excluded.max_c),
               sum_c = sum_c + excluded.sum_c,
               samples = samples + excluded.samples,
               serious_minutes = serious_minutes + excluded.serious_minutes",
            params![
                local_day,
                b.min_c,
                b.max_avg_c,
                b.avg_c * b.samples as f64,
                b.samples,
                serious_minutes
            ],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Insert a peak (`id` is `None`) or update the row it names. Returns the id.
    pub fn upsert_peak(&self, p: &Peak) -> Result<i64, StoreError> {
        let processes = serde_json::to_string(&p.processes)?;
        match p.id {
            None => {
                self.conn.execute(
                    "INSERT INTO peaks (at_s, avg_c, max_c, state, processes)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![p.at_s, p.avg_c, p.max_c, p.state, processes],
                )?;
                Ok(self.conn.last_insert_rowid())
            }
            Some(id) => {
                self.conn.execute(
                    "UPDATE peaks SET at_s = ?2, avg_c = ?3, max_c = ?4, state = ?5,
                       processes = ?6 WHERE id = ?1",
                    params![id, p.at_s, p.avg_c, p.max_c, p.state, processes],
                )?;
                Ok(id)
            }
        }
    }

    /// Delete buckets and peaks older than `before_s`; returns how many rows
    /// went. `days` is never touched: daily summaries are kept.
    pub fn prune(&self, before_s: i64) -> Result<usize, StoreError> {
        let tx = self.conn.unchecked_transaction()?;
        let a = tx.execute("DELETE FROM buckets WHERE start_s < ?1", [before_s])?;
        let b = tx.execute("DELETE FROM peaks WHERE at_s < ?1", [before_s])?;
        tx.commit()?;
        Ok(a + b)
    }

    /// Buckets with `start_s` in `[from_s, to_s)`, oldest first.
    pub fn buckets(&self, from_s: i64, to_s: i64) -> Result<Vec<Bucket>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT start_s, min_c, avg_c, max_avg_c, max_c, worst_state, samples
             FROM buckets WHERE start_s >= ?1 AND start_s < ?2 ORDER BY start_s",
        )?;
        let rows = stmt.query_map([from_s, to_s], |r| {
            Ok(Bucket {
                start_s: r.get(0)?,
                min_c: r.get(1)?,
                avg_c: r.get(2)?,
                max_avg_c: r.get(3)?,
                max_c: r.get(4)?,
                worst_state: r.get(5)?,
                samples: r.get(6)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Peaks with `at_s` in `[from_s, to_s)`, newest first.
    pub fn peaks(&self, from_s: i64, to_s: i64) -> Result<Vec<Peak>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, at_s, avg_c, max_c, state, processes
             FROM peaks WHERE at_s >= ?1 AND at_s < ?2 ORDER BY at_s DESC",
        )?;
        let rows = stmt.query_map([from_s, to_s], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, f64>(2)?,
                r.get::<_, f64>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, String>(5)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (id, at_s, avg_c, max_c, state, processes) = row?;
            out.push(Peak {
                id: Some(id),
                at_s,
                avg_c,
                max_c,
                state,
                processes: serde_json::from_str(&processes)?,
            });
        }
        Ok(out)
    }

    /// Daily summaries from `since_day` (local `YYYY-MM-DD`, inclusive) on,
    /// newest first. A calendar cutoff, not a row count: after weeks away,
    /// "the last 7 days" must not reach back to the last days on record.
    pub fn days(&self, since_day: &str) -> Result<Vec<Day>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT day, min_c, sum_c, samples, max_c, serious_minutes
             FROM days WHERE day >= ?1 ORDER BY day DESC",
        )?;
        let rows = stmt.query_map([since_day], |r| {
            let sum: f64 = r.get(2)?;
            let samples: i64 = r.get(3)?;
            Ok(Day {
                day: r.get(0)?,
                min_c: r.get(1)?,
                avg_c: if samples > 0 {
                    sum / samples as f64
                } else {
                    0.0
                },
                max_c: r.get(4)?,
                serious_minutes: r.get(5)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Sample-weighted average over the days from `since_day` on, so a day
    /// with few samples (a laptop asleep most of it) counts for less. `None`
    /// when that window holds no history.
    pub fn baseline(&self, since_day: &str) -> Result<Option<f64>, StoreError> {
        let (sum, samples): (Option<f64>, Option<i64>) = self.conn.query_row(
            "SELECT SUM(sum_c), SUM(samples) FROM days WHERE day >= ?1",
            [since_day],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        Ok(match (sum, samples) {
            (Some(s), Some(n)) if n > 0 => Some(s / n as f64),
            _ => None,
        })
    }
}

/// Apply exactly the missing schema steps under the write lock. The version
/// is read after `BEGIN IMMEDIATE`: a second process that migrated first makes
/// this a no-op instead of a "table already exists" error (rule 7).
fn migrate(conn: &mut Connection) -> Result<(), StoreError> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let version: i64 = tx.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version > SCHEMA_VERSION {
        return Err(StoreError::FutureVersion {
            found: version,
            supported: SCHEMA_VERSION,
        });
    }
    if version < 1 {
        tx.execute_batch(STEP_1)?;
    }
    if version < SCHEMA_VERSION {
        tx.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    }
    tx.commit()?;
    Ok(())
}

/// Rename the database and its `-wal`/`-shm` siblings to
/// `<name>.corrupt-<unix-seconds>`, adding `-1`, `-2`... when that name (or a
/// sibling of it) is taken. Nothing is ever overwritten.
fn move_aside(path: &Path) -> Result<PathBuf, StoreError> {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let with_suffix = |p: &Path, suffix: &str| {
        let mut s = p.as_os_str().to_owned();
        s.push(suffix);
        PathBuf::from(s)
    };
    let mut n = 0u32;
    let target = loop {
        let tag = if n == 0 {
            format!(".corrupt-{secs}")
        } else {
            format!(".corrupt-{secs}-{n}")
        };
        let target = with_suffix(path, &tag);
        let taken = ["", "-wal", "-shm"]
            .iter()
            .any(|s| with_suffix(&target, s).exists());
        if !taken {
            break target;
        }
        n += 1;
    };
    for sidecar in ["", "-wal", "-shm"] {
        let from = with_suffix(path, sidecar);
        if from.exists() {
            std::fs::rename(&from, with_suffix(&target, sidecar))?;
        }
    }
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    fn bucket(start_s: i64, min_c: f64, avg_c: f64, max_c: f64, samples: i64) -> Bucket {
        Bucket {
            start_s,
            min_c,
            avg_c,
            max_avg_c: avg_c + 1.0,
            max_c,
            worst_state: 1,
            samples,
        }
    }

    fn peak(id: Option<i64>, at_s: i64, max_c: f64) -> Peak {
        Peak {
            id,
            at_s,
            avg_c: max_c - 5.0,
            max_c,
            state: 2,
            processes: vec![PeakProcess {
                pid: 42,
                name: "node".into(),
                cpu: 87.5,
                ports: vec![3000, 5173],
            }],
        }
    }

    fn corrupt_files(dir: &Path) -> Vec<String> {
        std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| n.contains(".corrupt-"))
            .collect()
    }

    #[test]
    fn open_twice_is_a_noop_and_keeps_data() {
        let d = dir();
        let path = d.path().join("nested/thermal.sqlite");
        let s = Store::open(&path).unwrap();
        s.insert_bucket(&bucket(300, 40.0, 50.0, 60.0, 5), "2026-11-04", 0)
            .unwrap();
        drop(s);
        let s = Store::open(&path).unwrap();
        assert_eq!(s.buckets(0, 1000).unwrap().len(), 1);
        let v: i64 = s
            .conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, SCHEMA_VERSION);
        assert!(corrupt_files(path.parent().unwrap()).is_empty());
    }

    #[test]
    fn bucket_round_trip_respects_half_open_range() {
        let d = dir();
        let s = Store::open(&d.path().join("t.sqlite")).unwrap();
        let b1 = bucket(300, 40.0, 50.0, 60.0, 5);
        let b2 = bucket(600, 41.0, 51.0, 61.0, 5);
        s.insert_bucket(&b2, "2026-11-04", 0).unwrap();
        s.insert_bucket(&b1, "2026-11-04", 0).unwrap();
        assert_eq!(s.buckets(300, 601).unwrap(), vec![b1.clone(), b2]);
        assert_eq!(s.buckets(300, 600).unwrap(), vec![b1]);
        assert!(s.buckets(0, 300).unwrap().is_empty());
    }

    #[test]
    fn two_buckets_on_one_day_aggregate() {
        let d = dir();
        let s = Store::open(&d.path().join("t.sqlite")).unwrap();
        s.insert_bucket(&bucket(300, 40.0, 50.0, 60.0, 1), "2026-11-04", 0)
            .unwrap();
        s.insert_bucket(&bucket(600, 35.0, 70.0, 90.0, 3), "2026-11-04", 5)
            .unwrap();
        let days = s.days("0000-01-01").unwrap();
        assert_eq!(days.len(), 1);
        let day = &days[0];
        assert_eq!(day.day, "2026-11-04");
        assert_eq!(day.min_c, 35.0);
        // The day's Max uses the same measure as its Min and Avg (the average
        // die temperature), not the hottest single sensor (90).
        assert_eq!(day.max_c, 71.0);
        // (50*1 + 70*3) / 4 samples
        assert!((day.avg_c - 65.0).abs() < 1e-9);
        assert_eq!(day.serious_minutes, 5);
    }

    #[test]
    fn peak_insert_then_update() {
        let d = dir();
        let s = Store::open(&d.path().join("t.sqlite")).unwrap();
        let id = s.upsert_peak(&peak(None, 1000, 96.0)).unwrap();
        let mut p = s.peaks(0, 2000).unwrap().remove(0);
        assert_eq!(p.id, Some(id));
        assert_eq!(p.processes, peak(None, 0, 0.0).processes);
        p.max_c = 101.0;
        assert_eq!(s.upsert_peak(&p).unwrap(), id);
        let all = s.peaks(0, 2000).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].max_c, 101.0);
    }

    #[test]
    fn peaks_are_newest_first() {
        let d = dir();
        let s = Store::open(&d.path().join("t.sqlite")).unwrap();
        s.upsert_peak(&peak(None, 1000, 96.0)).unwrap();
        s.upsert_peak(&peak(None, 3000, 97.0)).unwrap();
        s.upsert_peak(&peak(None, 2000, 98.0)).unwrap();
        let at: Vec<i64> = s.peaks(0, 4000).unwrap().iter().map(|p| p.at_s).collect();
        assert_eq!(at, vec![3000, 2000, 1000]);
    }

    #[test]
    fn prune_deletes_old_rows_and_keeps_days() {
        let d = dir();
        let s = Store::open(&d.path().join("t.sqlite")).unwrap();
        s.insert_bucket(&bucket(300, 40.0, 50.0, 60.0, 5), "2026-08-01", 0)
            .unwrap();
        s.insert_bucket(&bucket(900, 40.0, 50.0, 60.0, 5), "2026-11-01", 0)
            .unwrap();
        s.upsert_peak(&peak(None, 400, 96.0)).unwrap();
        s.upsert_peak(&peak(None, 900, 96.0)).unwrap();
        // The row exactly at the cutoff stays: only strictly older rows go.
        assert_eq!(s.prune(900).unwrap(), 2);
        assert_eq!(s.buckets(0, 10_000).unwrap().len(), 1);
        assert_eq!(s.peaks(0, 10_000).unwrap().len(), 1);
        assert_eq!(s.days("0000-01-01").unwrap().len(), 2);
    }

    #[test]
    fn garbage_file_is_moved_aside() {
        let d = dir();
        let path = d.path().join("thermal.sqlite");
        std::fs::write(&path, b"not a database").unwrap();
        let s = Store::open(&path).unwrap();
        s.insert_bucket(&bucket(300, 40.0, 50.0, 60.0, 5), "2026-11-04", 0)
            .unwrap();
        let moved = corrupt_files(d.path());
        assert_eq!(moved.len(), 1, "{moved:?}");
        let kept = std::fs::read(d.path().join(&moved[0])).unwrap();
        assert_eq!(kept, b"not a database");
    }

    #[test]
    fn future_version_is_moved_aside() {
        let d = dir();
        let path = d.path().join("thermal.sqlite");
        {
            let c = Connection::open(&path).unwrap();
            c.pragma_update(None, "user_version", 99).unwrap();
            c.execute_batch("CREATE TABLE marker (x)").unwrap();
        }
        let s = Store::open(&path).unwrap();
        assert!(s.buckets(0, 1000).unwrap().is_empty());
        let moved = corrupt_files(d.path());
        assert_eq!(moved.len(), 1, "{moved:?}");
        let old = Connection::open(d.path().join(&moved[0])).unwrap();
        let v: i64 = old
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, 99);
    }

    #[test]
    fn move_aside_never_overwrites_and_takes_siblings() {
        let d = dir();
        let path = d.path().join("thermal.sqlite");
        std::fs::write(&path, b"one").unwrap();
        std::fs::write(d.path().join("thermal.sqlite-wal"), b"wal").unwrap();
        let first = move_aside(&path).unwrap();
        assert_eq!(std::fs::read(&first).unwrap(), b"one");
        assert!(!d.path().join("thermal.sqlite-wal").exists());
        std::fs::write(&path, b"two").unwrap();
        let second = move_aside(&path).unwrap();
        assert_ne!(first, second);
        assert_eq!(std::fs::read(&first).unwrap(), b"one");
        assert_eq!(std::fs::read(&second).unwrap(), b"two");
    }

    #[test]
    fn baseline_is_sample_weighted_over_recent_days() {
        let d = dir();
        let s = Store::open(&d.path().join("t.sqlite")).unwrap();
        assert_eq!(s.baseline("2026-10-01").unwrap(), None);
        s.insert_bucket(&bucket(300, 30.0, 40.0, 50.0, 1), "2026-11-01", 0)
            .unwrap();
        s.insert_bucket(&bucket(600, 30.0, 60.0, 70.0, 3), "2026-11-02", 0)
            .unwrap();
        s.insert_bucket(&bucket(900, 30.0, 100.0, 110.0, 6), "2026-11-03", 0)
            .unwrap();
        // All three days: (40 + 180 + 600) / 10, not the mean of daily means.
        assert!((s.baseline("2026-11-01").unwrap().unwrap() - 82.0).abs() < 1e-9);
        // From the 2nd on: (180 + 600) / 9.
        assert!((s.baseline("2026-11-02").unwrap().unwrap() - 780.0 / 9.0).abs() < 1e-9);
        // A window after the last day on record has no baseline, however
        // many older days exist.
        assert_eq!(s.baseline("2026-11-04").unwrap(), None);
        assert!(s.days("2026-11-04").unwrap().is_empty());
    }

    #[test]
    fn concurrent_opens_both_succeed() {
        let d = dir();
        let path = d.path().join("thermal.sqlite");
        let handles: Vec<_> = (0..4)
            .map(|_| {
                let p = path.clone();
                std::thread::spawn(move || Store::open(&p).map(|_| ()))
            })
            .collect();
        for h in handles {
            h.join().unwrap().unwrap();
        }
        assert!(corrupt_files(d.path()).is_empty());
    }
}
