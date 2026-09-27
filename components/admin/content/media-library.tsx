"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteMediaAction, setMediaAltAction } from "@/app/(admin)/admin/(shell)/content/actions";
import { CopyButton } from "@/components/admin/copy-button";
import { FormRow, controlProps } from "@/components/admin/form-row";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { compactInputClasses, inputClasses } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

export type MediaRow = {
  id: string;
  src: string;
  width: number;
  height: number;
  size: string;
  alt: string;
  name: string;
  added: string;
};

// Markdown that shows the image in a case study or post.
function snippet(row: { src: string; alt: string }): string {
  return `![${row.alt.replace(/[[\]]/g, "")}](${row.src})`;
}

export function MediaUpload() {
  const router = useRouter();
  const [alt, setAlt] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setMessage({ tone: "error", text: "Choose an image to upload." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/admin/media", { method: "POST", body: data });
      const body = (await response.json().catch(() => ({}))) as { error?: string; existed?: boolean };
      if (response.ok) {
        setMessage({
          tone: "success",
          text: body.existed
            ? "That image was already in the library."
            : "Uploaded. Copy its Markdown below.",
        });
        form.reset();
        setAlt("");
        router.refresh();
      } else {
        setMessage({ tone: "error", text: body.error ?? "The upload failed. Please try again." });
      }
    } catch {
      setMessage({ tone: "error", text: "The upload failed. Check your connection and try again." });
    }
    setBusy(false);
  }

  return (
    <Card>
      <CardHeader
        title="Upload an image"
        description="PNG, JPEG, GIF, WebP or AVIF, up to 12 MB. It is scaled to at most 2400 pixels and saved as WebP, without its metadata (camera, place, time)."
      />
      <CardBody>
        <form
          onSubmit={upload}
          noValidate
          className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
        >
          <FormRow id="media-file" label="Image">
            <input
              {...controlProps("media-file")}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
              className="text-sm"
            />
          </FormRow>
          <FormRow id="media-alt" label="Description" hint="What the image shows, for screen readers.">
            <input
              {...controlProps("media-alt", undefined, true)}
              className={inputClasses}
              maxLength={300}
              value={alt}
              onChange={(event) => setAlt(event.target.value)}
            />
          </FormRow>
          <Button type="submit" variant="primary" pending={busy}>
            Upload
          </Button>
        </form>
        {message ? (
          <Notice tone={message.tone} className="mt-4">
            {message.text}
          </Notice>
        ) : null}
      </CardBody>
    </Card>
  );
}

function MediaItem({ row }: { row: MediaRow }) {
  const [alt, setAlt] = useState(row.alt);
  const { run, pending, message } = useActionRunner();
  return (
    <li className="grid content-start gap-3 rounded-lg border border-line p-3 text-[13px]">
      {/* eslint-disable-next-line @next/next/no-img-element -- the library's own images, already sized */}
      <img
        src={row.src}
        alt={row.alt}
        width={row.width}
        height={row.height}
        loading="lazy"
        className="aspect-video w-full rounded-md bg-surface object-contain"
      />
      <p className="truncate text-xs text-muted" title={row.name}>
        {row.name} · {row.width}×{row.height} · {row.size} · {row.added}
      </p>
      <div className="grid gap-1">
        <label htmlFor={`alt-${row.id}`} className="text-xs text-muted">
          Description
        </label>
        <div className="flex gap-2">
          <input
            id={`alt-${row.id}`}
            className={compactInputClasses}
            maxLength={300}
            value={alt}
            onChange={(event) => setAlt(event.target.value)}
          />
          <Button
            size="sm"
            pending={pending === "alt"}
            disabled={alt === row.alt}
            onClick={() => run("alt", () => setMediaAltAction({ id: row.id, alt }))}
          >
            Save
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <CopyButton value={snippet({ src: row.src, alt })} label="Copy Markdown" />
        <Button
          size="sm"
          variant="ghost"
          pending={pending === "delete"}
          onClick={() => run("delete", () => deleteMediaAction({ id: row.id }))}
        >
          Delete
        </Button>
      </div>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </li>
  );
}

export function MediaGrid({ rows }: { rows: MediaRow[] }) {
  if (!rows.length) return <p className="text-sm text-muted">No images yet.</p>;
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((row) => (
        <MediaItem key={row.id} row={row} />
      ))}
    </ul>
  );
}
