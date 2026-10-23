import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Composer } from "./composer";
const common = {
  conversationId: "conversation-1",
  userId: "ada",
  onTyping: vi.fn(),
  onSend: vi.fn(),
};
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("composer", () => {
  it("does not send an empty message and has accessible controls", () => {
    render(<Composer {...common} />);
    expect(
      screen.getByRole("textbox", { name: "Message text" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Attach image or video" })
    ).toBeEnabled();
  });
  it("sends trimmed text with Enter and clears draft", async () => {
    render(<Composer {...common} />);
    const input = screen.getByRole("textbox", { name: "Message text" });
    fireEvent.change(input, { target: { value: " hello world " } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter", charCode: 13 });
    expect(common.onSend).toHaveBeenCalledWith("hello world", null);
    await waitFor(() =>
      expect(localStorage.getItem("relay:draft:ada:conversation-1")).toBe("")
    );
  });
  it("preserves draft across unmount and full remount, scoped per chat", async () => {
    const view = render(<Composer {...common} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Message text" }), {
      target: { value: "my unfinished thought" },
    });
    await waitFor(() =>
      expect(localStorage.getItem("relay:draft:ada:conversation-1")).toBe(
        "my unfinished thought"
      )
    );
    view.unmount();
    render(<Composer {...common} />);
    expect(screen.getByRole("textbox", { name: "Message text" })).toHaveValue(
      "my unfinished thought"
    );
    cleanup();
    render(<Composer {...common} conversationId="conversation-2" />);
    expect(screen.getByRole("textbox", { name: "Message text" })).toHaveValue(
      ""
    );
  });
  it("rejects unsupported media with a readable error state", () => {
    render(<Composer {...common} />);
    const input = screen.getByLabelText("Select image or video");
    fireEvent.change(input, {
      target: {
        files: [
          new File(["payload"], "malware.exe", {
            type: "application/x-msdownload",
          }),
        ],
      },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a JPG");
  });
  it("validates image description and allows sending without a caption", () => {
    class MockUploadRequest {
      upload = { onprogress: null };
      status = 200;

      responseText = JSON.stringify({
        media: {
          id: "upload-1",
          url: "https://res.cloudinary.com/example/image/upload/photo.png",
          kind: "image",
          name: "photo.png",
        },
      });

      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;

      open() {}
      send() {
        this.onload?.();
      }
      abort() {
        this.onabort?.();
      }
    }

    vi.stubGlobal("XMLHttpRequest", MockUploadRequest);

    render(<Composer {...common} />);

    fireEvent.change(screen.getByLabelText("Select image or video"), {
      target: {
        files: [
          new File(["image data"], "photo.png", {
            type: "image/png",
          }),
        ],
      },
    });

    const send = screen.getByRole("button", {
      name: "Send message",
    });

    const description = screen.getByRole("textbox", {
      name: /Image description/i,
    });

    expect(send).toBeDisabled();

    expect(screen.getByRole("status")).toHaveTextContent(
      "Add an image description"
    );

    fireEvent.change(description, {
      target: { value: "ss" },
    });

    expect(send).toBeDisabled();

    expect(screen.getByRole("status")).toHaveTextContent(
      "Description is too short"
    );

    fireEvent.change(description, {
      target: {
        value: "Two friends laughing together",
      },
    });

    expect(send).toBeEnabled();

    fireEvent.click(send);

    expect(common.onSend).toHaveBeenCalledWith(
      "",
      expect.objectContaining({
        id: "upload-1",
        kind: "image",
        altText: "Two friends laughing together",
      })
    );
  });
});
