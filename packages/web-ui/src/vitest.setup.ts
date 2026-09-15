// Adds the jest-dom matchers (toBeInTheDocument, toBeDisabled, …) to vitest's
// expect for every component test, and keeps them in the tsconfig program (it
// lives under src/) so tsc sees the augmentation too.
import "@testing-library/jest-dom/vitest";
