import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { installFakeApi } from "@renderer/test/fake-api";
import { renderWithProviders } from "@renderer/test/render";
import { TodosPage } from "./todos-page";

describe("TodosPage", () => {
  beforeEach(() => {
    installFakeApi();
  });

  it("shows the empty state when there is nothing stored", async () => {
    renderWithProviders(<TodosPage />);

    expect(await screen.findByText("No todos yet")).toBeInTheDocument();
  });

  it("adds a todo and clears the field", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TodosPage />);
    await screen.findByText("No todos yet");

    const field = screen.getByPlaceholderText("What needs to be done?");
    await user.type(field, "Ship the desktop app");
    await user.click(screen.getByRole("button", { name: "Add todo" }));

    expect(await screen.findByText("Ship the desktop app")).toBeInTheDocument();
    expect(field).toHaveValue("");
  });

  it("does not submit a title that is only whitespace", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TodosPage />);
    await screen.findByText("No todos yet");

    await user.type(screen.getByPlaceholderText("What needs to be done?"), "   ");

    expect(screen.getByRole("button", { name: "Add todo" })).toBeDisabled();
  });

  it("toggles completion and updates the remaining count", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TodosPage />);
    await screen.findByText("No todos yet");

    await user.type(screen.getByPlaceholderText("What needs to be done?"), "Read the ADR");
    await user.click(screen.getByRole("button", { name: "Add todo" }));
    expect(await screen.findByText("1 item left")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Read the ADR" }));

    expect(await screen.findByText("No items left")).toBeInTheDocument();
  });

  it("deletes a todo", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TodosPage />);
    await screen.findByText("No todos yet");

    await user.type(screen.getByPlaceholderText("What needs to be done?"), "Temporary");
    await user.click(screen.getByRole("button", { name: "Add todo" }));
    await screen.findByText("Temporary");

    await user.click(screen.getByRole("button", { name: "Delete: Temporary" }));

    await waitFor(() => expect(screen.getByText("No todos yet")).toBeInTheDocument());
  });
});
