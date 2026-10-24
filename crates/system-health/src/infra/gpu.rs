//! GPU utilisation from the IORegistry (`IOAccelerator > PerformanceStatistics`).

use super::ffi::*;
use std::ffi::{CString, c_void};

pub fn utilization_pct() -> Option<u8> {
    let class = CString::new("IOAccelerator").unwrap();
    let prop = CString::new("PerformanceStatistics").unwrap();
    let field = CString::new("Device Utilization %").unwrap();
    unsafe {
        let mut it = 0;
        if IOServiceGetMatchingServices(0, IOServiceMatching(class.as_ptr()), &mut it) != 0 {
            return None;
        }
        let prop_key =
            CFStringCreateWithCString(std::ptr::null(), prop.as_ptr(), K_CF_STRING_ENCODING_UTF8);
        let field_key =
            CFStringCreateWithCString(std::ptr::null(), field.as_ptr(), K_CF_STRING_ENCODING_UTF8);
        let mut result: Option<i64> = None;
        loop {
            let entry = IOIteratorNext(it);
            if entry == 0 {
                break;
            }
            let stats = IORegistryEntryCreateCFProperty(entry, prop_key, std::ptr::null(), 0);
            if !stats.is_null() {
                let num = CFDictionaryGetValue(stats, field_key);
                let mut v: i64 = 0;
                if !num.is_null()
                    && CFNumberGetValue(num, K_CF_NUMBER_SINT64, &mut v as *mut _ as *mut c_void)
                {
                    result = Some(result.map_or(v, |r| r.max(v)));
                }
                CFRelease(stats);
            }
            IOObjectRelease(entry);
        }
        CFRelease(prop_key);
        CFRelease(field_key);
        IOObjectRelease(it);
        result.map(|v| v.clamp(0, 100) as u8)
    }
}
