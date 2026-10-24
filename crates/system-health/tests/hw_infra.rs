//! Hardware tests: run only on a real Apple Silicon Mac with `CHAPAY_HW_TESTS=1`.
#![cfg(target_os = "macos")]

use system_health::SensorGroup;
use system_health::infra::{cpu, machine, memory, smc::Smc, sysctl, thermal};

fn enabled() -> bool {
    std::env::var("CHAPAY_HW_TESTS").is_ok()
}

#[test]
fn smc_opens_with_a_performance_core_reading() {
    if !enabled() {
        return;
    }
    let smc = Smc::open().expect("AppleSMC should open without sudo");
    let readings = smc.read_cached(&[SensorGroup::PerfCore]);
    assert!(!readings.is_empty(), "expected at least one Tp* reading");
}

#[test]
fn read_cached_returns_a_stable_key_set() {
    if !enabled() {
        return;
    }
    let smc = Smc::open().unwrap();
    let groups = [
        SensorGroup::PerfCore,
        SensorGroup::EffCore,
        SensorGroup::Gpu,
    ];
    let keys = |smc: &Smc| {
        smc.read_cached(&groups)
            .iter()
            .map(|r| r.key)
            .collect::<Vec<_>>()
    };
    assert_eq!(keys(&smc), keys(&smc));
}

#[test]
fn core_count_matches_hw_ncpu() {
    if !enabled() {
        return;
    }
    let ncpu = sysctl::read::<u32>("hw.ncpu").unwrap() as usize;
    let info = machine::read();
    let ticks = cpu::read(info.cores_e).unwrap();
    assert_eq!(ticks.cores.len(), ncpu);
    assert_eq!(info.cores_p as usize + info.cores_e as usize, ncpu);
}

#[test]
fn thermal_level_is_in_range() {
    if !enabled() {
        return;
    }
    let level = thermal::read_level().expect("thermal pressure should be readable");
    assert!(level <= 4, "level {level}");
}

#[test]
fn memory_reads_are_sane() {
    if !enabled() {
        return;
    }
    let m = memory::read();
    assert!(m.total_bytes > 0 && m.used_bytes > 0 && m.used_bytes <= m.total_bytes);
    assert!(memory::pressure().is_some());
}

#[test]
fn a_busy_thread_ranks_in_the_top_five_by_cpu() {
    if !enabled() {
        return;
    }
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};
    use system_health::infra::procs::ProcessReader;
    use system_health::{Sort, rank};

    let stop = Arc::new(AtomicBool::new(false));
    let s = stop.clone();
    let busy = std::thread::spawn(move || {
        let mut x = 0u64;
        while !s.load(Ordering::Relaxed) {
            x = std::hint::black_box(x.wrapping_add(1));
        }
    });
    let mut reader = ProcessReader::new();
    let before = reader.read_all();
    assert!(
        before.len() > 50,
        "only {} processes readable",
        before.len()
    );
    let t0 = std::time::Instant::now();
    std::thread::sleep(std::time::Duration::from_millis(1000));
    let after = reader.read_all();
    let dt = t0.elapsed().as_millis() as u64;
    stop.store(true, Ordering::Relaxed);
    busy.join().unwrap();

    let top = rank(&before, &after, dt, Sort::Cpu, 5);
    let me = std::process::id();
    let mine = top
        .iter()
        .find(|u| u.pid == me)
        .unwrap_or_else(|| panic!("test process not in top 5: {top:?}"));
    assert!(mine.cpu_pct > 50.0, "cpu {}", mine.cpu_pct);
    assert!(mine.footprint_bytes > 0);
}

#[test]
fn energy_is_reported_for_own_processes() {
    if !enabled() {
        return;
    }
    assert!(system_health::infra::procs::ProcessReader::new().energy_supported());
}
