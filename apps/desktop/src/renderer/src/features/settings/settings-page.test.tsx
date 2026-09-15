import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { installFakeApi } from "@renderer/test/fake-api";
import { renderWithProviders } from "@renderer/test/render";
import { SettingsPage } from "./settings-page";

describe("SettingsPage", () => {
  beforeEach(() => {
    installFakeApi();
  });

  it("shows the persisted preferences as the selected options", () => {
    renderWithProviders(<SettingsPage />, { locale: "es", theme: "dark" });

    expect(screen.getByLabelText("Idioma")).toHaveValue("es");
    expect(screen.getByLabelText("Tema")).toHaveValue("dark");
  });

  /**
   * The whole point of routing the locale through the main process: switching it
   * here has to re-render the UI in the new language, not just persist a value.
   */
  it("re-renders in the new language when the locale changes", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await user.selectOptions(screen.getByLabelText("Language"), "es");

    expect(await screen.findByLabelText("Idioma")).toBeInTheDocument();
  });

  it("persists a theme change through the bridge", async () => {
    const user = userEvent.setup();
    const state = installFakeApi();
    renderWithProviders(<SettingsPage />);

    await user.selectOptions(screen.getByLabelText("Theme"), "dark");

    expect(state.settings.theme).toBe("dark");
  });
});
