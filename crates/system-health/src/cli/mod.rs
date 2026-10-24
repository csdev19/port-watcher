//! The `chapay` command line: argument parsing and output formatting. Pure, so it is tested
//! without hardware. The binary wires it to the macOS sources.

pub mod args;
pub mod csv;
pub mod human;
pub mod json;

/// Exit code for a usage error (BSD `sysexits` EX_USAGE).
pub const EXIT_USAGE: i32 = 64;

/// Exit code for `--check`: 0 OK, 1 WATCH, 2 STOP.
pub fn check_exit_code(level: crate::domain::Level) -> i32 {
    match level {
        crate::domain::Level::Ok => 0,
        crate::domain::Level::Watch => 1,
        crate::domain::Level::Stop => 2,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::Level;

    #[test]
    fn check_maps_levels_to_exit_codes() {
        assert_eq!(check_exit_code(Level::Ok), 0);
        assert_eq!(check_exit_code(Level::Watch), 1);
        assert_eq!(check_exit_code(Level::Stop), 2);
    }
}
