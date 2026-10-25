import { useEffect, useState } from "react";
import { getAutostart, registerShortcut, setAutostart } from "../native";
import { recordKey, shortcutKeys, shortcutText, validateShortcut } from "../shortcut";
import { useSetting } from "../store";
import { AlertRuleRow } from "../AlertRuleRow";
import styles from "../settings.module.css";
import {
  Button,
  Group,
  Keys,
  Row,
  RowNote,
  SectionHeading,
  Segmented,
  Select,
  Switch,
} from "../ui";

const REFRESH_OPTIONS = [
  { value: 1000, label: "Every 1s" },
  { value: 2000, label: "Every 2s" },
  { value: 5000, label: "Every 5s" },
  { value: 10000, label: "Every 10s" },
] as const;

export default function General() {
  return (
    <>
      <SectionHeading>Opening</SectionHeading>
      <Group>
        <ShortcutRow />
        <LaunchAtLoginRow />
      </Group>
      <SectionHeading>Panel</SectionHeading>
      <Group>
        <AppearanceRow />
        <RefreshRow />
      </Group>
      <SectionHeading>Alerts</SectionHeading>
      <Group>
        <AlertRuleRow
          rule="thermalPressure"
          label="Thermal pressure"
          reason="macOS is slowing the chip down. Waits 30 s, then alerts. Costs nothing: macOS tells chapay."
        />
        <AlertRuleRow
          rule="hotspot"
          label="CPU hotspot over 95 °C"
          reason="A minute at 95 °C or more, even if macOS says nominal. Reads the sensors every 30 s while the panel is closed."
        />
        <AlertRuleRow
          rule="memoryPressure"
          label="Memory pressure"
          reason="macOS is short on memory. Waits 1 min, then alerts. Costs nothing: macOS tells chapay."
        />
        <AlertRuleRow
          rule="cpuSustained"
          label="CPU over 80% for 2 min"
          reason="Checks the load every 30 s while this is on."
        />
        <AlertRuleRow
          rule="gpuSustained"
          label="GPU over 90% for 2 min"
          reason="Checks the load every 30 s while this is on."
        />
      </Group>
      <div className={styles.note}>
        <p className={styles.noteText}>
          Alerts appear in the Machine tab and as a notification, at most once per 15 minutes per
          alert. Nothing is posted while the panel is open.
        </p>
      </div>
      <SectionHeading>Updates</SectionHeading>
      <Group>
        <AutoCheckUpdatesRow />
      </Group>
    </>
  );
}

/** Only the check is automatic; installing always takes a click. */
function AutoCheckUpdatesRow() {
  const [autoCheck, setAutoCheck] = useSetting("autoCheckUpdates");
  return (
    <Row
      label="Check for updates automatically"
      reason="Once when chapay opens, then daily. Nothing else is sent."
      control={
        <Switch
          label="Check for updates automatically"
          checked={autoCheck}
          onChange={setAutoCheck}
        />
      }
    />
  );
}

function ShortcutRow() {
  const [shortcut, setShortcut] = useSetting("shortcut");
  const [recording, setRecording] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // While recording, no key may reach the page (Tab, Space, ⌘,...).
      event.preventDefault();
      event.stopPropagation();
      const step = recordKey(event);
      if (step.kind === "ignore") return;
      if (step.kind === "cancel") {
        setRecording(false);
        setNote(null);
        return;
      }
      const refusal = validateShortcut(step.shortcut, step.bare);
      if (refusal) {
        setNote(refusal);
        return;
      }
      setRecording(false);
      setNote(null);
      // Rust first: the setting is saved only once the new shortcut is live,
      // so a refused one leaves both the old registration and the old value.
      registerShortcut(step.shortcut).then(
        () => setShortcut(step.shortcut),
        () => setNote(`Another app already uses ${shortcutText(step.shortcut)}.`),
      );
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, setShortcut]);

  const stopRecording = () => {
    setRecording(false);
    setNote(null);
  };

  return (
    <>
      <Row
        label="Open chapay"
        reason="Global shortcut, works from any app."
        control={
          <>
            {recording ? (
              <span className={styles.recording}>Press a shortcut…</span>
            ) : (
              <Keys keys={shortcutKeys(shortcut)} />
            )}
            {recording ? (
              <Button variant="plain" onClick={stopRecording}>
                Cancel
              </Button>
            ) : (
              <Button
                variant="state"
                onClick={() => {
                  setNote(null);
                  setRecording(true);
                }}
              >
                Change
              </Button>
            )}
          </>
        }
      />
      {note ? <RowNote>{note}</RowNote> : null}
    </>
  );
}

function LaunchAtLoginRow() {
  // null until the OS has answered.
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getAutostart().then(
      (on) => alive && setEnabled(on),
      () => alive && setEnabled(false),
    );
    return () => {
      alive = false;
    };
  }, []);

  const toggle = (next: boolean) => {
    setEnabled(next);
    setNote(null);
    setAutostart(next).catch(() => {
      setEnabled(!next);
      setNote(`Couldn't turn launch at login ${next ? "on" : "off"}. Try again.`);
    });
  };

  return (
    <>
      <Row
        label="Launch at login"
        reason="Starts quietly in the menu bar. No window."
        control={
          <Switch
            label="Launch at login"
            checked={enabled === true}
            disabled={enabled === null}
            onChange={toggle}
          />
        }
      />
      {note ? <RowNote>{note}</RowNote> : null}
    </>
  );
}

const APPEARANCE_OPTIONS = [
  { value: "system", label: "System" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
] as const;

function AppearanceRow() {
  const [appearance, setAppearance] = useSetting("appearance");
  return (
    <Row
      label="Appearance"
      reason="System follows your Mac's light or dark mode."
      control={
        <Segmented
          label="Appearance"
          value={appearance}
          options={APPEARANCE_OPTIONS}
          onChange={setAppearance}
        />
      }
    />
  );
}

function RefreshRow() {
  const [interval, setInterval] = useSetting("refreshIntervalMs");
  return (
    <Row
      label="Refresh while open"
      reason="Closed, chapay doesn't poll at all."
      control={
        <Select
          label="Refresh while open"
          value={interval}
          options={REFRESH_OPTIONS}
          onChange={setInterval}
        />
      }
    />
  );
}
