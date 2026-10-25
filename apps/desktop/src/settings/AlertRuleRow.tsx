import { useState, type ReactNode } from "react";
import { ALERT_SETTING_KEYS, type AlertRuleId } from "../lib/alerts";
import { setAlertRuleEnabled } from "./native";
import { useSetting } from "./store";
import { Row, RowNote, Switch } from "./ui";

interface Props {
  rule: AlertRuleId;
  label: string;
  reason: ReactNode;
  badge?: ReactNode;
}

/** One alert rule's switch. Rust accepts the change before it is saved (`setAlertRuleEnabled`),
 * so the switch only moves once the engine has the new setting; a refusal shows a note and
 * leaves it where it was. */
export function AlertRuleRow({ rule, label, reason, badge }: Props) {
  const [enabled] = useSetting(ALERT_SETTING_KEYS[rule]);
  const [note, setNote] = useState<string | null>(null);

  const toggle = (next: boolean) => {
    setNote(null);
    setAlertRuleEnabled(rule, next).catch(() =>
      setNote(`Couldn't turn this alert ${next ? "on" : "off"}. Try again.`),
    );
  };

  return (
    <>
      <Row
        label={label}
        badge={badge}
        reason={reason}
        control={<Switch label={label} checked={enabled} onChange={toggle} />}
      />
      {note ? <RowNote>{note}</RowNote> : null}
    </>
  );
}
