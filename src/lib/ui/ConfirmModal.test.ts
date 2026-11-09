import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/svelte";
import { fireEvent } from "@testing-library/dom";
import ConfirmModal from "./ConfirmModal.svelte";

// Smallest possible component check: proves the jsdom + Testing Library setup
// can mount a Svelte 5 component, read its DOM, and fire events.
describe("ConfirmModal", () => {
  it("renders the title and message, and confirms", async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(ConfirmModal, {
      props: {
        title: "Delete Room",
        message: "This cannot be undone.",
        confirmLabel: "Delete",
        danger: true,
        onConfirm,
        onClose,
      },
    });

    expect(screen.getByRole("dialog", { name: "Delete Room" })).toBeTruthy();
    expect(screen.getByText("This cannot be undone.")).toBeTruthy();

    await fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("closes through Cancel", async () => {
    const onClose = vi.fn();
    render(ConfirmModal, {
      props: { title: "Cancel bill?", message: "…", onConfirm: vi.fn(), onClose },
    });

    await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
