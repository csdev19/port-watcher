//! thermal-probe: sudoless thermal and load snapshot for Apple Silicon Macs.
//!
//! Sources:
//! - SMC (AppleSMC user client): temperatures, fan speed, system power.
//! - IORegistry (IOAccelerator): GPU utilization.
//! - Mach host statistics: CPU load and memory.
//! - notify(3): macOS thermal pressure level.

use std::ffi::{c_char, c_void, CString};
use std::thread::sleep;
use std::time::Duration;

// ---------- FFI ----------

type CFTypeRef = *const c_void;
type MachPort = u32;

#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    fn IOServiceMatching(name: *const c_char) -> CFTypeRef;
    fn IOServiceGetMatchingService(main_port: MachPort, matching: CFTypeRef) -> MachPort;
    fn IOServiceGetMatchingServices(main_port: MachPort, matching: CFTypeRef, it: *mut MachPort) -> i32;
    fn IOIteratorNext(it: MachPort) -> MachPort;
    fn IOServiceOpen(service: MachPort, task: MachPort, kind: u32, conn: *mut MachPort) -> i32;
    fn IOServiceClose(conn: MachPort) -> i32;
    fn IOObjectRelease(obj: MachPort) -> i32;
    fn IOConnectCallStructMethod(
        conn: MachPort,
        selector: u32,
        input: *const c_void,
        input_size: usize,
        output: *mut c_void,
        output_size: *mut usize,
    ) -> i32;
    fn IORegistryEntryCreateCFProperty(entry: MachPort, key: CFTypeRef, alloc: CFTypeRef, opts: u32) -> CFTypeRef;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFStringCreateWithCString(alloc: CFTypeRef, s: *const c_char, encoding: u32) -> CFTypeRef;
    fn CFDictionaryGetValue(dict: CFTypeRef, key: CFTypeRef) -> CFTypeRef;
    fn CFNumberGetValue(num: CFTypeRef, kind: i32, out: *mut c_void) -> bool;
    fn CFRelease(obj: CFTypeRef);
}

unsafe extern "C" {
    static mach_task_self_: MachPort;
    fn mach_host_self() -> MachPort;
    fn host_statistics(host: MachPort, flavor: i32, info: *mut i32, count: *mut u32) -> i32;
    fn host_statistics64(host: MachPort, flavor: i32, info: *mut i32, count: *mut u32) -> i32;
    fn sysctlbyname(name: *const c_char, old: *mut c_void, oldlen: *mut usize, new: *const c_void, newlen: usize) -> i32;
    fn notify_register_check(name: *const c_char, token: *mut i32) -> u32;
    fn notify_get_state(token: i32, state: *mut u64) -> u32;
}

const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
const K_CF_NUMBER_SINT64: i32 = 4;

// ---------- SMC ----------

#[repr(C)]
#[derive(Default, Clone, Copy)]
struct SmcVers {
    major: u8,
    minor: u8,
    build: u8,
    reserved: u8,
    release: u16,
}

#[repr(C)]
#[derive(Default, Clone, Copy)]
struct SmcPLimit {
    version: u16,
    length: u16,
    cpu_p_limit: u32,
    gpu_p_limit: u32,
    mem_p_limit: u32,
}

#[repr(C)]
#[derive(Default, Clone, Copy)]
struct SmcKeyInfo {
    data_size: u32,
    data_type: u32,
    data_attributes: u8,
}

#[repr(C)]
#[derive(Default, Clone, Copy)]
struct SmcKeyData {
    key: u32,
    vers: SmcVers,
    p_limit: SmcPLimit,
    key_info: SmcKeyInfo,
    result: u8,
    status: u8,
    data8: u8,
    data32: u32,
    bytes: [u8; 32],
}

const SMC_CMD_READ_BYTES: u8 = 5;
const SMC_CMD_READ_INDEX: u8 = 8;
const SMC_CMD_READ_KEYINFO: u8 = 9;

fn fourcc(s: &str) -> u32 {
    s.bytes().fold(0u32, |acc, b| (acc << 8) | b as u32)
}

fn fourcc_str(v: u32) -> String {
    v.to_be_bytes().iter().map(|&b| b as char).collect()
}

struct Smc {
    conn: MachPort,
}

impl Smc {
    fn open() -> Option<Smc> {
        let name = CString::new("AppleSMC").unwrap();
        unsafe {
            let service = IOServiceGetMatchingService(0, IOServiceMatching(name.as_ptr()));
            if service == 0 {
                return None;
            }
            let mut conn = 0;
            let rc = IOServiceOpen(service, mach_task_self_, 0, &mut conn);
            IOObjectRelease(service);
            (rc == 0).then_some(Smc { conn })
        }
    }

    fn call(&self, input: &SmcKeyData) -> Option<SmcKeyData> {
        let mut output = SmcKeyData::default();
        let mut out_size = std::mem::size_of::<SmcKeyData>();
        let rc = unsafe {
            IOConnectCallStructMethod(
                self.conn,
                2,
                input as *const _ as *const c_void,
                std::mem::size_of::<SmcKeyData>(),
                &mut output as *mut _ as *mut c_void,
                &mut out_size,
            )
        };
        (rc == 0 && output.result == 0).then_some(output)
    }

    fn key_info(&self, key: u32) -> Option<SmcKeyInfo> {
        let input = SmcKeyData { key, data8: SMC_CMD_READ_KEYINFO, ..Default::default() };
        self.call(&input).map(|o| o.key_info)
    }

    fn read_raw(&self, key: u32) -> Option<(SmcKeyInfo, [u8; 32])> {
        let info = self.key_info(key)?;
        let input = SmcKeyData { key, key_info: info, data8: SMC_CMD_READ_BYTES, ..Default::default() };
        self.call(&input).map(|o| (info, o.bytes))
    }

    fn read_f64(&self, key: &str) -> Option<f64> {
        let (info, b) = self.read_raw(fourcc(key))?;
        decode(&fourcc_str(info.data_type), info.data_size, &b)
    }

    fn key_at(&self, index: u32) -> Option<u32> {
        let input = SmcKeyData { data8: SMC_CMD_READ_INDEX, data32: index, ..Default::default() };
        self.call(&input).map(|o| o.key)
    }

    /// Every temperature sensor (keys starting with 'T') with a plausible reading.
    fn temperatures(&self) -> Vec<(String, f64)> {
        let count = self.read_f64("#KEY").unwrap_or(0.0) as u32;
        (0..count)
            .filter_map(|i| self.key_at(i))
            .filter(|k| (k >> 24) as u8 == b'T')
            .filter_map(|k| {
                let name = fourcc_str(k);
                let v = self.read_f64(&name)?;
                (v > 15.0 && v < 130.0).then_some((name, v))
            })
            .collect()
    }
}

impl Drop for Smc {
    fn drop(&mut self) {
        unsafe { IOServiceClose(self.conn) };
    }
}

fn decode(kind: &str, size: u32, b: &[u8; 32]) -> Option<f64> {
    match (kind, size) {
        ("flt ", 4) => Some(f32::from_le_bytes([b[0], b[1], b[2], b[3]]) as f64),
        ("ui8 ", 1) => Some(b[0] as f64),
        ("ui16", 2) => Some(u16::from_be_bytes([b[0], b[1]]) as f64),
        ("ui32", 4) => Some(u32::from_be_bytes([b[0], b[1], b[2], b[3]]) as f64),
        ("sp78", 2) => Some(i16::from_be_bytes([b[0], b[1]]) as f64 / 256.0),
        ("fpe2", 2) => Some(u16::from_be_bytes([b[0], b[1]]) as f64 / 4.0),
        _ => None,
    }
}

// ---------- GPU ----------

fn gpu_utilization() -> Option<i64> {
    let class = CString::new("IOAccelerator").unwrap();
    let prop = CString::new("PerformanceStatistics").unwrap();
    let field = CString::new("Device Utilization %").unwrap();
    unsafe {
        let mut it = 0;
        if IOServiceGetMatchingServices(0, IOServiceMatching(class.as_ptr()), &mut it) != 0 {
            return None;
        }
        let prop_key = CFStringCreateWithCString(std::ptr::null(), prop.as_ptr(), K_CF_STRING_ENCODING_UTF8);
        let field_key = CFStringCreateWithCString(std::ptr::null(), field.as_ptr(), K_CF_STRING_ENCODING_UTF8);
        let mut result = None;
        loop {
            let entry = IOIteratorNext(it);
            if entry == 0 {
                break;
            }
            let stats = IORegistryEntryCreateCFProperty(entry, prop_key, std::ptr::null(), 0);
            if !stats.is_null() {
                let num = CFDictionaryGetValue(stats, field_key);
                let mut v: i64 = 0;
                if !num.is_null() && CFNumberGetValue(num, K_CF_NUMBER_SINT64, &mut v as *mut _ as *mut c_void) {
                    result = Some(result.map_or(v, |r: i64| r.max(v)));
                }
                CFRelease(stats);
            }
            IOObjectRelease(entry);
        }
        CFRelease(prop_key);
        CFRelease(field_key);
        IOObjectRelease(it);
        result
    }
}

// ---------- CPU / memory ----------

fn cpu_ticks() -> [u32; 4] {
    // HOST_CPU_LOAD_INFO: user, system, idle, nice
    let mut ticks = [0u32; 4];
    let mut count = 4u32;
    unsafe { host_statistics(mach_host_self(), 3, ticks.as_mut_ptr() as *mut i32, &mut count) };
    ticks
}

fn cpu_usage(a: [u32; 4], b: [u32; 4]) -> f64 {
    let d: Vec<f64> = (0..4).map(|i| b[i].wrapping_sub(a[i]) as f64).collect();
    let total: f64 = d.iter().sum();
    if total == 0.0 { 0.0 } else { 100.0 * (total - d[2]) / total }
}

#[repr(C)]
#[derive(Default)]
struct VmStats64 {
    free_count: u32,
    active_count: u32,
    inactive_count: u32,
    wire_count: u32,
    zero_fill_count: u64,
    reactivations: u64,
    pageins: u64,
    pageouts: u64,
    faults: u64,
    cow_faults: u64,
    lookups: u64,
    hits: u64,
    purges: u64,
    purgeable_count: u32,
    speculative_count: u32,
    decompressions: u64,
    compressions: u64,
    swapins: u64,
    swapouts: u64,
    compressor_page_count: u32,
    throttled_count: u32,
    external_page_count: u32,
    internal_page_count: u32,
    total_uncompressed_pages_in_compressor: u64,
}

#[repr(C)]
#[derive(Default)]
struct XswUsage {
    total: u64,
    avail: u64,
    used: u64,
    pagesize: u32,
    encrypted: u8,
}

fn sysctl<T: Default>(name: &str) -> T {
    let name = CString::new(name).unwrap();
    let mut v = T::default();
    let mut len = std::mem::size_of::<T>();
    unsafe { sysctlbyname(name.as_ptr(), &mut v as *mut _ as *mut c_void, &mut len, std::ptr::null(), 0) };
    v
}

struct Memory {
    total_gb: f64,
    used_gb: f64,
    compressed_gb: f64,
    swap_used_gb: f64,
    free_pct: u32,
}

fn memory() -> Memory {
    const GB: f64 = 1024.0 * 1024.0 * 1024.0;
    let mut vm = VmStats64::default();
    let mut count = (std::mem::size_of::<VmStats64>() / 4) as u32;
    unsafe { host_statistics64(mach_host_self(), 4, &mut vm as *mut _ as *mut i32, &mut count) };
    let page = sysctl::<u64>("hw.pagesize") as f64;
    let total = sysctl::<u64>("hw.memsize") as f64;
    let swap = sysctl::<XswUsage>("vm.swapusage");
    // Same breakdown Activity Monitor uses: app + wired + compressed.
    let app = vm.internal_page_count.saturating_sub(vm.purgeable_count) as f64 * page;
    let wired = vm.wire_count as f64 * page;
    let compressed = vm.compressor_page_count as f64 * page;
    Memory {
        total_gb: total / GB,
        used_gb: (app + wired + compressed) / GB,
        compressed_gb: compressed / GB,
        swap_used_gb: swap.used as f64 / GB,
        free_pct: sysctl::<u32>("kern.memorystatus_level"),
    }
}

fn thermal_pressure() -> Option<u64> {
    // Register once and reuse the token; registering on every sample leaks a token per call.
    static TOKEN: std::sync::OnceLock<Option<i32>> = std::sync::OnceLock::new();
    let token = (*TOKEN.get_or_init(|| {
        let name = CString::new("com.apple.system.thermalpressurelevel").unwrap();
        let mut token = 0;
        (unsafe { notify_register_check(name.as_ptr(), &mut token) } == 0).then_some(token)
    }))?;
    let mut state = 0u64;
    (unsafe { notify_get_state(token, &mut state) } == 0).then_some(state)
}

fn pressure_label(level: u64) -> &'static str {
    match level {
        0 => "nominal",
        1 => "moderate",
        2 => "heavy",
        3 => "trapping",
        _ => "sleeping",
    }
}

// ---------- Sample + verdict ----------

struct Sample {
    cpu_pct: f64,
    gpu_pct: Option<i64>,
    cpu_temp_avg: Option<f64>,
    cpu_temp_max: Option<f64>,
    gpu_temp_max: Option<f64>,
    fan_rpm: Option<f64>,
    fan_max_rpm: Option<f64>,
    system_watts: Option<f64>,
    pressure: Option<u64>,
    mem: Memory,
}

fn stats(values: &[f64]) -> (Option<f64>, Option<f64>) {
    if values.is_empty() {
        return (None, None);
    }
    let avg = values.iter().sum::<f64>() / values.len() as f64;
    let max = values.iter().cloned().fold(f64::MIN, f64::max);
    (Some(avg), Some(max))
}

fn sample(smc: Option<&Smc>, window: Duration) -> Sample {
    let t0 = cpu_ticks();
    sleep(window);
    let cpu_pct = cpu_usage(t0, cpu_ticks());

    let temps = smc.map(|s| s.temperatures()).unwrap_or_default();
    // Apple Silicon naming: Tp* = performance cores, Te* = efficiency cores, Tg* = GPU.
    // Power-gated performance cores report exactly 40.0 C; they are not real readings.
    let cpu: Vec<f64> = temps
        .iter()
        .filter(|(k, v)| k.starts_with("Te") || (k.starts_with("Tp") && *v != 40.0))
        .map(|t| t.1)
        .collect();
    let gpu: Vec<f64> = temps.iter().filter(|(k, _)| k.starts_with("Tg")).map(|t| t.1).collect();
    let (cpu_temp_avg, cpu_temp_max) = stats(&cpu);

    Sample {
        cpu_pct,
        gpu_pct: gpu_utilization(),
        cpu_temp_avg,
        cpu_temp_max,
        gpu_temp_max: stats(&gpu).1,
        fan_rpm: smc.and_then(|s| s.read_f64("F0Ac")),
        fan_max_rpm: smc.and_then(|s| s.read_f64("F0Mx")),
        system_watts: smc.and_then(|s| s.read_f64("PSTR")),
        pressure: thermal_pressure(),
        mem: memory(),
    }
}

#[derive(PartialEq, PartialOrd, Clone, Copy)]
enum Level {
    Ok,
    Watch,
    Stop,
}

impl Level {
    fn tag(self) -> &'static str {
        match self {
            Level::Ok => "OK",
            Level::Watch => "WATCH",
            Level::Stop => "STOP",
        }
    }
}

/// Rule-of-thumb thresholds for Apple Silicon laptops. The authoritative signal is
/// thermal pressure: anything above nominal means macOS is already throttling.
fn verdict(s: &Sample) -> (Level, Vec<String>) {
    let mut level = Level::Ok;
    let mut notes = Vec::new();
    let mut raise = |l: Level, note: String, level: &mut Level| {
        if l > *level {
            *level = l;
        }
        notes.push(note);
    };

    match s.pressure {
        Some(p) if p >= 2 => raise(Level::Stop, format!("thermal pressure {} - macOS is throttling hard", pressure_label(p)), &mut level),
        Some(1) => raise(Level::Watch, "thermal pressure moderate - macOS started limiting performance".into(), &mut level),
        _ => {}
    }
    if let Some(t) = s.cpu_temp_max {
        if t >= 95.0 {
            raise(Level::Stop, format!("CPU hotspot {t:.0} C (>= 95)"), &mut level);
        } else if t >= 80.0 {
            raise(Level::Watch, format!("CPU hotspot {t:.0} C (>= 80)"), &mut level);
        }
    }
    if s.mem.swap_used_gb >= 4.0 || s.mem.free_pct < 15 {
        raise(Level::Watch, format!("memory tight: {:.1} GB swap, {}% free", s.mem.swap_used_gb, s.mem.free_pct), &mut level);
    }
    // Dust heuristic: the fan works hard while the machine is barely doing anything.
    if let (Some(rpm), Some(max)) = (s.fan_rpm, s.fan_max_rpm) {
        let idle = s.cpu_pct < 15.0 && s.gpu_pct.unwrap_or(0) < 15 && s.system_watts.map_or(true, |w| w < 15.0);
        if max > 0.0 && rpm / max > 0.5 && idle {
            raise(Level::Watch, format!("fan at {:.0}% while idle - possible dust/airflow issue", 100.0 * rpm / max), &mut level);
        }
    }
    (level, notes)
}

fn opt(v: Option<f64>, unit: &str) -> String {
    v.map_or("n/a".into(), |x| format!("{x:.1}{unit}"))
}

fn print_report(s: &Sample) {
    let (level, notes) = verdict(s);
    let fan = match (s.fan_rpm, s.fan_max_rpm) {
        (Some(r), Some(m)) if m > 0.0 => format!("{r:.0} rpm ({:.0}% of {m:.0})", 100.0 * r / m),
        (Some(r), _) => format!("{r:.0} rpm"),
        _ => "n/a".into(),
    };
    println!("verdict        {}", level.tag());
    for n in &notes {
        println!("  - {n}");
    }
    println!("thermal        {}", s.pressure.map_or("n/a", pressure_label));
    println!("cpu load       {:.1}%", s.cpu_pct);
    println!("gpu load       {}", s.gpu_pct.map_or("n/a".into(), |g| format!("{g}%")));
    println!("cpu temp       avg {}  max {}", opt(s.cpu_temp_avg, " C"), opt(s.cpu_temp_max, " C"));
    println!("gpu temp       max {}", opt(s.gpu_temp_max, " C"));
    println!("fan            {fan}");
    println!("system power   {}", opt(s.system_watts, " W"));
    println!(
        "memory         {:.1}/{:.0} GB used, {:.1} GB compressed, {:.1} GB swap, {}% free",
        s.mem.used_gb, s.mem.total_gb, s.mem.compressed_gb, s.mem.swap_used_gb, s.mem.free_pct
    );
}

fn csv_header() {
    println!("time,verdict,thermal,cpu_pct,gpu_pct,cpu_temp_avg,cpu_temp_max,gpu_temp_max,fan_rpm,fan_max_rpm,system_w,mem_used_gb,swap_gb,mem_free_pct");
}

fn csv_row(s: &Sample) {
    let f = |v: Option<f64>| v.map_or(String::new(), |x| format!("{x:.1}"));
    let now = std::process::Command::new("date").arg("+%Y-%m-%dT%H:%M:%S").output().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default();
    println!(
        "{now},{},{},{:.1},{},{},{},{},{},{},{},{:.1},{:.1},{}",
        verdict(s).0.tag(),
        s.pressure.map_or("", pressure_label),
        s.cpu_pct,
        s.gpu_pct.map_or(String::new(), |g| g.to_string()),
        f(s.cpu_temp_avg),
        f(s.cpu_temp_max),
        f(s.gpu_temp_max),
        f(s.fan_rpm),
        f(s.fan_max_rpm),
        f(s.system_watts),
        s.mem.used_gb,
        s.mem.swap_used_gb,
        s.mem.free_pct
    );
}

fn usage() -> ! {
    eprintln!("usage: thermal-probe [--sensors] [--watch SECONDS] [--csv]");
    std::process::exit(2);
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut watch: Option<u64> = None;
    let mut csv = false;
    let mut sensors = false;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--watch" => {
                i += 1;
                watch = Some(args.get(i).and_then(|v| v.parse().ok()).unwrap_or_else(|| usage()));
            }
            "--csv" => csv = true,
            "--sensors" => sensors = true,
            _ => usage(),
        }
        i += 1;
    }

    let smc = Smc::open();
    if smc.is_none() {
        eprintln!("warning: could not open AppleSMC; temperatures, fan and power unavailable");
    }

    if sensors {
        let mut temps = smc.as_ref().map(|s| s.temperatures()).unwrap_or_default();
        temps.sort_by(|a, b| a.0.cmp(&b.0));
        for (k, v) in temps {
            println!("{k}  {v:.1} C");
        }
        return;
    }

    match watch {
        None => {
            let s = sample(smc.as_ref(), Duration::from_secs(1));
            if csv {
                csv_header();
                csv_row(&s);
            } else {
                print_report(&s);
            }
        }
        Some(secs) => {
            if csv {
                csv_header();
            }
            loop {
                let s = sample(smc.as_ref(), Duration::from_secs(secs.max(1)));
                if csv {
                    csv_row(&s);
                } else {
                    print_report(&s);
                    println!();
                }
            }
        }
    }
}
