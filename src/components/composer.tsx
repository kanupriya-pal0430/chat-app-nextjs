"use client";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { AlertCircle, ImagePlus, Paperclip, Send, X } from "lucide-react";
import type { Media } from "@/lib/shared/types";
import { MAX_MESSAGE_LENGTH } from "@/lib/shared/validation";

type Props = {
  conversationId: string;
  userId: string;
  onSend: (body: string, media: Media | null) => void;
  onTyping: (isTyping: boolean) => void;
};
export function Composer({ conversationId, userId, onSend, onTyping }: Props) {
  const [text, setText] = useState("");
  const [ready, setReady] = useState(false);
  const [media, setMedia] = useState<Media | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const submittingRef = useRef(false);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftKey = `relay:draft:${userId}:${conversationId}`;
  const imageDescriptionLength = (media?.altText ?? "").trim().length;
  const imageDescriptionInvalid =
    media?.kind === "image" && imageDescriptionLength < 5;

  const altHelpId = `alt-help-${conversationId}`;
  const altValidationId = `alt-validation-${conversationId}`;
  useEffect(() => {
    try {
      setText(localStorage.getItem(draftKey) ?? "");
    } catch {
      /* private storage blocked: draft is still usable in memory */
    }
    setReady(true);
    return () => {
      xhrRef.current?.abort();
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
    };
  }, [draftKey]);
  useEffect(() => {
    if (ready) {
      try {
        localStorage.setItem(draftKey, text);
      } catch {
        /* storage quota / disabled */
      }
    }
  }, [text, draftKey, ready]);
  const update = (value: string) => {
    setText(value.slice(0, MAX_MESSAGE_LENGTH));
    onTyping(true);
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => onTyping(false), 1200);
  };
  const upload = (file: File) => {
    setError(null);
    if (
      !/^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm))$/.test(file.type) ||
      file.size > 15 * 1024 * 1024 ||
      file.size === 0
    ) {
      setError("Choose a JPG, PNG, WebP, GIF, MP4, or WebM under 15 MB.");
      return;
    }
    xhrRef.current?.abort();
    setMedia(null);
    const request = new XMLHttpRequest();
    xhrRef.current = request;
    setProgress(0);
    request.open("POST", "/api/upload");
    request.upload.onprogress = (e) => {
      if (e.lengthComputable)
        setProgress(Math.round((e.loaded / e.total) * 100));
    };
    request.onload = () => {
      setProgress(null);
      try {
        const result: unknown = JSON.parse(request.responseText);
        if (
          request.status !== 200 ||
          !result ||
          typeof result !== "object" ||
          !("media" in result)
        )
          throw new Error("Upload failed. Please retry.");
        setMedia(result.media as Media);
      } catch {
        setError("Upload failed. Check Cloudinary configuration and retry.");
      }
    };
    request.onerror = () => {
      setProgress(null);
      setError("Network error during upload. Please retry.");
    };
    request.onabort = () => {
      setProgress(null);
    };
    const data = new FormData();
    data.set("file", file);
    request.send(data);
  };
  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) upload(file);
    event.target.value = "";
  };
  useEffect(() => {
    if (text === "" && media === null) {
      submittingRef.current = false;
    }
  }, [text, media, conversationId]);
  const submit = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
  
    const body = text.trim();
  
    if (
      submittingRef.current ||
      (!body && !media) ||
      progress !== null ||
      imageDescriptionInvalid
    ) {
      return;
    }
  
    submittingRef.current = true;
  
    try {
      onSend(body, media);
  
      setText("");
      setMedia(null);
      setError(null);
      onTyping(false);
    } catch {
      submittingRef.current = false;
      setError("Message could not be queued. Please try again.");
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
  
      if (event.repeat) return;
  
      submit();
    }
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) upload(file);
  };
  return (
    <div
      className={`composer-section ${dragging ? "dragging" : ""}`}
      onDragEnter={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes("Files")) setDragging(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDragging(false);
      }}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          Drop a photo or video to upload
        </div>
      )}
      {media && (
        <div className="attachment-preview">
          <Paperclip size={15} />
          <span>{media.name}</span>
          <span className="upload-done">Ready to send</span>
          <button aria-label="Remove attachment" onClick={() => setMedia(null)}>
            <X size={16} />
          </button>
        </div>
      )}

      {media?.kind === "image" && (
        <div className="alt-input-wrap">
          <label htmlFor={`alt-${conversationId}`}>
            Image description (required for screen readers)
          </label>

          <p id={altHelpId} className="alt-guidance">
            Describe what is shown (at least 5 characters). The message below is
            optional.
          </p>

          <input
            id={`alt-${conversationId}`}
            maxLength={180}
            value={media.altText ?? ""}
            aria-invalid={imageDescriptionInvalid}
            aria-describedby={`${altHelpId}${
              imageDescriptionInvalid ? ` ${altValidationId}` : ""
            }`}
            onChange={(e) =>
              setMedia((previous) =>
                previous ? { ...previous, altText: e.target.value } : null
              )
            }
            placeholder="e.g. Two friends laughing together"
          />

          {imageDescriptionInvalid && (
            <p id={altValidationId} className="alt-validation" role="status">
              {imageDescriptionLength === 0
                ? "Add an image description to enable Send."
                : "Description is too short. Enter at least 5 characters to enable Send."}
            </p>
          )}
        </div>
      )}
      {progress !== null && (
        <div
          className="upload-progress"
          role="status"
          aria-label="Upload progress"
        >
          <div className="progress-track">
            <div style={{ width: `${progress}%` }} />
          </div>
          <span>{progress}% uploading…</span>
          <button
            onClick={() => xhrRef.current?.abort()}
            aria-label="Cancel upload"
          >
            <X size={15} />
          </button>
        </div>
      )}
      {error && (
        <div className="composer-error" role="alert">
          <AlertCircle size={15} />
          {error}
          <button onClick={() => setError(null)} aria-label="Dismiss error">
            <X size={14} />
          </button>
        </div>
      )}
      <form className="composer-form" onSubmit={submit}>
        <input
          ref={inputRef}
          id={`file-${conversationId}`}
          className="visually-hidden"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm"
          onChange={onFileChange}
          aria-label="Select image or video"
        />
        <button
          className="attach-button"
          type="button"
          onClick={() => inputRef.current?.click()}
          aria-label="Attach image or video"
        >
          <ImagePlus size={21} />
        </button>
        <label className="visually-hidden" htmlFor={`text-${conversationId}`}>
          Message text
        </label>
        <textarea
          id={`text-${conversationId}`}
          rows={1}
          value={text}
          onChange={(e) => update(e.target.value)}
          onKeyDown={onKeyDown}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder="Type your message…"
          aria-label="Message text"
        />
        <button
          className="send-button"
          type="submit"
          aria-label="Send message"
          disabled={
            (!text.trim() && !media) ||
            progress !== null ||
            imageDescriptionInvalid
          }
        >
          <Send size={20} />
        </button>
      </form>
      <div className="composer-hint">
        <span>
          ↵ to send <b>·</b> Shift + ↵ for new line <b>·</b> Drag media here
        </span>
        <span>
          {text.length}/{MAX_MESSAGE_LENGTH}
        </span>
      </div>
    </div>
  );
}
