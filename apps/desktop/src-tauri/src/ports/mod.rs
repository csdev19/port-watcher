//! Port enumeration and process control. Split by responsibility:
//! source (listeners crate), label (rules), project (cwd walk),
//! enrich (sysinfo), kill (guards + signals).

#[cfg(test)]
mod listeners_api_smoke {
    /// Pins the `listeners` 0.6 API surface we depend on. If this stops
    /// compiling after a crate bump, `source.rs` is the only production
    /// file that needs the same fix.
    #[test]
    fn get_all_exposes_pid_name_port_and_protocol() {
        let all = listeners::get_all().expect("listeners::get_all failed");
        // Field-access compile check + runtime sanity on a real machine
        // (the test process itself doesn't need to be listening).
        for l in all.iter().take(5) {
            let _pid: u32 = l.process.pid;
            let _name: &str = &l.process.name;
            let _port: u16 = l.socket.port();
            let _proto = &l.protocol; // Protocol enum
            let _state = &l.state; // SocketState enum
        }
        // Protocol variant name check — adjust if rustc suggests otherwise.
        let tcp_only: Vec<_> = all
            .iter()
            .filter(|l| l.protocol == listeners::Protocol::TCP)
            .collect();
        // A dev machine virtually always has at least one TCP listener.
        assert!(!tcp_only.is_empty(), "expected at least one TCP listener");
    }
}
