// Connection strings carry the database password, so anything printed uses these helpers instead.
// Everything up to the last "@" counts as credentials: over-redacting a malformed string is fine,
// printing part of a password is not.

const SCHEME = /^mongodb(?:\+srv)?:\/\//i;

function split(url: string): { scheme: string; credentials: string; rest: string } {
  const scheme = SCHEME.exec(url)?.[0] ?? "";
  const afterScheme = url.slice(scheme.length);
  const at = afterScheme.lastIndexOf("@");
  return {
    scheme,
    credentials: at === -1 ? "" : afterScheme.slice(0, at),
    rest: afterScheme.slice(at + 1),
  };
}

export function redactMongoUrl(url: string): string {
  const { scheme, credentials, rest } = split(url);
  if (!credentials) return url;
  const user = credentials.split(":")[0];
  return `${scheme}${user ? `${user}:***` : "***"}@${rest}`;
}

// Host part only, for messages such as "cannot reach cluster0.abcd.mongodb.net".
export function mongoHosts(url: string): string {
  return split(url).rest.split(/[/?#]/)[0] ?? "";
}
