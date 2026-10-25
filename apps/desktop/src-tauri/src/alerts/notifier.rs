//! Native notifications through `tauri-plugin-notification` (2.6+ reports a desktop click as the
//! action `tap`). The click handler is registered in `setup`, before the engine starts, because
//! the plugin attaches click tracking only to notifications shown after a handler exists.
//!
//! A click opens the panel (never toggles it closed) and tells the renderer where to land.
//! Not verified without a bundled app: whether a click from Notification Center after the
//! banner timed out still reaches the handler (listed as a manual check in the PR). In
//! `tauri dev` macOS attributes notifications to Terminal.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

use super::engine::Notice;
use super::{FocusTarget, ALERT_FOCUS_EVENT};

/// How many recent notices a click can still be matched to.
const REMEMBERED: usize = 8;

pub struct Notifier {
    next_id: AtomicI32,
    recent: Mutex<VecDeque<(i32, Option<FocusTarget>)>>,
}

impl Notifier {
    fn new() -> Self {
        Self {
            next_id: AtomicI32::new(1),
            recent: Mutex::new(VecDeque::new()),
        }
    }

    fn remember(&self, id: i32, target: Option<FocusTarget>) {
        let mut recent = self.recent.lock().unwrap();
        recent.push_back((id, target));
        while recent.len() > REMEMBERED {
            recent.pop_front();
        }
    }

    /// The target of notification `id`; when the platform did not say which notification was
    /// clicked, the newest one.
    fn target_for(&self, id: Option<i32>) -> Option<FocusTarget> {
        let recent = self.recent.lock().unwrap();
        match id {
            Some(id) => recent
                .iter()
                .find(|(i, _)| *i == id)
                .and_then(|(_, t)| t.clone()),
            None => recent.back().and_then(|(_, t)| t.clone()),
        }
    }
}

/// Registers the click handler. Call from `setup` before the engine starts.
pub fn init(app: &AppHandle) {
    app.manage(Notifier::new());
    let handle = app.clone();
    if let Err(e) = app.notification().on_action(move |performed| {
        if performed.action_id() != "tap" {
            return;
        }
        let id = performed.notification().map(|n| n.id());
        let target = handle.state::<Notifier>().target_for(id);
        crate::panel::show_panel(&handle);
        if let Some(target) = target {
            let _ = handle.emit(ALERT_FOCUS_EVENT, target);
        }
    }) {
        log::warn!("alerts: notification clicks will not open the panel ({e})");
    }
}

pub fn show(app: &AppHandle, notice: Notice) {
    let notifier = app.state::<Notifier>();
    let id = notifier.next_id.fetch_add(1, Ordering::Relaxed);
    notifier.remember(id, notice.target.clone());
    if let Err(e) = app
        .notification()
        .builder()
        .id(id)
        .title(notice.title)
        .body(notice.body)
        .show()
    {
        log::warn!("alerts: could not post a notification ({e})");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_click_finds_its_notice_or_falls_back_to_the_newest() {
        let n = Notifier::new();
        n.remember(1, Some(FocusTarget::Port { port: 5173 }));
        n.remember(
            2,
            Some(FocusTarget::Process {
                pid: 7,
                started_at: 9,
            }),
        );
        assert_eq!(
            n.target_for(Some(1)),
            Some(FocusTarget::Port { port: 5173 })
        );
        assert_eq!(
            n.target_for(None),
            Some(FocusTarget::Process {
                pid: 7,
                started_at: 9
            })
        );
        assert_eq!(n.target_for(Some(99)), None);
    }

    #[test]
    fn only_the_last_few_notices_are_remembered() {
        let n = Notifier::new();
        for i in 0..20 {
            n.remember(i, None);
        }
        assert_eq!(n.recent.lock().unwrap().len(), REMEMBERED);
    }
}
