import { useEffect, useState } from "react";
import { Download, FileText, Github, RefreshCw } from "lucide-react";
import door from "@/setup/door.png";
import {
  checkForUpdate,
  loadAppInfo,
  openExternal,
  releaseNotesUrl,
  REPO_URL,
  type AppInfo,
  type UpdateCheck,
} from "@/lib/about";
import { Button } from "../ui";
import styles from "./about.module.css";

type CheckState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "done"; result: UpdateCheck }
  | { kind: "error" };

export default function About() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [check, setCheck] = useState<CheckState>({ kind: "idle" });

  useEffect(() => {
    let live = true;
    void loadAppInfo().then((i) => {
      if (live) setInfo(i);
    });
    return () => {
      live = false;
    };
  }, []);

  const version = info?.version ?? null;

  async function onCheck() {
    if (!version) {
      setCheck({ kind: "error" });
      return;
    }
    setCheck({ kind: "checking" });
    try {
      setCheck({ kind: "done", result: await checkForUpdate(version) });
    } catch {
      setCheck({ kind: "error" });
    }
  }

  const meta = info ? [version ? `v${version}` : null, info.commit, info.arch] : [];
  const checking = check.kind === "checking";

  return (
    <div className={styles.about}>
      <div className={styles.tile}>
        <img src={door} alt="" className={styles.glyph} />
      </div>
      <h2 className={styles.wordmark}>
        chapay<span className={styles.dot}>.</span>
      </h2>
      <div className={styles.meta}>{meta.filter(Boolean).join(" · ")}</div>
      <p className={styles.copy}>
        Quechua for <em>“to watch, to guard”</em>. It watches your ports, and stops the one you
        point at.
      </p>

      <div className={styles.buttons}>
        <Button
          variant="primary"
          icon={RefreshCw}
          iconClassName={checking ? styles.spin : undefined}
          disabled={checking}
          onClick={onCheck}
        >
          {checking ? "Checking…" : "Check for updates"}
        </Button>
        <Button icon={Github} onClick={() => void openExternal(REPO_URL)}>
          Source
        </Button>
        <Button icon={FileText} onClick={() => void openExternal(releaseNotesUrl(version))}>
          Release notes
        </Button>
      </div>

      <div className={styles.result} role="status">
        {check.kind === "done" && check.result.status === "latest" ? (
          <span>You're on the latest version.</span>
        ) : null}
        {check.kind === "done" && check.result.status === "available" ? (
          <AvailableUpdate result={check.result} />
        ) : null}
        {check.kind === "error" ? <span>Couldn't check for updates.</span> : null}
      </div>

      <div className={styles.footer}>A Niway product · built by csdev · GPL-3.0</div>
    </div>
  );
}

function AvailableUpdate({ result }: { result: Extract<UpdateCheck, { status: "available" }> }) {
  return (
    <>
      <span>chapay {result.version} is available.</span>
      <Button icon={Download} onClick={() => void openExternal(result.url)}>
        Download
      </Button>
    </>
  );
}
