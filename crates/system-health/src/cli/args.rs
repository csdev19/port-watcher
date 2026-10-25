//! Hand-rolled argument parsing (no clap: keeps the desktop dependency tree unchanged).

use crate::domain::Sort;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Human,
    Json,
    Csv,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeatArgs {
    pub watch_secs: Option<u64>,
    pub format: Format,
    pub check: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TopArgs {
    pub n: usize,
    pub sort: Sort,
    /// Window between the two snapshots (or between repeated outputs with `--watch`).
    pub interval_ms: u64,
    pub watch: bool,
    pub format: Format,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    Heat(HeatArgs),
    Top(TopArgs),
    Sensors {
        json: bool,
        all: bool,
    },
    Events {
        json: bool,
    },
    /// Reserved name; prints "not available yet".
    Ports,
    Help,
    Version,
}

pub const USAGE: &str = "\
usage: chapay <command> [options]

commands:
  heat    [--watch SECS] [--json | --csv] [--check]
  top     [-n N] [--sort cpu|mem|energy] [--interval MS] [--watch SECS] [--json | --csv]
  sensors [--json] [--all]
  events  [--json]
  --version | --help

heat --check exits 0 for OK, 1 for WATCH, 2 for STOP. Usage errors exit 64.";

fn value<'a>(args: &'a [String], i: &mut usize, flag: &str) -> Result<&'a str, String> {
    *i += 1;
    args.get(*i)
        .map(String::as_str)
        .ok_or_else(|| format!("{flag} needs a value"))
}

fn number(args: &[String], i: &mut usize, flag: &str) -> Result<u64, String> {
    let v = value(args, i, flag)?;
    v.parse::<u64>()
        .map_err(|_| format!("{flag} needs a whole number, got '{v}'"))
}

fn set_format(current: &mut Format, new: Format) -> Result<(), String> {
    if *current != Format::Human && *current != new {
        return Err("--json and --csv cannot be combined".into());
    }
    *current = new;
    Ok(())
}

pub fn parse(args: &[String]) -> Result<Command, String> {
    let Some(cmd) = args.first() else {
        return Ok(Command::Help);
    };
    let rest = &args[1..];
    match cmd.as_str() {
        "--help" | "-h" | "help" => Ok(Command::Help),
        "--version" | "-V" => Ok(Command::Version),
        "ports" => Ok(Command::Ports),
        "heat" => parse_heat(rest),
        "top" => parse_top(rest),
        "sensors" => {
            let (mut json, mut all) = (false, false);
            for a in rest {
                match a.as_str() {
                    "--json" => json = true,
                    "--all" => all = true,
                    other => return Err(format!("unknown option '{other}' for sensors")),
                }
            }
            Ok(Command::Sensors { json, all })
        }
        "events" => {
            let mut json = false;
            for a in rest {
                match a.as_str() {
                    "--json" => json = true,
                    other => return Err(format!("unknown option '{other}' for events")),
                }
            }
            Ok(Command::Events { json })
        }
        other => Err(format!("unknown command '{other}'")),
    }
}

fn parse_heat(args: &[String]) -> Result<Command, String> {
    let mut out = HeatArgs {
        watch_secs: None,
        format: Format::Human,
        check: false,
    };
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--watch" => {
                let secs = number(args, &mut i, "--watch")?;
                if secs == 0 {
                    return Err("--watch needs at least 1 second".into());
                }
                out.watch_secs = Some(secs);
            }
            "--json" => set_format(&mut out.format, Format::Json)?,
            "--csv" => set_format(&mut out.format, Format::Csv)?,
            "--check" => out.check = true,
            other => return Err(format!("unknown option '{other}' for heat")),
        }
        i += 1;
    }
    if out.check && out.watch_secs.is_some() {
        return Err("--check cannot be combined with --watch".into());
    }
    Ok(Command::Heat(out))
}

fn parse_top(args: &[String]) -> Result<Command, String> {
    let mut out = TopArgs {
        n: 10,
        sort: Sort::Cpu,
        interval_ms: 1000,
        watch: false,
        format: Format::Human,
    };
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "-n" => {
                let n = number(args, &mut i, "-n")?;
                if n == 0 {
                    return Err("-n needs at least 1".into());
                }
                out.n = n as usize;
            }
            "--sort" => {
                out.sort = match value(args, &mut i, "--sort")? {
                    "cpu" => Sort::Cpu,
                    "mem" => Sort::Mem,
                    "energy" => Sort::Energy,
                    other => {
                        return Err(format!("--sort must be cpu, mem or energy, got '{other}'"));
                    }
                }
            }
            "--interval" => {
                let ms = number(args, &mut i, "--interval")?;
                if ms < 100 {
                    return Err("--interval must be at least 100 ms".into());
                }
                out.interval_ms = ms;
            }
            "--watch" => {
                let secs = number(args, &mut i, "--watch")?;
                if secs == 0 {
                    return Err("--watch needs at least 1 second".into());
                }
                out.watch = true;
                out.interval_ms = secs * 1000;
            }
            "--json" => set_format(&mut out.format, Format::Json)?,
            "--csv" => set_format(&mut out.format, Format::Csv)?,
            other => return Err(format!("unknown option '{other}' for top")),
        }
        i += 1;
    }
    Ok(Command::Top(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &str) -> Result<Command, String> {
        let v: Vec<String> = s.split_whitespace().map(String::from).collect();
        parse(&v)
    }

    #[test]
    fn valid_invocations() {
        assert_eq!(p("").unwrap(), Command::Help);
        assert_eq!(p("--help").unwrap(), Command::Help);
        assert_eq!(p("--version").unwrap(), Command::Version);
        assert_eq!(p("ports").unwrap(), Command::Ports);
        assert_eq!(
            p("heat").unwrap(),
            Command::Heat(HeatArgs {
                watch_secs: None,
                format: Format::Human,
                check: false
            })
        );
        assert_eq!(
            p("heat --watch 5 --csv").unwrap(),
            Command::Heat(HeatArgs {
                watch_secs: Some(5),
                format: Format::Csv,
                check: false
            })
        );
        assert_eq!(
            p("heat --json --check").unwrap(),
            Command::Heat(HeatArgs {
                watch_secs: None,
                format: Format::Json,
                check: true
            })
        );
        assert_eq!(
            p("top -n 5 --sort mem --json").unwrap(),
            Command::Top(TopArgs {
                n: 5,
                sort: Sort::Mem,
                interval_ms: 1000,
                watch: false,
                format: Format::Json
            })
        );
        assert_eq!(
            p("top --watch 3").unwrap(),
            Command::Top(TopArgs {
                n: 10,
                sort: Sort::Cpu,
                interval_ms: 3000,
                watch: true,
                format: Format::Human
            })
        );
        assert_eq!(
            p("sensors --all --json").unwrap(),
            Command::Sensors {
                json: true,
                all: true
            }
        );
        assert_eq!(p("events --json").unwrap(), Command::Events { json: true });
    }

    #[test]
    fn invalid_invocations_are_errors() {
        for bad in [
            "frobnicate",
            "heat --bogus",
            "heat --watch",
            "heat --watch abc",
            "heat --watch 0",
            "heat --json --csv",
            "heat --check --watch 5",
            "top -n 0",
            "top --sort speed",
            "top --interval 5",
            "sensors --csv",
            "events --watch 1",
        ] {
            assert!(p(bad).is_err(), "'{bad}' should be a usage error");
        }
    }
}
