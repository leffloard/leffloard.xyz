"use client";

import { useState } from "react";
import { saveContentSettingsAction } from "@/app/(admin)/admin/(shell)/content/actions";
import { FormRow, controlProps } from "@/components/admin/form-row";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Button } from "@/components/ui/button";
import { textareaClasses } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

// The owner's own words for the leak check: client names, private domains, anything that must never be
// published.
export function LeakWordsForm({ words, version }: { words: string[]; version: number }) {
  const [text, setText] = useState(words.join("\n"));
  const { run, pending, message } = useActionRunner();
  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void run("save", () => saveContentSettingsAction({ bannedWords: text, version }));
      }}
    >
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <FormRow
        id="leak-words"
        label="Words that must never be published"
        hint="One per line, in any case: client and company names, private domains, project code names."
      >
        <textarea
          {...controlProps("leak-words", undefined, true)}
          rows={10}
          className={textareaClasses}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </FormRow>
      <div>
        <Button type="submit" pending={pending === "save"}>
          Save the words
        </Button>
      </div>
    </form>
  );
}
