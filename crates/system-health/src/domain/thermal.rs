//! macOS thermal pressure, as published on `com.apple.system.thermalpressurelevel`.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ThermalPressure {
    Nominal,
    Fair,
    Serious,
    Critical,
}

impl ThermalPressure {
    /// Maps the notify state: 0 nominal, 1 moderate, 2 heavy, 3 trapping, 4 sleeping.
    /// The mapping to Fair/Serious/Critical is inferred (ADR 0010); unknown values are
    /// treated as Critical so an unexpected level is never silently ignored (the caller logs it).
    pub fn from_notify_level(level: u64) -> Self {
        match level {
            0 => Self::Nominal,
            1 => Self::Fair,
            2 => Self::Serious,
            3 | 4 => Self::Critical,
            _ => Self::Critical,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Nominal => "nominal",
            Self::Fair => "fair",
            Self::Serious => "serious",
            Self::Critical => "critical",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_notify_levels() {
        use ThermalPressure::*;
        let got: Vec<_> = (0..=4).map(ThermalPressure::from_notify_level).collect();
        assert_eq!(got, [Nominal, Fair, Serious, Critical, Critical]);
    }

    #[test]
    fn unknown_level_is_critical() {
        assert_eq!(
            ThermalPressure::from_notify_level(7),
            ThermalPressure::Critical
        );
    }

    #[test]
    fn ordering_follows_severity() {
        assert!(ThermalPressure::Fair < ThermalPressure::Serious);
    }
}
