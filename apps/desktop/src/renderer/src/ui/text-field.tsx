import type { InputHTMLAttributes } from "react";
import styles from "./text-field.module.css";

export function TextField({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={[styles.input, className].filter(Boolean).join(" ")} {...props} />;
}
