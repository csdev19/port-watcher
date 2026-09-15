import type { ReactNode } from "react";
import styles from "./card.module.css";

interface CardProps {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}

export function Card({ title, description, children }: CardProps) {
  return (
    <section className={styles.card}>
      {(title || description) && (
        <header className={styles.header}>
          {title && <h2 className={styles.title}>{title}</h2>}
          {description && <p className={styles.description}>{description}</p>}
        </header>
      )}
      <div className={styles.body}>{children}</div>
    </section>
  );
}
