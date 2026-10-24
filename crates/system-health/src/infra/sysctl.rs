//! Typed `sysctlbyname` reads.

use std::ffi::{CString, c_void};

/// Reads a fixed-size value. `None` when the name does not exist or the size does not match.
pub fn read<T: Default>(name: &str) -> Option<T> {
    let name = CString::new(name).ok()?;
    let mut v = T::default();
    let mut len = std::mem::size_of::<T>();
    let rc = unsafe {
        libc::sysctlbyname(
            name.as_ptr(),
            &mut v as *mut T as *mut c_void,
            &mut len,
            std::ptr::null_mut(),
            0,
        )
    };
    (rc == 0 && len == std::mem::size_of::<T>()).then_some(v)
}

pub fn read_string(name: &str) -> Option<String> {
    let cname = CString::new(name).ok()?;
    let mut len = 0usize;
    let rc = unsafe {
        libc::sysctlbyname(
            cname.as_ptr(),
            std::ptr::null_mut(),
            &mut len,
            std::ptr::null_mut(),
            0,
        )
    };
    if rc != 0 || len == 0 {
        return None;
    }
    let mut buf = vec![0u8; len];
    let rc = unsafe {
        libc::sysctlbyname(
            cname.as_ptr(),
            buf.as_mut_ptr() as *mut c_void,
            &mut len,
            std::ptr::null_mut(),
            0,
        )
    };
    if rc != 0 {
        return None;
    }
    buf.truncate(len);
    while buf.last() == Some(&0) {
        buf.pop();
    }
    String::from_utf8(buf).ok()
}
