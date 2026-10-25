//! SMC temperature sensors: key classification and plausibility.

use serde::Serialize;

/// A four-character SMC key such as `Tp01`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct SensorKey(pub [u8; 4]);

impl SensorKey {
    pub fn new(s: &str) -> Option<Self> {
        let b = s.as_bytes();
        (b.len() == 4).then(|| SensorKey([b[0], b[1], b[2], b[3]]))
    }

    pub fn from_u32(v: u32) -> Self {
        SensorKey(v.to_be_bytes())
    }

    pub fn as_u32(self) -> u32 {
        u32::from_be_bytes(self.0)
    }

    pub fn as_string(self) -> String {
        self.0.iter().map(|&b| b as char).collect()
    }
}

impl Serialize for SensorKey {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.as_string())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SensorGroup {
    PerfCore,
    EffCore,
    Gpu,
    Battery,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Validity {
    Usable,
    /// A power-gated performance-core sensor: it reports exactly 40.0 C and is not a reading.
    PowerGated,
    /// Outside the plausible 15..130 C range.
    Implausible,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Reading {
    pub key: SensorKey,
    pub celsius: f32,
}

/// Apple Silicon naming: `Tp*` performance cores, `Te*` efficiency cores, `Tg*` GPU, `TB*` battery.
pub fn classify(key: &SensorKey) -> SensorGroup {
    match (key.0[0], key.0[1]) {
        (b'T', b'p') => SensorGroup::PerfCore,
        (b'T', b'e') => SensorGroup::EffCore,
        (b'T', b'g') => SensorGroup::Gpu,
        (b'T', b'B') => SensorGroup::Battery,
        _ => SensorGroup::Other,
    }
}

pub const PLAUSIBLE_MIN_C: f32 = 15.0;
pub const PLAUSIBLE_MAX_C: f32 = 130.0;
const GATED_C: f32 = 40.0;
const GATED_TOLERANCE: f32 = 0.05;

pub fn validity(key: &SensorKey, celsius: f32) -> Validity {
    if !(celsius > PLAUSIBLE_MIN_C && celsius < PLAUSIBLE_MAX_C) {
        return Validity::Implausible;
    }
    if classify(key) == SensorGroup::PerfCore && (celsius - GATED_C).abs() <= GATED_TOLERANCE {
        return Validity::PowerGated;
    }
    Validity::Usable
}

impl Reading {
    pub fn group(&self) -> SensorGroup {
        classify(&self.key)
    }

    pub fn validity(&self) -> Validity {
        validity(&self.key, self.celsius)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn k(s: &str) -> SensorKey {
        SensorKey::new(s).unwrap()
    }

    #[test]
    fn classifies_by_prefix() {
        assert_eq!(classify(&k("Tp01")), SensorGroup::PerfCore);
        assert_eq!(classify(&k("Te05")), SensorGroup::EffCore);
        assert_eq!(classify(&k("Tg0a")), SensorGroup::Gpu);
        assert_eq!(classify(&k("TB0T")), SensorGroup::Battery);
        assert_eq!(classify(&k("TCHP")), SensorGroup::Other);
        // Case matters: `TP` (package) is not `Tp` (performance core).
        assert_eq!(classify(&k("TP1a")), SensorGroup::Other);
        assert_eq!(classify(&k("F0Ac")), SensorGroup::Other);
    }

    #[test]
    fn power_gated_only_applies_to_performance_cores() {
        assert_eq!(validity(&k("Tp01"), 40.0), Validity::PowerGated);
        assert_eq!(validity(&k("Tp01"), 40.04), Validity::PowerGated);
        assert_eq!(validity(&k("Tp01"), 40.5), Validity::Usable);
        assert_eq!(validity(&k("Te01"), 40.0), Validity::Usable);
    }

    #[test]
    fn implausible_range() {
        assert_eq!(validity(&k("Tp01"), 5.0), Validity::Implausible);
        assert_eq!(validity(&k("Tp01"), 131.0), Validity::Implausible);
        assert_eq!(validity(&k("Te01"), f32::NAN), Validity::Implausible);
    }

    #[test]
    fn key_roundtrip() {
        let key = k("Tp0D");
        assert_eq!(SensorKey::from_u32(key.as_u32()), key);
        assert_eq!(key.as_string(), "Tp0D");
        assert!(SensorKey::new("abc").is_none());
    }
}
