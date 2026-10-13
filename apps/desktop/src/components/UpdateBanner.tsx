import {
  installFailureText,
  progressPercent,
  type UpdateActions,
  type UpdateStatus,
} from "@/lib/update";
import { Icon } from "@/components/Icon";
import styles from "@/app.module.css";

interface Props {
  status: UpdateStatus;
  actions: UpdateActions;
  /** The version the user dismissed; its "available" offer stays hidden. */
  dismissedVersion: string;
  onDismiss: (version: string) => void;
}

/**
 * A slim bar at the top of the panel when a newer chapay exists. Never a
 * dialog, never an install without a click, never a forced restart: Update
 * downloads and installs, then "Restart to update" relaunches.
 */
export function UpdateBanner({ status, actions, dismissedVersion, onDismiss }: Props) {
  switch (status.state) {
    case "available":
      if (status.version === dismissedVersion) return null;
      return (
        <Bar
          text={`chapay ${status.version} is available`}
          action={{ label: "Update", onClick: actions.install }}
          onDismiss={() => onDismiss(status.version)}
        />
      );
    case "downloading": {
      const percent = progressPercent(status.downloaded, status.total);
      return (
        <Bar
          text={`Updating to ${status.version}…${percent === null ? "" : ` ${percent}%`}`}
          progress={percent ?? 0}
        />
      );
    }
    case "ready":
      return (
        <Bar
          text={`chapay ${status.version} is ready`}
          action={{ label: "Restart to update", onClick: actions.restart }}
        />
      );
    case "installFailed":
      if (status.version === dismissedVersion) return null;
      return (
        <Bar
          text={installFailureText(status.reason)}
          action={{ label: "Try again", onClick: actions.install }}
          onDismiss={() => onDismiss(status.version)}
        />
      );
    case "cannotInstallHere":
      if (status.version === dismissedVersion) return null;
      return (
        <Bar
          text="Move chapay to Applications to update."
          onDismiss={() => onDismiss(status.version)}
        />
      );
    default:
      return null;
  }
}

function Bar({
  text,
  action,
  onDismiss,
  progress,
}: {
  text: string;
  action?: { label: string; onClick: () => Promise<void> };
  onDismiss?: () => void;
  progress?: number;
}) {
  return (
    <div className={styles.updateBanner} role="status">
      <span className={styles.updateText}>{text}</span>
      {action ? (
        <button type="button" className={styles.updateAction} onClick={() => void action.onClick()}>
          {action.label}
        </button>
      ) : null}
      {onDismiss ? (
        <button
          type="button"
          className={styles.updateDismiss}
          aria-label="Dismiss update notice"
          onClick={onDismiss}
        >
          <Icon name="x" size={12} />
        </button>
      ) : null}
      {progress !== undefined ? (
        <span className={styles.updateProgress} aria-hidden style={{ width: `${progress}%` }} />
      ) : null}
    </div>
  );
}
