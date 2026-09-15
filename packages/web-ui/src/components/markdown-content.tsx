import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../lib/utils";
import { normalizeMarkdown } from "../lib/normalize-markdown";
import "./markdown-content.css";

interface MarkdownContentProps {
  content: string;
  className?: string;
  variant?: "default" | "compact";
  /** Whether to normalize/clean up loose markdown formatting. Defaults to true. */
  normalize?: boolean;
}

export function MarkdownContent({
  content,
  className,
  variant = "default",
  normalize = true,
}: MarkdownContentProps) {
  const processedContent = useMemo(() => {
    if (!normalize) return content;
    return normalizeMarkdown(content);
  }, [content, normalize]);

  return (
    <div
      className={cn(
        "markdown-content",
        variant === "compact" && "markdown-content-compact",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{processedContent}</ReactMarkdown>
    </div>
  );
}
