// Text written by visitors and clients reaches the model inside <untrusted> tags, which the system prompt
// says hold data, never instructions. A tag inside the text could end the block early and put the rest
// outside it, so anything that looks like one of these tags is broken up first.

const TAG = /<\s*\/?\s*untrusted/gi;

export function neutralize(text: string): string {
  return text.replace(TAG, (match) => match.replace("<", "‹"));
}

// `source` says where the text came from ("contact form", "booking form"); it is written by this code.
export function untrusted(source: string, text: string): string {
  return `<untrusted source="${source}">\n${neutralize(text)}\n</untrusted>`;
}
