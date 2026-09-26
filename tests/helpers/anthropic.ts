import Anthropic from "@anthropic-ai/sdk";

// Claude's Messages API played by a list of answers, through the real SDK (a stubbed fetch): streamed
// answers come back as server-sent events, errors as the API's JSON errors. Records what it was asked.

export type FakeAnswer =
  | {
      text: string;
      model?: string;
      stopReason?: "end_turn" | "max_tokens" | "refusal";
      refusal?: string | null; // the refusal's category
      usage?: {
        input?: number;
        output?: number;
        cacheRead?: number;
        cacheWrite?: number;
      };
      iterations?: Record<string, unknown>[];
      thinking?: boolean;
      // The stream breaks off with this error after the text (as an overloaded API can mid-answer).
      failMidway?: { type: string; message: string };
    }
  | { status: number; type: string; message: string };

export type FakeRequest = { url: string; body: Record<string, unknown>; headers: Headers };

function events(answer: Extract<FakeAnswer, { text: string }>): string {
  const usage = answer.usage ?? {};
  const list: Record<string, unknown>[] = [
    {
      type: "message_start",
      message: {
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: answer.model ?? "claude-opus-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: usage.input ?? 1200,
          output_tokens: 1,
          cache_read_input_tokens: usage.cacheRead ?? 0,
          cache_creation_input_tokens: usage.cacheWrite ?? 0,
        },
      },
    },
  ];
  let index = 0;
  if (answer.thinking !== false) {
    list.push(
      {
        type: "content_block_start",
        index,
        content_block: { type: "thinking", thinking: "", signature: "" },
      },
      { type: "content_block_stop", index },
    );
    index += 1;
  }
  if (answer.text) {
    const middle = Math.ceil(answer.text.length / 2);
    list.push(
      { type: "content_block_start", index, content_block: { type: "text", text: "" } },
      {
        type: "content_block_delta",
        index,
        delta: { type: "text_delta", text: answer.text.slice(0, middle) },
      },
      { type: "content_block_delta", index, delta: { type: "text_delta", text: answer.text.slice(middle) } },
      { type: "content_block_stop", index },
    );
  }
  if (answer.failMidway) {
    list.push({ type: "error", error: answer.failMidway });
    return list.map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`).join("");
  }
  list.push(
    {
      type: "message_delta",
      delta: {
        stop_reason: answer.stopReason ?? "end_turn",
        stop_sequence: null,
        stop_details:
          answer.stopReason === "refusal"
            ? { type: "refusal", category: answer.refusal ?? null, explanation: null }
            : null,
      },
      usage: {
        output_tokens: usage.output ?? 300,
        ...(answer.iterations ? { iterations: answer.iterations } : {}),
      },
    },
    { type: "message_stop" },
  );
  return list.map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`).join("");
}

export function fakeAnthropic(...answers: FakeAnswer[]) {
  const requests: FakeRequest[] = [];
  const fetchStub = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      headers: new Headers(init?.headers),
    });
    const answer = answers.shift();
    if (!answer) {
      return Response.json(
        { type: "error", error: { type: "api_error", message: "No answer left." } },
        { status: 500 },
      );
    }
    if ("status" in answer) {
      return Response.json(
        { type: "error", error: { type: answer.type, message: answer.message } },
        { status: answer.status, headers: { "request-id": "req_test_error" } },
      );
    }
    return new Response(events(answer), {
      status: 200,
      headers: { "content-type": "text/event-stream", "request-id": "req_test" },
    });
  }) as typeof fetch;
  const client = new Anthropic({
    apiKey: "test-key",
    authToken: null,
    baseURL: "https://anthropic.test",
    fetch: fetchStub,
    maxRetries: 0,
  });
  return { client, requests };
}
