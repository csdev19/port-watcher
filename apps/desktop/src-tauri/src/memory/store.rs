//! The memory guard's history, in the same SQLite file as the temperature
//! guard (schema step 2 in `thermal/store.rs`, ADR 0011): 5-minute buckets,
//! per-process footprint samples of the top processes, and daily summaries.
//! Opening, migration, corruption handling and retention are the thermal
//! store's; this file only adds the reads and writes.

use rusqlite::{params, OptionalExtension};

use super::procs::ProcInfo;
use super::reading::MemoryPressure;
use super::verdict::{FirstSample, FirstSamples};
use crate::thermal::store::{Store, StoreError};

/// One 5-minute aggregate.
#[derive(Debug, Clone, PartialEq)]
pub struct MemoryBucket {
    pub start_s: i64,
    pub used_avg: f64,
    pub used_max: u64,
    pub swap_avg: f64,
    pub swap_max: u64,
    pub worst_pressure: MemoryPressure,
    pub samples: i64,
}

/// A daily summary; like the thermal one it outlives the 90-day retention.
#[derive(Debug, Clone, PartialEq)]
pub struct MemoryDay {
    pub day: String,
    pub swap_max: u64,
    pub used_max: u64,
    /// Minutes at pressure warning or worse.
    pub warning_minutes: i64,
}

impl Store {
    /// Store a bucket and fold it into its day, atomically. Like
    /// `insert_bucket`, re-storing the same `start_s` replaces the bucket but
    /// adds to the day's minutes again, so the sampler writes each closed
    /// bucket once.
    pub fn insert_memory_bucket(
        &self,
        b: &MemoryBucket,
        local_day: &str,
        warning_minutes: i64,
    ) -> Result<(), StoreError> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "INSERT OR REPLACE INTO memory_buckets
               (start_s, used_avg, used_max, swap_avg, swap_max, worst_pressure, samples)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                b.start_s,
                b.used_avg,
                b.used_max as i64,
                b.swap_avg,
                b.swap_max as i64,
                b.worst_pressure.as_i64(),
                b.samples
            ],
        )?;
        tx.execute(
            "INSERT INTO memory_days (day, swap_max, used_max, warning_minutes)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(day) DO UPDATE SET
               swap_max = max(swap_max, excluded.swap_max),
               used_max = max(used_max, excluded.used_max),
               warning_minutes = warning_minutes + excluded.warning_minutes",
            params![
                local_day,
                b.swap_max as i64,
                b.used_max as i64,
                warning_minutes
            ],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// One footprint sample per process for the tick at `at_s`. A process
    /// sampled twice at the same second keeps its first row.
    pub fn insert_memory_samples(&self, at_s: i64, procs: &[ProcInfo]) -> Result<(), StoreError> {
        let tx = self.conn.unchecked_transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT OR IGNORE INTO memory_samples (pid, started_at, at_s, footprint, name)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
            )?;
            for p in procs {
                stmt.execute(params![
                    p.pid,
                    p.started_at as i64,
                    at_s,
                    p.footprint_bytes as i64,
                    p.name
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// The first retained sample (`MIN(at_s)`) of each incarnation in `keys`
    /// (`(pid, started_at)`). Incarnations with no sample are absent.
    pub fn memory_first_samples(&self, keys: &[(u32, u64)]) -> Result<FirstSamples, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT footprint, at_s FROM memory_samples
             WHERE pid = ?1 AND started_at = ?2 ORDER BY at_s LIMIT 1",
        )?;
        let mut out = FirstSamples::new();
        for &(pid, started_at) in keys {
            let row = stmt
                .query_row(params![pid, started_at as i64], |r| {
                    Ok(FirstSample {
                        footprint_bytes: r.get::<_, i64>(0)? as u64,
                        at_s: r.get(1)?,
                    })
                })
                .optional()?;
            if let Some(first) = row {
                out.insert((pid, started_at), first);
            }
        }
        Ok(out)
    }

    /// Memory buckets with `start_s` in `[from_s, to_s)`, oldest first.
    pub fn memory_buckets(&self, from_s: i64, to_s: i64) -> Result<Vec<MemoryBucket>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT start_s, used_avg, used_max, swap_avg, swap_max, worst_pressure, samples
             FROM memory_buckets WHERE start_s >= ?1 AND start_s < ?2 ORDER BY start_s",
        )?;
        let rows = stmt.query_map([from_s, to_s], |r| {
            Ok(MemoryBucket {
                start_s: r.get(0)?,
                used_avg: r.get(1)?,
                used_max: r.get::<_, i64>(2)? as u64,
                swap_avg: r.get(3)?,
                swap_max: r.get::<_, i64>(4)? as u64,
                worst_pressure: MemoryPressure::from_i64(r.get(5)?),
                samples: r.get(6)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Daily summaries from `since_day` (local `YYYY-MM-DD`, inclusive) on,
    /// newest first.
    pub fn memory_days(&self, since_day: &str) -> Result<Vec<MemoryDay>, StoreError> {
        let mut stmt = self.conn.prepare(
            "SELECT day, swap_max, used_max, warning_minutes
             FROM memory_days WHERE day >= ?1 ORDER BY day DESC",
        )?;
        let rows = stmt.query_map([since_day], |r| {
            Ok(MemoryDay {
                day: r.get(0)?,
                swap_max: r.get::<_, i64>(1)? as u64,
                used_max: r.get::<_, i64>(2)? as u64,
                warning_minutes: r.get(3)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, Store) {
        let d = tempfile::tempdir().unwrap();
        let s = Store::open(&d.path().join("t.sqlite")).unwrap();
        (d, s)
    }

    fn bucket(start_s: i64, used: u64, swap: u64, worst: MemoryPressure, n: i64) -> MemoryBucket {
        MemoryBucket {
            start_s,
            used_avg: used as f64 - 10.0,
            used_max: used,
            swap_avg: swap as f64 - 5.0,
            swap_max: swap,
            worst_pressure: worst,
            samples: n,
        }
    }

    fn proc(pid: u32, started_at: u64, footprint: u64) -> ProcInfo {
        ProcInfo {
            pid,
            started_at,
            name: "zdpd".into(),
            path: None,
            uid: Some(0),
            footprint_bytes: footprint,
        }
    }

    #[test]
    fn bucket_round_trip_respects_half_open_range() {
        let (_d, s) = store();
        let b1 = bucket(300, 100, 10, MemoryPressure::Normal, 5);
        let b2 = bucket(600, 200, 20, MemoryPressure::Critical, 5);
        s.insert_memory_bucket(&b2, "2026-11-07", 0).unwrap();
        s.insert_memory_bucket(&b1, "2026-11-07", 0).unwrap();
        assert_eq!(s.memory_buckets(300, 601).unwrap(), vec![b1.clone(), b2]);
        assert_eq!(s.memory_buckets(300, 600).unwrap(), vec![b1]);
        assert!(s.memory_buckets(0, 300).unwrap().is_empty());
    }

    #[test]
    fn buckets_on_one_day_keep_the_maxima_and_add_the_minutes() {
        let (_d, s) = store();
        s.insert_memory_bucket(
            &bucket(300, 100, 50, MemoryPressure::Warning, 5),
            "2026-11-07",
            2,
        )
        .unwrap();
        s.insert_memory_bucket(
            &bucket(600, 90, 70, MemoryPressure::Normal, 5),
            "2026-11-07",
            0,
        )
        .unwrap();
        s.insert_memory_bucket(
            &bucket(900, 120, 60, MemoryPressure::Warning, 5),
            "2026-11-07",
            3,
        )
        .unwrap();
        let days = s.memory_days("0000-01-01").unwrap();
        assert_eq!(
            days,
            vec![MemoryDay {
                day: "2026-11-07".into(),
                swap_max: 70,
                used_max: 120,
                warning_minutes: 5
            }]
        );
    }

    #[test]
    fn days_are_newest_first_with_a_calendar_cutoff() {
        let (_d, s) = store();
        for (i, day) in ["2026-11-01", "2026-11-03", "2026-11-02"]
            .iter()
            .enumerate()
        {
            let b = bucket(300 * (i as i64 + 1), 1, 1, MemoryPressure::Normal, 1);
            s.insert_memory_bucket(&b, day, 0).unwrap();
        }
        let all: Vec<_> = s
            .memory_days("2026-11-02")
            .unwrap()
            .into_iter()
            .map(|d| d.day)
            .collect();
        assert_eq!(all, vec!["2026-11-03", "2026-11-02"]);
        assert!(s.memory_days("2026-11-04").unwrap().is_empty());
    }

    #[test]
    fn first_sample_is_the_earliest_of_the_same_incarnation() {
        let (_d, s) = store();
        s.insert_memory_samples(2000, &[proc(1101, 7, 6_000)])
            .unwrap();
        s.insert_memory_samples(1000, &[proc(1101, 7, 4_000)])
            .unwrap();
        s.insert_memory_samples(3000, &[proc(1101, 7, 16_000)])
            .unwrap();
        let first = s.memory_first_samples(&[(1101, 7)]).unwrap();
        assert_eq!(
            first[&(1101, 7)],
            FirstSample {
                footprint_bytes: 4_000,
                at_s: 1000
            }
        );
    }

    #[test]
    fn a_reused_pid_has_its_own_first_sample() {
        let (_d, s) = store();
        s.insert_memory_samples(1000, &[proc(1101, 7, 4_000)])
            .unwrap();
        s.insert_memory_samples(5000, &[proc(1101, 99, 300)])
            .unwrap();
        let first = s
            .memory_first_samples(&[(1101, 7), (1101, 99), (1101, 5)])
            .unwrap();
        assert_eq!(first[&(1101, 7)].footprint_bytes, 4_000);
        assert_eq!(first[&(1101, 99)].footprint_bytes, 300);
        assert!(!first.contains_key(&(1101, 5)), "no sample, no entry");
    }

    #[test]
    fn writing_the_same_sample_twice_keeps_one_row() {
        let (_d, s) = store();
        s.insert_memory_samples(1000, &[proc(1101, 7, 4_000)])
            .unwrap();
        s.insert_memory_samples(1000, &[proc(1101, 7, 9_000)])
            .unwrap();
        let n: i64 = s
            .conn
            .query_row("SELECT COUNT(*) FROM memory_samples", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
        assert_eq!(
            s.memory_first_samples(&[(1101, 7)]).unwrap()[&(1101, 7)].footprint_bytes,
            4_000
        );
    }

    #[test]
    fn prune_deletes_memory_rows_older_than_the_cutoff_and_keeps_days() {
        let (_d, s) = store();
        s.insert_memory_bucket(
            &bucket(300, 1, 1, MemoryPressure::Normal, 1),
            "2026-08-01",
            4,
        )
        .unwrap();
        s.insert_memory_bucket(
            &bucket(900, 1, 1, MemoryPressure::Normal, 1),
            "2026-11-01",
            0,
        )
        .unwrap();
        s.insert_memory_samples(400, &[proc(1, 1, 1)]).unwrap();
        s.insert_memory_samples(900, &[proc(1, 1, 1)]).unwrap();
        // The rows exactly at the cutoff stay: only strictly older rows go.
        assert_eq!(s.prune(900).unwrap(), 2);
        assert_eq!(s.memory_buckets(0, 10_000).unwrap().len(), 1);
        let n: i64 = s
            .conn
            .query_row("SELECT COUNT(*) FROM memory_samples", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
        let days = s.memory_days("0000-01-01").unwrap();
        assert_eq!(days.len(), 2);
        assert_eq!(days[1].warning_minutes, 4);
    }
}
