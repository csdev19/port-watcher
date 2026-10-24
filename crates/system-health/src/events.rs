//! Event-driven subscriptions for the two default alert signals. Nothing here polls or arms a
//! timer: the thermal subscription is one thread blocked in `poll(2)` on a notify file
//! descriptor, and the memory subscription is a libdispatch source that parks in the kernel.
//!
//! Dropping a [`Subscription`] cancels it, and no callback runs after `drop` returns. Do not drop
//! a subscription from inside its own callback (the drop waits for the callback to finish).

use crate::domain::{MemoryPressure, ThermalPressure};
use crate::infra::ffi;
use crate::infra::thermal::{self, THERMAL_NOTIFY_NAME};
use std::ffi::{CString, c_void};
use std::io;
use std::sync::atomic::{AtomicPtr, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

/// A live subscription. Dropping it cancels the subscription.
pub struct Subscription {
    cancel: Mutex<Option<Box<dyn FnOnce() + Send>>>,
}

impl Subscription {
    fn new(cancel: impl FnOnce() + Send + 'static) -> Self {
        Self {
            cancel: Mutex::new(Some(Box::new(cancel))),
        }
    }
}

impl Drop for Subscription {
    fn drop(&mut self) {
        if let Some(cancel) = self.cancel.get_mut().ok().and_then(Option::take) {
            cancel();
        }
    }
}

/// The current thermal pressure and its raw notify level, read once.
pub fn current_thermal() -> Option<(ThermalPressure, u8)> {
    thermal::read_level().map(|raw| (ThermalPressure::from_notify_level(raw as u64), raw))
}

/// The current memory pressure, read once.
pub fn current_memory() -> Option<MemoryPressure> {
    crate::infra::memory::pressure()
}

/// Calls `on_change` whenever the thermal pressure level changes. Not called at subscribe time:
/// read [`current_thermal`] first.
pub fn subscribe_thermal<F>(mut on_change: F) -> io::Result<Subscription>
where
    F: FnMut(ThermalPressure, u8) + Send + 'static,
{
    let mut last = thermal::read_level();
    subscribe_notify(THERMAL_NOTIFY_NAME, move |state| {
        let raw = state.min(u8::MAX as u64) as u8;
        if last != Some(raw) {
            last = Some(raw);
            on_change(ThermalPressure::from_notify_level(raw as u64), raw);
        }
    })
}

/// Token written to a notify file descriptor: 4 bytes in network byte order.
pub(crate) fn token_from_wire(bytes: [u8; 4]) -> i32 {
    i32::from_be_bytes(bytes)
}

/// Subscribes to a notify(3) name through a file descriptor. `on_event` gets the name's state on
/// every post. One thread blocks in `poll` on the descriptor and a shutdown pipe.
pub(crate) fn subscribe_notify<F>(name: &str, mut on_event: F) -> io::Result<Subscription>
where
    F: FnMut(u64) + Send + 'static,
{
    let cname = CString::new(name)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "name contains NUL"))?;
    let (mut fd, mut token) = (-1i32, 0i32);
    let status =
        unsafe { ffi::notify_register_file_descriptor(cname.as_ptr(), &mut fd, 0, &mut token) };
    if status != 0 {
        return Err(io::Error::other(format!(
            "notify_register_file_descriptor failed: status {status}"
        )));
    }
    let mut pipe = [0i32; 2];
    if unsafe { libc::pipe(pipe.as_mut_ptr()) } != 0 {
        let err = io::Error::last_os_error();
        unsafe { ffi::notify_cancel(token) };
        return Err(err);
    }
    let (pipe_r, pipe_w) = (pipe[0], pipe[1]);

    let handle: JoinHandle<()> = std::thread::Builder::new()
        .name("chapay-notify".into())
        .spawn(move || {
            loop {
                let mut fds = [
                    libc::pollfd {
                        fd,
                        events: libc::POLLIN,
                        revents: 0,
                    },
                    libc::pollfd {
                        fd: pipe_r,
                        events: libc::POLLIN,
                        revents: 0,
                    },
                ];
                let rc = unsafe { libc::poll(fds.as_mut_ptr(), 2, -1) };
                if rc < 0 {
                    if io::Error::last_os_error().kind() == io::ErrorKind::Interrupted {
                        continue;
                    }
                    break;
                }
                if fds[1].revents != 0 {
                    break;
                }
                if fds[0].revents & libc::POLLIN != 0 {
                    let mut buf = [0u8; 4];
                    let n = unsafe { libc::read(fd, buf.as_mut_ptr() as *mut c_void, 4) };
                    if n != 4 {
                        break;
                    }
                    let delivered = token_from_wire(buf);
                    let mut state = 0u64;
                    if unsafe { ffi::notify_get_state(delivered, &mut state) } == 0 {
                        on_event(state);
                    }
                } else if fds[0].revents != 0 {
                    break; // error or hangup on the notify descriptor
                }
            }
        })?;

    Ok(Subscription::new(move || {
        let byte = 1u8;
        unsafe { libc::write(pipe_w, &byte as *const u8 as *const c_void, 1) };
        let _ = handle.join();
        // notify_cancel also closes the notify file descriptor.
        unsafe {
            ffi::notify_cancel(token);
            libc::close(pipe_r);
            libc::close(pipe_w);
        }
    }))
}

struct MemoryContext<F> {
    on_change: F,
    source: AtomicPtr<ffi::DispatchObject>,
    done: Arc<(Mutex<bool>, Condvar)>,
}

extern "C" fn memory_event<F: Fn(MemoryPressure) + Send + Sync + 'static>(ctx: *mut c_void) {
    // The context stays alive until the cancel handler runs, which is after the last event.
    let ctx = unsafe { &*(ctx as *const MemoryContext<F>) };
    let source = ctx.source.load(Ordering::Acquire);
    let flags = unsafe { ffi::dispatch_source_get_data(source) } as u64;
    (ctx.on_change)(MemoryPressure::from_dispatch_flags(flags));
}

extern "C" fn memory_cancel<F: Fn(MemoryPressure) + Send + Sync + 'static>(ctx: *mut c_void) {
    let ctx = unsafe { Box::from_raw(ctx as *mut MemoryContext<F>) };
    let done = ctx.done.clone();
    drop(ctx);
    let (lock, cv) = &*done;
    *lock.lock().unwrap() = true;
    cv.notify_all();
}

/// Calls `on_change` on every memory pressure transition, from a libdispatch utility queue.
/// Not called at subscribe time: read [`current_memory`] first.
pub fn subscribe_memory<F>(on_change: F) -> io::Result<Subscription>
where
    F: Fn(MemoryPressure) + Send + Sync + 'static,
{
    const MASK: usize = 0x1 | 0x2 | 0x4;
    const QOS_CLASS_UTILITY: isize = 0x11;
    let done = Arc::new((Mutex::new(false), Condvar::new()));
    let ctx = Box::into_raw(Box::new(MemoryContext {
        on_change,
        source: AtomicPtr::new(std::ptr::null_mut()),
        done: done.clone(),
    }));
    unsafe {
        let queue = ffi::dispatch_get_global_queue(QOS_CLASS_UTILITY, 0);
        let source =
            ffi::dispatch_source_create(&ffi::_dispatch_source_type_memorypressure, 0, MASK, queue);
        if source.is_null() {
            drop(Box::from_raw(ctx));
            return Err(io::Error::other(
                "dispatch_source_create failed for memory pressure",
            ));
        }
        (*ctx).source.store(source, Ordering::Release);
        ffi::dispatch_set_context(source, ctx as *mut c_void);
        ffi::dispatch_source_set_event_handler_f(source, memory_event::<F>);
        ffi::dispatch_source_set_cancel_handler_f(source, memory_cancel::<F>);
        ffi::dispatch_resume(source);

        let source_addr = source as usize;
        Ok(Subscription::new(move || {
            let source = source_addr as ffi::DispatchSource;
            ffi::dispatch_source_cancel(source);
            let (lock, cv) = &*done;
            let guard = lock.lock().unwrap();
            // The cancel handler runs after any in-flight event handler. If it does not run in
            // 5 s it still frees the context later; we only stop waiting.
            let _ = cv.wait_timeout_while(guard, Duration::from_secs(5), |d| !*d);
            ffi::dispatch_release(source);
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    use std::sync::mpsc;
    use std::time::Instant;

    fn hw() -> bool {
        std::env::var("CHAPAY_HW_TESTS").is_ok()
    }

    #[test]
    fn token_is_read_in_network_byte_order() {
        assert_eq!(token_from_wire([0, 0, 0, 3]), 3);
        assert_eq!(token_from_wire([0, 0, 1, 0]), 256);
    }

    #[test]
    fn thermal_subscription_drops_quickly_without_hanging() {
        if !hw() {
            return;
        }
        let sub = subscribe_thermal(|_, _| {}).expect("thermal subscription");
        let start = Instant::now();
        drop(sub);
        assert!(
            start.elapsed() < Duration::from_millis(100),
            "drop took {:?}",
            start.elapsed()
        );
    }

    #[test]
    fn notify_post_fires_the_callback_once_and_never_after_drop() {
        if !hw() {
            return;
        }
        let name = "dev.csdev19.chapay.test";
        let cname = CString::new(name).unwrap();
        let count = Arc::new(AtomicUsize::new(0));
        let (tx, rx) = mpsc::channel();
        let c = count.clone();
        let sub = subscribe_notify(name, move |_| {
            c.fetch_add(1, Ordering::SeqCst);
            let _ = tx.send(());
        })
        .unwrap();

        unsafe { ffi::notify_post(cname.as_ptr()) };
        rx.recv_timeout(Duration::from_secs(2))
            .expect("callback should fire after notify_post");
        std::thread::sleep(Duration::from_millis(200));
        assert_eq!(count.load(Ordering::SeqCst), 1);

        drop(sub);
        unsafe { ffi::notify_post(cname.as_ptr()) };
        std::thread::sleep(Duration::from_millis(200));
        assert_eq!(count.load(Ordering::SeqCst), 1, "no callback after drop");
    }

    #[test]
    fn memory_subscription_creates_and_drops_cleanly() {
        if !hw() {
            return;
        }
        for _ in 0..20 {
            let sub = subscribe_memory(|_| {}).expect("memory subscription");
            drop(sub);
        }
        assert!(current_memory().is_some());
    }

    #[test]
    fn current_thermal_is_readable() {
        if !hw() {
            return;
        }
        let (_, raw) = current_thermal().expect("thermal level");
        assert!(raw <= 4);
    }
}
