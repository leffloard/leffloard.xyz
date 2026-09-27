import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  type CipherGCM,
  type DecipherGCM,
} from "node:crypto";

// The backup file: one plain JSON header line, then the gzipped NDJSON export encrypted with AES-256-GCM,
// then the 16-byte GCM tag. The header is authenticated too (as additional data), so neither part can be
// changed without the restore noticing. The key is BACKUP_KEY; the header names it by a short fingerprint.

export const MAGIC = "leffloard-backup";
export const FORMAT_VERSION = 1;
export const TAG_BYTES = 16;
export const FILE_EXTENSION = ".lfbak";

export type BackupHeader = {
  magic: typeof MAGIC;
  version: typeof FORMAT_VERSION;
  database: string;
  createdAt: string;
  app: string;
  keyId: string;
  iv: string;
};

// A line of the encrypted export: a document of a collection, or the closing summary.
export type BackupLine = { c: string; d: unknown } | { manifest: BackupManifest };
export type BackupManifest = { collections: Record<string, number>; documents: number; finishedAt: string };

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupError";
  }
}

export function keyId(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export function headerLine(header: BackupHeader): Buffer {
  return Buffer.from(`${JSON.stringify(header)}\n`, "utf8");
}

export function newHeader(input: {
  database: string;
  createdAt: Date;
  app: string;
  key: Buffer;
}): BackupHeader {
  return {
    magic: MAGIC,
    version: FORMAT_VERSION,
    database: input.database,
    createdAt: input.createdAt.toISOString(),
    app: input.app,
    keyId: keyId(input.key),
    iv: randomBytes(12).toString("base64"),
  };
}

export function encryptor(key: Buffer, header: BackupHeader): CipherGCM {
  const cipher = createCipheriv("aes-256-gcm", key, Buffer.from(header.iv, "base64"));
  cipher.setAAD(headerLine(header));
  return cipher;
}

export function decryptor(key: Buffer, header: BackupHeader, tag: Buffer): DecipherGCM {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(header.iv, "base64"));
  decipher.setAAD(headerLine(header));
  decipher.setAuthTag(tag);
  return decipher;
}

export function parseHeader(line: string): BackupHeader {
  let header: Partial<BackupHeader>;
  try {
    header = JSON.parse(line) as Partial<BackupHeader>;
  } catch {
    throw new BackupError("This is not a leffloard.xyz backup file.");
  }
  if (header.magic !== MAGIC) throw new BackupError("This is not a leffloard.xyz backup file.");
  if (header.version !== FORMAT_VERSION) {
    throw new BackupError(
      `This backup uses format ${String(header.version)}; this version reads format ${FORMAT_VERSION}.`,
    );
  }
  if (
    typeof header.iv !== "string" ||
    typeof header.keyId !== "string" ||
    typeof header.database !== "string"
  ) {
    throw new BackupError("The backup's header is damaged.");
  }
  return header as BackupHeader;
}

// "leffloard-leffloard-20260926T031500Z.lfbak"
export function backupFileName(database: string, at: Date): string {
  const stamp = at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  return `leffloard-${database}-${stamp}${FILE_EXTENSION}`;
}
