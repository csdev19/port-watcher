/**
 * Normalizes loose/poorly formatted markdown content for better rendering in UI cards.
 * Improves headers, lists, spacing, and emphasis while preserving original content.
 */
export function normalizeMarkdown(content: string): string {
  if (!content || typeof content !== "string") {
    return content;
  }

  let normalized = content;

  // Step 1: Normalize line endings
  normalized = normalized.replace(/\r\n/g, "\n");

  // Step 2: Convert informal headers (lines ending with colon that look like titles)
  // Match lines that are short (under 60 chars), end with colon, and are followed by content
  normalized = normalized.replace(
    /^([A-ZÁÉÍÓÚÑÜ][A-Za-záéíóúñüÁÉÍÓÚÑÜ\s]{2,55}):?\s*$/gm,
    (match, title) => {
      const trimmedTitle = title.trim().replace(/:$/, "");
      // Don't convert if it's already a header or list item
      if (match.startsWith("#") || match.startsWith("-") || match.startsWith("*")) {
        return match;
      }
      return `## ${trimmedTitle}`;
    },
  );

  // Step 3: Convert informal dash/asterisk lists to proper markdown lists
  // Handle lines starting with dash or asterisk followed by space
  normalized = normalized.replace(/^[\t ]*[-–—•]\s+/gm, "- ");

  // Step 4: Normalize numbered lists (ensure proper format: "1. ")
  normalized = normalized.replace(/^[\t ]*(\d+)[.)]\s*/gm, "$1. ");

  // Step 5: Add blank lines before headers (if not already present)
  normalized = normalized.replace(/([^\n])\n(#{1,6}\s)/g, "$1\n\n$2");

  // Step 6: Add blank line after headers (if not already present)
  normalized = normalized.replace(/(#{1,6}\s[^\n]+)\n([^#\n])/g, "$1\n\n$2");

  // Step 7: Ensure blank lines between paragraphs (text blocks separated by single newline)
  // But don't add extra lines in lists
  normalized = normalized.replace(/([^\n-*\d].*[.!?:])\n([A-ZÁÉÍÓÚÑÜ])/g, "$1\n\n$2");

  // Step 8: Clean up excessive blank lines (more than 2 consecutive)
  normalized = normalized.replace(/\n{3,}/g, "\n\n");

  // Step 9: Trim leading/trailing whitespace
  normalized = normalized.trim();

  return normalized;
}
