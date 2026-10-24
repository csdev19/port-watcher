//! One-shot thermal pressure read.

use super::ffi;
use std::ffi::CString;
use std::sync::OnceLock;

pub const THERMAL_NOTIFY_NAME: &str = "com.apple.system.thermalpressurelevel";

/// Raw notify state: 0 nominal .. 4 sleeping. Registers one token for the whole process.
pub fn read_level() -> Option<u8> {
    static TOKEN: OnceLock<Option<i32>> = OnceLock::new();
    let token = (*TOKEN.get_or_init(|| {
        let name = CString::new(THERMAL_NOTIFY_NAME).unwrap();
        let mut token = 0;
        (unsafe { ffi::notify_register_check(name.as_ptr(), &mut token) } == 0).then_some(token)
    }))?;
    let mut state = 0u64;
    (unsafe { ffi::notify_get_state(token, &mut state) } == 0)
        .then_some(state.min(u8::MAX as u64) as u8)
}
