//! SMC (AppleSMC IOKit user client): temperatures, fan speed and system power, without sudo.
//!
//! `discover()` walks the key list once and caches `(key, KeyInfo, group)`, so each sample is
//! one `read_bytes` call per key instead of a full enumeration.

use super::ffi::*;
use crate::domain::sensor::{self, Reading, SensorGroup, SensorKey};
use std::ffi::{CString, c_void};

#[repr(C)]
#[derive(Default, Clone, Copy)]
struct SmcVers {
    major: u8,
    minor: u8,
    build: u8,
    reserved: u8,
    release: u16,
}

#[repr(C)]
#[derive(Default, Clone, Copy)]
struct SmcPLimit {
    version: u16,
    length: u16,
    cpu_p_limit: u32,
    gpu_p_limit: u32,
    mem_p_limit: u32,
}

#[repr(C)]
#[derive(Default, Clone, Copy)]
struct SmcKeyInfo {
    data_size: u32,
    data_type: u32,
    data_attributes: u8,
}

#[repr(C)]
#[derive(Default, Clone, Copy)]
struct SmcKeyData {
    key: u32,
    vers: SmcVers,
    p_limit: SmcPLimit,
    key_info: SmcKeyInfo,
    result: u8,
    status: u8,
    data8: u8,
    data32: u32,
    bytes: [u8; 32],
}

const SMC_CMD_READ_BYTES: u8 = 5;
const SMC_CMD_READ_INDEX: u8 = 8;
const SMC_CMD_READ_KEYINFO: u8 = 9;

#[derive(Clone, Copy)]
struct CachedKey {
    key: SensorKey,
    info: SmcKeyInfo,
    group: SensorGroup,
}

pub struct Smc {
    conn: MachPort,
    sensors: Vec<CachedKey>,
    fan_actual: Option<CachedKey>,
    fan_max: Option<CachedKey>,
    system_power: Option<CachedKey>,
}

impl Smc {
    /// Opens the user client and discovers the keys. `None` when the SMC is not reachable
    /// (for example inside a VM).
    pub fn open() -> Option<Smc> {
        let name = CString::new("AppleSMC").unwrap();
        let conn = unsafe {
            let service = IOServiceGetMatchingService(0, IOServiceMatching(name.as_ptr()));
            if service == 0 {
                return None;
            }
            let mut conn = 0;
            let rc = IOServiceOpen(service, mach_task_self_, 0, &mut conn);
            IOObjectRelease(service);
            if rc != 0 {
                return None;
            }
            conn
        };
        let mut smc = Smc {
            conn,
            sensors: Vec::new(),
            fan_actual: None,
            fan_max: None,
            system_power: None,
        };
        smc.discover();
        Some(smc)
    }

    fn call(&self, input: &SmcKeyData) -> Option<SmcKeyData> {
        let mut output = SmcKeyData::default();
        let mut out_size = std::mem::size_of::<SmcKeyData>();
        let rc = unsafe {
            IOConnectCallStructMethod(
                self.conn,
                2,
                input as *const _ as *const c_void,
                std::mem::size_of::<SmcKeyData>(),
                &mut output as *mut _ as *mut c_void,
                &mut out_size,
            )
        };
        (rc == 0 && output.result == 0).then_some(output)
    }

    fn key_info(&self, key: u32) -> Option<SmcKeyInfo> {
        let input = SmcKeyData {
            key,
            data8: SMC_CMD_READ_KEYINFO,
            ..Default::default()
        };
        self.call(&input).map(|o| o.key_info)
    }

    fn read_bytes(&self, key: u32, info: SmcKeyInfo) -> Option<[u8; 32]> {
        let input = SmcKeyData {
            key,
            key_info: info,
            data8: SMC_CMD_READ_BYTES,
            ..Default::default()
        };
        self.call(&input).map(|o| o.bytes)
    }

    fn read_value(&self, c: &CachedKey) -> Option<f32> {
        let b = self.read_bytes(c.key.as_u32(), c.info)?;
        decode(c.info.data_type, c.info.data_size, &b)
    }

    fn cache_key(&self, key: SensorKey) -> Option<CachedKey> {
        let info = self.key_info(key.as_u32())?;
        Some(CachedKey {
            key,
            info,
            group: sensor::classify(&key),
        })
    }

    fn key_at(&self, index: u32) -> Option<u32> {
        let input = SmcKeyData {
            data8: SMC_CMD_READ_INDEX,
            data32: index,
            ..Default::default()
        };
        self.call(&input).map(|o| o.key)
    }

    fn discover(&mut self) {
        let count_key = SensorKey::new("#KEY").unwrap();
        let count = self
            .cache_key(count_key)
            .and_then(|c| self.read_value(&c))
            .unwrap_or(0.0) as u32;
        let mut sensors = Vec::new();
        for i in 0..count {
            let Some(raw) = self.key_at(i) else { continue };
            let key = SensorKey::from_u32(raw);
            if key.0[0] != b'T' {
                continue;
            }
            if let Some(c) = self.cache_key(key) {
                // Only float temperatures: other encodings are not temperatures on Apple Silicon.
                if c.info.data_type == u32::from_be_bytes(*b"flt ") && c.info.data_size == 4 {
                    sensors.push(c);
                }
            }
        }
        self.sensors = sensors;
        self.fan_actual = SensorKey::new("F0Ac").and_then(|k| self.cache_key(k));
        self.fan_max = SensorKey::new("F0Mx").and_then(|k| self.cache_key(k));
        self.system_power = SensorKey::new("PSTR").and_then(|k| self.cache_key(k));
    }

    /// Number of cached temperature keys in the given groups.
    pub fn sensor_count(&self, groups: &[SensorGroup]) -> usize {
        self.sensors
            .iter()
            .filter(|c| groups.contains(&c.group))
            .count()
    }

    /// Reads only the cached sensors of the given groups. Validity is left to the domain.
    pub fn read_cached(&self, groups: &[SensorGroup]) -> Vec<Reading> {
        self.sensors
            .iter()
            .filter(|c| groups.contains(&c.group))
            .filter_map(|c| {
                Some(Reading {
                    key: c.key,
                    celsius: self.read_value(c)?,
                })
            })
            .collect()
    }

    /// Every cached temperature sensor, whatever its group or validity.
    pub fn read_all(&self) -> Vec<Reading> {
        self.read_cached(&[
            SensorGroup::PerfCore,
            SensorGroup::EffCore,
            SensorGroup::Gpu,
            SensorGroup::Battery,
            SensorGroup::Other,
        ])
    }

    pub fn fan_actual_rpm(&self) -> Option<f32> {
        self.fan_actual.as_ref().and_then(|c| self.read_value(c))
    }

    pub fn fan_max_rpm(&self) -> Option<f32> {
        self.fan_max.as_ref().and_then(|c| self.read_value(c))
    }

    pub fn system_watts(&self) -> Option<f32> {
        self.system_power.as_ref().and_then(|c| self.read_value(c))
    }
}

impl Drop for Smc {
    fn drop(&mut self) {
        unsafe { IOServiceClose(self.conn) };
    }
}

fn decode(data_type: u32, size: u32, b: &[u8; 32]) -> Option<f32> {
    match (&data_type.to_be_bytes(), size) {
        (b"flt ", 4) => Some(f32::from_le_bytes([b[0], b[1], b[2], b[3]])),
        (b"ui8 ", 1) => Some(b[0] as f32),
        (b"ui16", 2) => Some(u16::from_be_bytes([b[0], b[1]]) as f32),
        (b"ui32", 4) => Some(u32::from_be_bytes([b[0], b[1], b[2], b[3]]) as f32),
        (b"sp78", 2) => Some(i16::from_be_bytes([b[0], b[1]]) as f32 / 256.0),
        (b"fpe2", 2) => Some(u16::from_be_bytes([b[0], b[1]]) as f32 / 4.0),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(s: &[u8; 4]) -> u32 {
        u32::from_be_bytes(*s)
    }

    #[test]
    fn decodes_known_types() {
        let mut b = [0u8; 32];
        b[..4].copy_from_slice(&42.5f32.to_le_bytes());
        assert_eq!(decode(t(b"flt "), 4, &b), Some(42.5));
        let mut b = [0u8; 32];
        b[0] = 0x2a;
        b[1] = 0x80;
        assert_eq!(decode(t(b"sp78"), 2, &b), Some(42.5));
        assert_eq!(decode(t(b"ui8 "), 1, &b), Some(42.0));
        assert_eq!(decode(t(b"????"), 4, &b), None);
    }
}
