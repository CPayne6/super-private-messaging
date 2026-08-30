import { type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Button, Input } from "antd";

export function MessageComposer({
  draft,
  disabled,
  sending,
  textareaRef,
  onDraftChange,
  onSend,
}: {
  draft: string;
  disabled: boolean;
  sending: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onDraftChange: (value: string) => void;
  onSend: () => void;
}): React.JSX.Element {
  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const nativeEvent = event.nativeEvent;
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      nativeEvent.isComposing ||
      nativeEvent.keyCode === 229
    )
      return;
    event.preventDefault();
    if (!disabled && !sending && draft.trim()) onSend();
  };

  return (
    <div className="composer">
      <div className="composer-input">
        <Input.TextArea
          ref={textareaRef}
          value={draft}
          autoSize={{ minRows: 1, maxRows: 5 }}
          placeholder="Write a message"
          enterKeyHint="send"
          aria-describedby="send-keyboard-hint"
          disabled={disabled || sending}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <span className="sr-only" id="send-keyboard-hint">
          Press Enter to send. Press Shift+Enter to add a new line.
        </span>
      </div>
      <Button
        type="primary"
        onClick={onSend}
        loading={sending}
        disabled={disabled || sending || !draft.trim()}
      >
        Send
      </Button>
    </div>
  );
}
