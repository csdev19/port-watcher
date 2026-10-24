//! `chapay`: sudoless system health from the terminal.

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("chapay reads macOS sensors and only runs on macOS");
    std::process::exit(1);
}

#[cfg(target_os = "macos")]
fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    std::process::exit(mac::run(&args));
}

#[cfg(target_os = "macos")]
mod mac {
    use std::io::{Write, stdout};
    use std::sync::mpsc;
    use std::thread::sleep;
    use std::time::Duration;
    use system_health::cli::args::{self, Command, Format, HeatArgs, TopArgs};
    use system_health::cli::{EXIT_USAGE, check_exit_code, csv, human, json};
    use system_health::events;
    use system_health::infra::clock::local_timestamp;
    use system_health::infra::mac_sources::MacSources;
    use system_health::{Sampler, SensorGroup, Sort, Thresholds, evaluate};

    pub fn run(argv: &[String]) -> i32 {
        let cmd = match args::parse(argv) {
            Ok(c) => c,
            Err(msg) => {
                eprintln!("chapay: {msg}\n\n{}", args::USAGE);
                return EXIT_USAGE;
            }
        };
        match cmd {
            Command::Help => {
                println!("{}", args::USAGE);
                0
            }
            Command::Version => {
                println!("chapay {}", env!("CARGO_PKG_VERSION"));
                0
            }
            Command::Ports => {
                eprintln!("chapay ports: not available yet (the name is reserved).");
                EXIT_USAGE
            }
            Command::Heat(a) => heat(a),
            Command::Top(a) => top(a),
            Command::Sensors { json, all } => sensors(json, all),
            Command::Events { json } => events_cmd(json),
        }
    }

    fn heat(a: HeatArgs) -> i32 {
        let mut sampler = Sampler::new(MacSources::new());
        let machine = sampler.machine();
        let thresholds = Thresholds::default();
        if !sampler.capabilities().smc {
            eprintln!("warning: could not open AppleSMC; temperatures, fan and power unavailable");
        }
        let mut out = stdout().lock();
        if a.format == Format::Csv {
            let _ = writeln!(out, "{}", csv::HEAT_HEADER);
        }
        // CPU load needs a baseline: prime, then wait one window before the first report.
        sampler.sample();
        let window = Duration::from_secs(a.watch_secs.unwrap_or(1));
        loop {
            sleep(window);
            let s = sampler.sample();
            let v = evaluate(&s, &thresholds);
            let text = match a.format {
                Format::Human => {
                    let mut t = human::heat_report(&s, &v, &machine);
                    if a.watch_secs.is_some() {
                        t.push('\n');
                    }
                    t
                }
                Format::Json => format!("{}\n", json::heat(&s, &v)),
                Format::Csv => format!("{}\n", csv::heat_row(&local_timestamp(), &s, &v)),
            };
            if write!(out, "{text}").and_then(|_| out.flush()).is_err() {
                return 0; // closed pipe (for example `| head`)
            }
            if a.watch_secs.is_none() {
                return if a.check { check_exit_code(v.level) } else { 0 };
            }
        }
    }

    fn top(a: TopArgs) -> i32 {
        let mut sampler = Sampler::new(MacSources::new());
        let mut out = stdout().lock();
        if a.format == Format::Csv {
            let _ = writeln!(out, "{}", csv::TOP_HEADER);
        }
        sampler.top(a.sort, a.n); // baseline
        loop {
            sleep(Duration::from_millis(a.interval_ms));
            let rows = sampler.top(a.sort, a.n);
            let text = match a.format {
                Format::Human => {
                    let label = match a.sort {
                        Sort::Cpu => "cpu",
                        Sort::Mem => "mem",
                        Sort::Energy => "energy",
                    };
                    let mut t = human::top_table(&rows, label);
                    if a.watch {
                        t.push('\n');
                    }
                    t
                }
                Format::Json => format!("{}\n", json::top(&rows)),
                Format::Csv => csv::top_rows(&local_timestamp(), &rows)
                    .iter()
                    .map(|r| format!("{r}\n"))
                    .collect(),
            };
            if write!(out, "{text}").and_then(|_| out.flush()).is_err() {
                return 0;
            }
            if !a.watch {
                return 0;
            }
        }
    }

    fn sensors(as_json: bool, all: bool) -> i32 {
        let sources = MacSources::new();
        let mut readings = sources.all_sensor_readings();
        if !all {
            readings.retain(|r| {
                matches!(
                    r.group(),
                    SensorGroup::PerfCore | SensorGroup::EffCore | SensorGroup::Gpu
                )
            });
        }
        readings.sort_by_key(|r| r.key);
        if readings.is_empty() {
            eprintln!("chapay: no SMC temperature sensors available");
        }
        if as_json {
            println!("{}", json::sensors(&readings));
        } else {
            print!("{}", human::sensors_table(&readings));
        }
        0
    }

    fn events_cmd(as_json: bool) -> i32 {
        let (tx, rx) = mpsc::channel::<(&'static str, String)>();
        let emit = move |signal: &'static str, level: &str| {
            let at = local_timestamp();
            if as_json {
                json::event(&at, signal, level)
            } else {
                human::event_line(&at, signal, level)
            }
        };
        let print = |line: String| {
            let mut out = stdout().lock();
            writeln!(out, "{line}").and_then(|_| out.flush()).is_ok()
        };

        if let Some((p, _)) = events::current_thermal() {
            print(emit("thermal", p.label()));
        } else {
            eprintln!("chapay: thermal pressure unavailable");
        }
        if let Some(m) = events::current_memory() {
            print(emit("memory", m.label()));
        }

        let tx_t = tx.clone();
        let _thermal = events::subscribe_thermal(move |p, _| {
            let _ = tx_t.send(("thermal", p.label().to_string()));
        });
        let tx_m = tx;
        let _memory = events::subscribe_memory({
            let tx_m = std::sync::Mutex::new(tx_m);
            move |m| {
                let _ = tx_m.lock().unwrap().send(("memory", m.label().to_string()));
            }
        });
        if _thermal.is_err() || _memory.is_err() {
            eprintln!("chapay: could not subscribe to pressure events");
            return 1;
        }
        // Blocks on the channel: no timers, no polling.
        while let Ok((signal, level)) = rx.recv() {
            if !print(emit(signal, &level)) {
                break;
            }
        }
        0
    }
}
