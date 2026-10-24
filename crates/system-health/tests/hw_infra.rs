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
