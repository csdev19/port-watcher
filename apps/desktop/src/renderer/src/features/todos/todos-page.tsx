import { useState, type FormEvent } from "react";
import { useTranslations } from "@monorepo-template/i18n";
import { Button } from "@renderer/ui/button";
import { Card } from "@renderer/ui/card";
import { TextField } from "@renderer/ui/text-field";
import { useTodos } from "./use-todos";
import styles from "./todos.module.css";

export function TodosPage() {
  const t = useTranslations();
  const { todos, loading, error, create, update, remove } = useTodos();
  const [title, setTitle] = useState("");

  const remaining = todos.filter((todo) => !todo.completed).length;

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    setTitle("");
    await create({ title: trimmed });
  };

  return (
    <Card title={t("todos.title")} description={t("settings.storageHint")}>
      <form className={styles.form} onSubmit={(event) => void onSubmit(event)}>
        <TextField
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t("todos.placeholder")}
          aria-label={t("todos.placeholder")}
          maxLength={500}
        />
        <Button type="submit" variant="primary" disabled={!title.trim()}>
          {t("todos.add")}
        </Button>
      </form>

      {loading && <p className={styles.status}>{t("common.loading")}</p>}
      {error && <p className={styles.error}>{error}</p>}

      {!loading && !error && todos.length === 0 && (
        <p className={styles.empty}>{t("todos.empty")}</p>
      )}

      {todos.length > 0 && (
        <>
          <ul className={styles.list}>
            {todos.map((todo) => (
              <li key={todo.id} className={styles.item}>
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={todo.completed}
                  aria-label={todo.title}
                  onChange={(event) => void update(todo.id, { completed: event.target.checked })}
                />
                <span
                  className={[styles.title, todo.completed && styles.completed]
                    .filter(Boolean)
                    .join(" ")}
                  data-selectable
                >
                  {todo.title}
                </span>
                <Button
                  variant="danger"
                  onClick={() => void remove(todo.id)}
                  aria-label={`${t("common.delete")}: ${todo.title}`}
                >
                  {t("common.delete")}
                </Button>
              </li>
            ))}
          </ul>
          <p className={styles.footer}>{t("todos.remaining", { count: remaining })}</p>
        </>
      )}
    </Card>
  );
}
