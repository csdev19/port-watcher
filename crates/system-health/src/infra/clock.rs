//! Local timestamp without spawning `date`.

/// Current local time as `YYYY-MM-DDTHH:MM:SS`.
pub fn local_timestamp() -> String {
    let now = unsafe { libc::time(std::ptr::null_mut()) };
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    unsafe { libc::localtime_r(&now, &mut tm) };
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}",
        tm.tm_year + 1900,
        tm.tm_mon + 1,
        tm.tm_mday,
        tm.tm_hour,
        tm.tm_min,
        tm.tm_sec
    )
}

#[cfg(test)]
mod tests {
    #[test]
    fn timestamp_has_the_expected_shape() {
        let t = super::local_timestamp();
        assert_eq!(t.len(), 19);
        assert_eq!(&t[10..11], "T");
        assert!(t.starts_with("20"));
    }
}
