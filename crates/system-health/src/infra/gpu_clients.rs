//! Cumulative GPU time per process from the IORegistry, without sudo.
//!
//! Each GPU client (`AGXDeviceUserClient` on Apple Silicon) is a child of an `IOAccelerator`
//! service. It carries `IOUserClientCreator = "pid 400, WindowServer"` and
//! `AppUsage = ({ "API" = "Metal", "accumulatedGPUTime" = <n>, ... }, ...)`. We walk the
//! children of every accelerator instead of naming the client class, because the class is
//! chip-generation specific, and we skip any client that lacks a key.
//!
//! Undocumented: the keys and the unit (nanoseconds, assumed from the magnitude and from other
//! tools reading the same key) may change with macOS. Callers must treat `None` and missing
//! PIDs as normal.

use super::ffi::*;
use std::collections::HashMap;
use std::ffi::{CString, c_void};

/// The PID in an `IOUserClientCreator` value such as `"pid 400, WindowServer"`.
pub fn parse_creator_pid(creator: &str) -> Option<u32> {
    let rest = creator.trim().strip_prefix("pid ")?;
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    if digits.is_empty() {
        return None;
    }
    // Reject "pid 12abc": the number must end at a comma, a space or the end.
    match rest[digits.len()..].chars().next() {
        None | Some(',') | Some(' ') => digits.parse().ok(),
        _ => None,
    }
}

/// `accumulatedGPUTime` per PID, summed over all of a process's clients. `None` when there is
/// no accelerator. A client without a parsable creator or usage list is skipped.
pub fn gpu_time_by_pid() -> Option<HashMap<u32, u64>> {
    let class = CString::new("IOAccelerator").unwrap();
    let plane = CString::new("IOService").unwrap();
    let creator_key = cf_string("IOUserClientCreator");
    let usage_key = cf_string("AppUsage");
    let time_key = cf_string("accumulatedGPUTime");
    let mut out: HashMap<u32, u64> = HashMap::new();
    let mut found_accelerator = false;
    unsafe {
        let mut accels = 0;
        if IOServiceGetMatchingServices(0, IOServiceMatching(class.as_ptr()), &mut accels) != 0 {
            release_keys(&[creator_key, usage_key, time_key]);
            return None;
        }
        loop {
            let accel = IOIteratorNext(accels);
            if accel == 0 {
                break;
            }
            found_accelerator = true;
            let mut kids = 0;
            if IORegistryEntryGetChildIterator(accel, plane.as_ptr(), &mut kids) == 0 {
                loop {
                    let client = IOIteratorNext(kids);
                    if client == 0 {
                        break;
                    }
                    if let Some((pid, ns)) = read_client(client, creator_key, usage_key, time_key) {
                        *out.entry(pid).or_insert(0) += ns;
                    }
                    IOObjectRelease(client);
                }
                IOObjectRelease(kids);
            }
            IOObjectRelease(accel);
        }
        IOObjectRelease(accels);
    }
    release_keys(&[creator_key, usage_key, time_key]);
    found_accelerator.then_some(out)
}

fn cf_string(s: &str) -> CFTypeRef {
    let c = CString::new(s).unwrap();
    unsafe { CFStringCreateWithCString(std::ptr::null(), c.as_ptr(), K_CF_STRING_ENCODING_UTF8) }
}

fn release_keys(keys: &[CFTypeRef]) {
    for k in keys {
        unsafe { CFRelease(*k) };
    }
}

/// SAFETY: `client` is a live registry entry and the keys are live CFStrings.
unsafe fn read_client(
    client: MachPort,
    creator_key: CFTypeRef,
    usage_key: CFTypeRef,
    time_key: CFTypeRef,
) -> Option<(u32, u64)> {
    unsafe {
        let creator = IORegistryEntryCreateCFProperty(client, creator_key, std::ptr::null(), 0);
        if creator.is_null() {
            return None;
        }
        let pid = if CFGetTypeID(creator) == CFStringGetTypeID() {
            let mut buf = [0 as std::ffi::c_char; 256];
            CFStringGetCString(
                creator,
                buf.as_mut_ptr(),
                buf.len() as isize,
                K_CF_STRING_ENCODING_UTF8,
            )
            .then(|| {
                std::ffi::CStr::from_ptr(buf.as_ptr())
                    .to_string_lossy()
                    .into_owned()
            })
            .and_then(|s| parse_creator_pid(&s))
        } else {
            None
        };
        CFRelease(creator);
        let pid = pid?;

        let usage = IORegistryEntryCreateCFProperty(client, usage_key, std::ptr::null(), 0);
        if usage.is_null() {
            return None;
        }
        let mut total: Option<u64> = None;
        if CFGetTypeID(usage) == CFArrayGetTypeID() {
            for i in 0..CFArrayGetCount(usage) {
                let entry = CFArrayGetValueAtIndex(usage, i);
                if entry.is_null() || CFGetTypeID(entry) != CFDictionaryGetTypeID() {
                    continue;
                }
                let num = CFDictionaryGetValue(entry, time_key);
                let mut v: i64 = 0;
                if !num.is_null()
                    && CFNumberGetValue(num, K_CF_NUMBER_SINT64, &mut v as *mut _ as *mut c_void)
                    && v >= 0
                {
                    total = Some(total.unwrap_or(0).saturating_add(v as u64));
                }
            }
        }
        CFRelease(usage);
        total.map(|t| (pid, t))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_pid_from_a_creator_string() {
        assert_eq!(parse_creator_pid("pid 400, WindowServer"), Some(400));
        assert_eq!(parse_creator_pid("pid 7"), Some(7));
        assert_eq!(parse_creator_pid("  pid 91, Activity Monitor"), Some(91));
    }

    #[test]
    fn rejects_malformed_creators() {
        for bad in [
            "",
            "WindowServer",
            "pid ",
            "pid x, a",
            "pid 12abc, a",
            "PID 4, a",
            "pid -4, a",
        ] {
            assert_eq!(parse_creator_pid(bad), None, "{bad:?}");
        }
    }

    /// Live read on a Mac with a GPU. Run: cargo test -- --ignored gpu_clients
    #[test]
    #[ignore = "reads the real IORegistry; run with --ignored on a Mac"]
    fn live_read_lists_window_server() {
        let map = gpu_time_by_pid().expect("an IOAccelerator exists");
        assert!(!map.is_empty());
        println!("{map:?}");
    }
}
