//! Raw declarations for the system libraries the adapters call.

// Some declarations are only used by `events` and `procs`.
#![allow(dead_code)]

use std::ffi::{c_char, c_void};

pub type CFTypeRef = *const c_void;
pub type MachPort = u32;

#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    pub fn IOServiceMatching(name: *const c_char) -> CFTypeRef;
    pub fn IOServiceGetMatchingService(main_port: MachPort, matching: CFTypeRef) -> MachPort;
    pub fn IOServiceGetMatchingServices(
        main_port: MachPort,
        matching: CFTypeRef,
        it: *mut MachPort,
    ) -> i32;
    pub fn IOIteratorNext(it: MachPort) -> MachPort;
    pub fn IOServiceOpen(service: MachPort, task: MachPort, kind: u32, conn: *mut MachPort) -> i32;
    pub fn IOServiceClose(conn: MachPort) -> i32;
    pub fn IOObjectRelease(obj: MachPort) -> i32;
    pub fn IOConnectCallStructMethod(
        conn: MachPort,
        selector: u32,
        input: *const c_void,
        input_size: usize,
        output: *mut c_void,
        output_size: *mut usize,
    ) -> i32;
    pub fn IORegistryEntryCreateCFProperty(
        entry: MachPort,
        key: CFTypeRef,
        alloc: CFTypeRef,
        opts: u32,
    ) -> CFTypeRef;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    pub fn CFStringCreateWithCString(
        alloc: CFTypeRef,
        s: *const c_char,
        encoding: u32,
    ) -> CFTypeRef;
    pub fn CFDictionaryGetValue(dict: CFTypeRef, key: CFTypeRef) -> CFTypeRef;
    pub fn CFNumberGetValue(num: CFTypeRef, kind: i32, out: *mut c_void) -> bool;
    pub fn CFRelease(obj: CFTypeRef);
}

pub const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
pub const K_CF_NUMBER_SINT64: i32 = 4;

#[repr(C)]
pub struct MachTimebaseInfo {
    pub numer: u32,
    pub denom: u32,
}

unsafe extern "C" {
    pub static mach_task_self_: MachPort;
    pub fn mach_host_self() -> MachPort;
    pub fn mach_timebase_info(info: *mut MachTimebaseInfo) -> i32;
    pub fn host_statistics64(host: MachPort, flavor: i32, info: *mut i32, count: *mut u32) -> i32;
    pub fn host_processor_info(
        host: MachPort,
        flavor: i32,
        cpu_count: *mut u32,
        info: *mut *mut i32,
        info_count: *mut u32,
    ) -> i32;
    pub fn vm_deallocate(task: MachPort, address: usize, size: usize) -> i32;

    pub fn notify_register_check(name: *const c_char, token: *mut i32) -> u32;
    pub fn notify_register_file_descriptor(
        name: *const c_char,
        fd: *mut i32,
        flags: i32,
        token: *mut i32,
    ) -> u32;
    pub fn notify_get_state(token: i32, state: *mut u64) -> u32;
    pub fn notify_cancel(token: i32) -> u32;
    #[allow(dead_code)]
    pub fn notify_post(name: *const c_char) -> u32;

    pub fn proc_listallpids(buffer: *mut c_void, buffersize: i32) -> i32;
    pub fn proc_name(pid: i32, buffer: *mut c_void, buffersize: u32) -> i32;
    pub fn proc_pid_rusage(pid: i32, flavor: i32, buffer: *mut c_void) -> i32;
}

/// Opaque libdispatch types.
#[repr(C)]
pub struct DispatchObject {
    _private: [u8; 0],
}
pub type DispatchSource = *mut DispatchObject;
pub type DispatchQueue = *mut DispatchObject;

#[repr(C)]
pub struct DispatchSourceType {
    _private: [u8; 0],
}

unsafe extern "C" {
    pub static _dispatch_source_type_memorypressure: DispatchSourceType;
    pub fn dispatch_source_create(
        kind: *const DispatchSourceType,
        handle: usize,
        mask: usize,
        queue: DispatchQueue,
    ) -> DispatchSource;
    pub fn dispatch_get_global_queue(identifier: isize, flags: usize) -> DispatchQueue;
    pub fn dispatch_set_context(object: *mut DispatchObject, context: *mut c_void);
    pub fn dispatch_source_set_event_handler_f(
        source: DispatchSource,
        handler: extern "C" fn(*mut c_void),
    );
    pub fn dispatch_source_set_cancel_handler_f(
        source: DispatchSource,
        handler: extern "C" fn(*mut c_void),
    );
    pub fn dispatch_source_get_data(source: DispatchSource) -> usize;
    pub fn dispatch_source_cancel(source: DispatchSource);
    pub fn dispatch_resume(object: *mut DispatchObject);
    pub fn dispatch_release(object: *mut DispatchObject);
}
