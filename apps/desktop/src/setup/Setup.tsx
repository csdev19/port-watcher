import { useEffect, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { checkFullDiskAccess, finishSetup, openFullDiskAccessSettings } from "@/lib/setup";
import door from "./door.png";
import styles from "./setup.module.css";

type Step = "welcome" | "waiting" | "done" | "skipped";

/** How often the Waiting screen re-checks Full Disk Access. */
export const POLL_INTERVAL_MS = 1000;

export default function Setup() {
  const [step, setStep] = useState<Step>("welcome");

  // Poll only while Waiting is on screen; the cleanup stops it on a step
  // change or when the window's renderer unmounts.
  useEffect(() => {
    if (step !== "waiting") return;
    let cancelled = false;
    const tick = async () => {
      try {
        if (await checkFullDiskAccess()) {
          if (!cancelled) setStep("done");
        }
      } catch {
        // A failed probe is the same as "not granted yet"; keep waiting.
      }
    };
    void tick();
    const id = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [step]);

  const allow = () => {
    void openFullDiskAccessSettings().catch(() => {});
    setStep("waiting");
  };
  const notNow = () => setStep("skipped");
  const open = () => void finishSetup();

  return (
    <main className={styles.window}>
      <div className={styles.drag} data-tauri-drag-region />
      <div className={styles.tile} aria-hidden>
        <img src={door} alt="" className={styles.tileGlyph} />
      </div>
      {step === "welcome" && <Welcome onAllow={allow} onNotNow={notNow} />}
      {step === "waiting" && <Waiting onNotNow={notNow} />}
      {(step === "done" || step === "skipped") && (
        <Finished granted={step === "done"} onOpen={open} />
      )}
    </main>
  );
}

function Footer({ active, children }: { active: 1 | 2; children: ReactNode }) {
  return (
    <footer className={styles.footer}>
      <div className={styles.dots} role="img" aria-label={`Step ${active} of 2`}>
        <span className={active === 1 ? styles.dotOn : styles.dot} />
        <span className={active === 2 ? styles.dotOn : styles.dot} />
      </div>
      <div className={styles.buttons}>{children}</div>
    </footer>
  );
}

const FEATURES: { icon: IconName; text: string }[] = [
  { icon: "list", text: "Every listening port, named by what it is and which project started it." },
  { icon: "x", text: "Kill the one you point at. Only your processes, never the system’s." },
  { icon: "command", text: "Lives in the menu bar. ⌥⌘P opens it from anywhere." },
];

function Welcome({ onAllow, onNotNow }: { onAllow: () => void; onNotNow: () => void }) {
  return (
    <>
      <div className={styles.body}>
        <h1 className={styles.heading}>See what&rsquo;s on your ports.</h1>
        <p className={styles.sub}>
          chapay lists every process listening on your Mac and stops the one you point at. One
          permission makes it much more useful.
        </p>
        <ul className={styles.features}>
          {FEATURES.map((f) => (
            <li key={f.icon} className={styles.feature}>
              <span className={styles.featureIcon}>
                <Icon name={f.icon} size={15} />
              </span>
              <span>{f.text}</span>
            </li>
          ))}
        </ul>
        <section className={styles.card} aria-labelledby="folder-access-title">
          <div className={styles.cardHead}>
            <h2 id="folder-access-title" className={styles.cardTitle}>
              Folder access
            </h2>
            <span className={styles.pill}>Optional</span>
          </div>
          <p className={styles.cardSub}>So each server shows the project that started it.</p>
          <div className={styles.examples}>
            <ExampleRow kind="with" identity="Vite" detail="chapay-web · ~/dev/chapay/apps/web" />
            <ExampleRow kind="without" identity="Vite" detail="~/dev/chapay/apps/web" />
          </div>
          <p className={styles.fine}>
            macOS grants this through <strong>Full Disk Access</strong>. chapay reads the working
            directory of processes on a port and the <code>package.json</code> name above it &mdash;
            never file contents. Nothing leaves your Mac.
          </p>
        </section>
      </div>
      <Footer active={1}>
        <button type="button" className={styles.ghost} onClick={onNotNow}>
          Not now
        </button>
        <button type="button" className={styles.primary} onClick={onAllow}>
          <Icon name="folder" size={14} />
          Allow folder access
        </button>
      </Footer>
    </>
  );
}

function ExampleRow({
  kind,
  identity,
  detail,
}: {
  kind: "with" | "without";
  identity: string;
  detail: string;
}) {
  return (
    <div className={styles.example}>
      <span className={kind === "with" ? styles.withLabel : styles.withoutLabel}>
        {kind === "with" ? "WITH" : "WITHOUT"}
      </span>
      <span className={styles.examplePort}>5173</span>
      <span className={styles.exampleIdentity}>
        <span className={styles.exampleName}>{identity}</span>
        <span className={styles.exampleMeta}>{detail}</span>
      </span>
    </div>
  );
}

const STEPS = [
  "System Settings opened at Privacy & Security › Full Disk Access.",
  "Turn on chapay. macOS may ask for your password.",
  "Come back here. chapay notices on its own — no restart.",
];

function Waiting({ onNotNow }: { onNotNow: () => void }) {
  return (
    <>
      <div className={styles.body}>
        <h1 className={styles.heading}>Turn on chapay in System Settings</h1>
        <p className={styles.sub}>
          Leave this window open. It moves on by itself once access is on.
        </p>
        <section className={styles.card}>
          <ol className={styles.steps}>
            {STEPS.map((text, i) => (
              <li key={text} className={styles.stepItem}>
                <span className={styles.stepNum}>{i + 1}</span>
                <span>{text}</span>
              </li>
            ))}
          </ol>
          <hr className={styles.rule} />
          <p className={styles.status} role="status">
            <span className={styles.dotTeal} />
            Waiting for access
          </p>
        </section>
      </div>
      <Footer active={1}>
        <button type="button" className={styles.ghost} onClick={onNotNow}>
          Not now
        </button>
        <button type="button" className={styles.primary} disabled>
          <span className={styles.spin}>
            <Icon name="loader-circle" size={14} />
          </span>
          Waiting&hellip;
        </button>
      </Footer>
    </>
  );
}

function Finished({ granted, onOpen }: { granted: boolean; onOpen: () => void }) {
  return (
    <>
      <div className={styles.body}>
        <h1 className={styles.heading}>You&rsquo;re set.</h1>
        <p className={styles.sub}>
          Click the door in the menu bar, or press {"⌥⌘"}P from anywhere.
        </p>
        <div className={styles.menubar} aria-hidden>
          <span className={styles.menubarIcon}>
            <Icon name="wifi" size={15} />
          </span>
          <span className={styles.menubarDoor}>
            <img src={door} alt="" className={styles.menubarDoorGlyph} />
            <span className={styles.menubarCount}>3</span>
          </span>
          <span className={styles.menubarClock}>9:41</span>
        </div>
        <p className={styles.menubarNote}>It lives up here, next to the clock.</p>
        <p className={styles.statusLine} role="status">
          <span className={granted ? styles.dotTeal : styles.dotGrey} />
          {granted
            ? "Folder access is on. Every row shows the project that started it."
            : "Project names stay hidden in Documents, Desktop and Downloads. Turn on Full Disk Access later from the menu-bar icon’s menu → Folder access…"}
        </p>
      </div>
      <Footer active={2}>
        <button type="button" className={styles.primary} onClick={onOpen}>
          Open chapay
        </button>
      </Footer>
    </>
  );
}
