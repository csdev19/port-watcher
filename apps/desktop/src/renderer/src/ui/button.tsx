import type { ButtonHTMLAttributes } from "react";
import styles from "./button.module.css";

type Variant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Square padding, for a button whose content is a single glyph. */
  iconOnly?: boolean;
}

export function Button({
  variant = "secondary",
  iconOnly = false,
  className,
  type = "button",
  ...props
}: ButtonProps) {
  const classes = [styles.button, styles[variant], iconOnly && styles.icon, className]
    .filter(Boolean)
    .join(" ");

  return <button type={type} className={classes} {...props} />;
}
