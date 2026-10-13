import { useEffect, useState, type ReactNode } from "react";
import { Download, FileText, Github, RefreshCw, RotateCw } from "lucide-react";
import door from "@/setup/door.png";
import { loadAppInfo, openExternal, releaseNotesUrl, REPO_URL, type AppInfo } from "@/lib/about";
import { installFailureText, progressText, useUpdate, type UpdateStatus } from "@/lib/update";
import { Button } from "../ui";
import styles from "./about.module.css";

export default function About() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [update, actions] = useUpdate();

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
  const meta = info ? [version ? `v${version}` : null, info.commit, info.arch] : [];

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
        <PrimaryUpdateButton status={update} actions={actions} />
        <Button icon={Github} onClick={() => void openExternal(REPO_URL)}>
          Source
        </Button>
        <Button icon={FileText} onClick={() => void openExternal(releaseNotesUrl(version))}>
          Release notes
        </Button>
      </div>

      <div className={styles.result} role="status">
        <UpdateLine status={update} />
      </div>

      <div className={styles.footer}>A Niway product · built by csdev · GPL-3.0</div>
    </div>
  );
}

/** The fuchsia button is the update state machine (spec §3.8). */
function PrimaryUpdateButton({
  status,
  actions,
}: {
  status: UpdateStatus;
  actions: ReturnType<typeof useUpdate>[1];
}) {
  const check = (
    <Button
      variant="primary"
      icon={RefreshCw}
      disabled={status.state === "disabled"}
      onClick={() => void actions.check()}
    >
      Check for updates
    </Button>
  );
  switch (status.state) {
    case "checking":
      return (
        <Button variant="primary" icon={RefreshCw} iconClassName={styles.spin} disabled>
          Checking…
        </Button>
      );
    case "available":
      return (
        <Button variant="primary" icon={Download} onClick={() => void actions.install()}>
          Update to {status.version}
        </Button>
      );
    case "downloading":
      return (
        <Button variant="primary" icon={RefreshCw} iconClassName={styles.spin} disabled>
          Updating…
        </Button>
      );
    case "ready":
      return (
        <Button variant="primary" icon={RotateCw} onClick={() => void actions.restart()}>
          Restart chapay
        </Button>
      );
    case "cannotInstallHere":
      return (
        <Button
          variant="primary"
          icon={Download}
          onClick={() => void openExternal(releaseNotesUrl(status.version))}
        >
          Download
        </Button>
      );
    case "installFailed":
      return (
        <Button variant="primary" icon={RefreshCw} onClick={() => void actions.install()}>
          Try again
        </Button>
      );
    default:
      return check;
  }
}

function UpdateLine({ status }: { status: UpdateStatus }): ReactNode {
  switch (status.state) {
    case "disabled":
      return <span>Updates are off in this build.</span>;
    case "upToDate":
      return <span>You're on the latest version.</span>;
    case "checkFailed":
      return <span>Couldn't check for updates.</span>;
    case "available":
      return <span>chapay {status.version} is available.</span>;
    case "downloading":
      return <span>Downloading {progressText(status.downloaded, status.total)}</span>;
    case "ready":
      return <span>{status.version} is installed. Restart chapay to finish.</span>;
    case "cannotInstallHere":
      return <span>Move chapay to Applications to update in place.</span>;
    case "installFailed":
      return (
        <>
          <span>{installFailureText(status.reason)}</span>
          <Button
            icon={Download}
            onClick={() => void openExternal(releaseNotesUrl(status.version))}
          >
            Download instead
          </Button>
        </>
      );
    default:
      return null;
  }
}
