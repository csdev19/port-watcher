import { z } from "zod";

export const commaSeparatedList = z.string().transform((val) =>
  val
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
