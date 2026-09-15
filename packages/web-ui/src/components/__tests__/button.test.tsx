import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "../button";

describe("Button", () => {
  it("renders its children as an accessible button", () => {
    render(<Button>Save</Button>);
    // getByRole with the accessible name reflects what a user actually sees.
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("reflects the disabled state", () => {
    render(<Button disabled>Nope</Button>);
    expect(screen.getByRole("button", { name: "Nope" })).toBeDisabled();
  });
});
