use std::path::Path;
use std::sync::OnceLock;

use serde::Deserialize;

#[derive(Deserialize)]
struct Rule {
    contains: Vec<String>,
    label: String,
}

fn rules() -> &'static [Rule] {
    static RULES: OnceLock<Vec<Rule>> = OnceLock::new();
    RULES.get_or_init(|| {
        serde_json::from_str(include_str!("label_rules.json"))
            .expect("label_rules.json is invalid — fix the embedded rules file")
    })
}

/// Spec §6: ordered substring rules over the lowercased full command line;
/// then the runtime fallback (`bun · server.ts`); then the process name.
pub fn label_for(command: &str, process_name: &str) -> String {
    let cmd_lc = command.to_lowercase();
    for rule in rules() {
        if rule
            .contains
            .iter()
            .any(|needle| cmd_lc.contains(needle.as_str()))
        {
            return rule.label.clone();
        }
    }
    if let Some(runtime) = runtime_of(&cmd_lc) {
        if let Some(script) = script_name(command) {
            return format!("{runtime} · {script}");
        }
    }
    process_name.to_string()
}

/// The runtime match is on the executable token's file stem, NOT a substring —
/// otherwise every path containing "node_modules" would match "node".
fn runtime_of(cmd_lc: &str) -> Option<&'static str> {
    let first = cmd_lc.split_whitespace().next()?;
    match Path::new(first).file_stem()?.to_str()? {
        "bun" => Some("bun"),
        "node" => Some("node"),
        "python" | "python3" => Some("python"),
        _ => None,
    }
}

/// First non-flag argument, preferring one that looks like a file. Only its
/// basename: `bun /a/b/server.ts` → `server.ts`.
fn script_name(command: &str) -> Option<String> {
    let args: Vec<&str> = command
        .split_whitespace()
        .skip(1)
        .filter(|t| !t.starts_with('-'))
        .collect();
    let picked = args
        .iter()
        .find(|t| t.contains('.'))
        .or_else(|| args.first())?;
    Some(
        Path::new(picked)
            .file_name()
            .map(|f| f.to_string_lossy().into_owned())
            .unwrap_or_else(|| (*picked).to_string()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_spec_rule_matches() {
        let cases = [
            ("node /x/.bin/next dev", "Next.js dev"),
            ("next-server --port 3000", "Next.js dev"),
            ("node /p/node_modules/.bin/vite", "Vite"),
            ("node /x/wrangler dev", "Wrangler (Workers)"),
            ("/y/workerd serve", "Wrangler (Workers)"),
            ("node /x/astro dev", "Astro"),
            ("node /x/expo start", "Expo / Metro"),
            ("node /x/metro start", "Expo / Metro"),
            ("node /x/nest start --watch", "NestJS"),
            ("node /x/vinxi dev", "TanStack Start"),
            ("node /x/convex dev", "Convex"),
            ("/opt/homebrew/bin/postgres -D /data", "PostgreSQL"),
            ("redis-server *:6379", "Redis"),
            ("/Applications/com.docker.backend", "Docker"),
            ("/x/vpnkit --port 2375", "Docker"),
            ("bun /x/laqi/server.ts", "laqi mock server"),
        ];
        for (cmd, expected) in cases {
            assert_eq!(label_for(cmd, "irrelevant"), expected, "for {cmd}");
        }
    }

    #[test]
    fn first_matching_rule_wins() {
        // Contains both "vite" and "postgres" — "vite" is earlier in the file.
        assert_eq!(label_for("vite --db postgres", "x"), "Vite");
    }

    #[test]
    fn runtime_fallback_uses_script_basename() {
        assert_eq!(
            label_for("/usr/local/bin/bun /a/b/server.ts", "bun"),
            "bun · server.ts"
        );
        assert_eq!(
            label_for("node ./api/index.mjs --port 4000", "node"),
            "node · index.mjs"
        );
        assert_eq!(
            label_for("python3 -m http.server", "python3"),
            "python · http.server"
        );
    }

    #[test]
    fn node_modules_in_path_does_not_trigger_node_runtime() {
        // Executable is deno; path merely contains node_modules.
        assert_eq!(
            label_for("/x/deno run /p/node_modules/x/serve.ts", "deno"),
            "deno"
        );
    }

    #[test]
    fn no_match_falls_back_to_process_name() {
        assert_eq!(label_for("/usr/libexec/weirdd --flag", "weirdd"), "weirdd");
    }

    #[test]
    fn empty_command_falls_back_to_process_name() {
        assert_eq!(label_for("", "rapportd"), "rapportd");
    }
}
