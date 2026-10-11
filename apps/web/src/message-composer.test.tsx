import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MessageComposer } from "./message-composer.js";

function renderComposer(overrides: Partial<React.ComponentProps<typeof MessageComposer>> = {}) {
  const props: React.ComponentProps<typeof MessageComposer> = {
    draft: "Hello",
    disabled: false,
    sending: false,
    textareaRef: createRef<HTMLTextAreaElement>(),
    onDraftChange: vi.fn(),
    onSend: vi.fn(),
    ...overrides,
  };
  render(<MessageComposer {...props} />);
  return props;
}

describe("MessageComposer", () => {
  it("sends once and prevents a newline for Enter", () => {
    const props = renderComposer();
    const textarea = screen.getByPlaceholderText("Write a message");

    expect(fireEvent.keyDown(textarea, { key: "Enter" })).toBe(false);
    expect(props.onSend).toHaveBeenCalledTimes(1);
    expect((textarea as HTMLTextAreaElement).value).toBe("Hello");
  });

  it("allows Shift+Enter without sending", () => {
    const props = renderComposer();
    const textarea = screen.getByPlaceholderText("Write a message");

    expect(fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true })).toBe(true);
    expect(props.onSend).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<React.ComponentProps<typeof MessageComposer>> & { composing?: boolean }]>([
    ["an empty draft", { draft: "" }],
    ["a disabled composer", { disabled: true }],
    ["an in-flight send", { sending: true }],
    ["IME composition", { composing: true }],
  ])("does not send for %s", (_label, state) => {
    const { composing, ...props } = state;
    const rendered = renderComposer(props);
    const textarea = screen.getByPlaceholderText("Write a message");

    fireEvent.keyDown(textarea, {
      key: "Enter",
      isComposing: composing,
      keyCode: composing ? 229 : undefined,
    });
    expect(rendered.onSend).not.toHaveBeenCalled();
  });
});
