"use client";

import { useState } from "react";
import {
  deleteInquiryAction,
  saveLabelsAction,
  saveNoteAction,
  snoozeAction,
} from "@/app/(admin)/admin/(shell)/inbox/actions";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { inputClasses, selectClasses, textareaClasses } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { SNOOZE_PRESETS, type SnoozePreset } from "@/lib/snooze";

// Private housekeeping for one message: note, labels, snooze and delete.
export function OrganizeCard({
  id,
  note,
  labels,
  knownLabels,
  snoozedUntil,
}: {
  id: string;
  note: string;
  labels: string[];
  knownLabels: string[];
  snoozedUntil: string | null;
}) {
  const { run, pending, message } = useActionRunner();
  const [noteText, setNoteText] = useState(note);
  const [labelText, setLabelText] = useState(labels.join(", "));
  const [preset, setPreset] = useState<SnoozePreset>("tomorrow");
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <Card>
      <CardHeader title="Organize" description="Only you see these." />
      <CardBody className="grid gap-4 text-[13px]">
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

        <div className="grid gap-1.5">
          <label htmlFor="inquiry-note" className="font-medium">
            Private note
          </label>
          <textarea
            id="inquiry-note"
            className={textareaClasses}
            rows={3}
            maxLength={2000}
            value={noteText}
            onChange={(event) => setNoteText(event.target.value)}
          />
          <div>
            <Button
              size="sm"
              pending={pending === "note"}
              onClick={() => run("note", () => saveNoteAction({ id, note: noteText }))}
            >
              Save note
            </Button>
          </div>
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="inquiry-labels" className="font-medium">
            Labels
          </label>
          <input
            id="inquiry-labels"
            className={inputClasses}
            list="known-labels"
            placeholder="e.g. urgent, returning client"
            value={labelText}
            onChange={(event) => setLabelText(event.target.value)}
          />
          <datalist id="known-labels">
            {knownLabels.map((label) => (
              <option key={label} value={label} />
            ))}
          </datalist>
          <p className="text-xs text-muted">Separate labels with commas.</p>
          <div>
            <Button
              size="sm"
              pending={pending === "labels"}
              onClick={() => run("labels", () => saveLabelsAction({ id, labels: labelText.split(",") }))}
            >
              Save labels
            </Button>
          </div>
        </div>

        <div className="grid gap-1.5">
          <span className="font-medium">Snooze</span>
          {snoozedUntil ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted">Snoozed until {snoozedUntil}.</span>
              <Button
                size="sm"
                pending={pending === "wake"}
                onClick={() => run("wake", () => snoozeAction({ id, until: "wake" }))}
              >
                Back to the inbox now
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="snooze-preset" className="sr-only">
                Snooze until
              </label>
              <select
                id="snooze-preset"
                className={selectClasses}
                value={preset}
                onChange={(event) => setPreset(event.target.value as SnoozePreset)}
              >
                {SNOOZE_PRESETS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                pending={pending === "snooze"}
                onClick={() => run("snooze", () => snoozeAction({ id, until: preset }))}
              >
                Snooze
              </Button>
            </div>
          )}
        </div>

        <div className="grid gap-1.5 border-t border-line pt-3">
          {confirmDelete ? (
            <div className="flex flex-wrap items-center gap-2">
              <span>Delete this message and its email history for good?</span>
              <Button
                size="sm"
                variant="danger"
                pending={pending === "delete"}
                onClick={() => run("delete", () => deleteInquiryAction({ id }))}
              >
                Delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Keep it
              </Button>
            </div>
          ) : (
            <div>
              <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
                Delete…
              </Button>
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
