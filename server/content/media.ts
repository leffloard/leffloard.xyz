import "server-only";
import { Binary, type Db } from "mongodb";
import sharp from "sharp";
import { now } from "@/server/clock";
import { contentItems, contentVersions } from "@/server/content/collections";
import { sha256Hex } from "@/server/security/crypto";

// The media library: images for case studies and posts. An upload is recognised by its first bytes (never
// by its name or the browser's word), decoded, turned upright, scaled to at most 2400 pixels and written
// again as WebP, which leaves every piece of metadata (camera, place, time) behind. The result is kept in the
// database, so backups include it, under the SHA-256 of its bytes: the same image uploaded twice is one copy,
// and its address (/media/<sha256>.webp) never changes, so browsers and Cloudflare keep it for a year.

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const MAX_SIDE = 2400;
const MAX_STORED_BYTES = 4 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;

export type MediaDoc = {
  _id: string; // SHA-256 of the stored WebP bytes
  bytes: Binary;
  contentType: "image/webp";
  width: number;
  height: number;
  size: number;
  alt: string;
  name: string; // the uploaded file's name, for the owner
  createdAt: Date;
};

export type MediaView = {
  id: string;
  src: string;
  width: number;
  height: number;
  size: number;
  alt: string;
  name: string;
  createdAt: Date;
};

export function mediaItems(db: Db) {
  return db.collection<MediaDoc>("media");
}

export function mediaSrc(id: string): string {
  return `/media/${id}.webp`;
}

type ImageKind = "png" | "jpeg" | "gif" | "webp" | "avif";

// What an upload really is, from its first bytes.
export function sniffImage(bytes: Uint8Array): ImageKind | null {
  const at = (offset: number, ...values: number[]) =>
    values.every((value, index) => bytes[offset + index] === value);
  const ascii = (offset: number, text: string) => at(offset, ...[...text].map((char) => char.charCodeAt(0)));
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (at(0, 0xff, 0xd8, 0xff)) return "jpeg";
  if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return "gif";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "webp";
  if (ascii(4, "ftypavif") || ascii(4, "ftypavis")) return "avif";
  return null;
}

function cleanName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  return base.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120) || "image";
}

function view(doc: Omit<MediaDoc, "bytes">): MediaView {
  return {
    id: doc._id,
    src: mediaSrc(doc._id),
    width: doc.width,
    height: doc.height,
    size: doc.size,
    alt: doc.alt,
    name: doc.name,
    createdAt: doc.createdAt,
  };
}

export type StoreResult = { ok: true; media: MediaView; existed: boolean } | { ok: false; message: string };

export async function storeImage(
  db: Db,
  input: { bytes: Uint8Array; name: string; alt: string },
  at: Date = now(),
): Promise<StoreResult> {
  if (input.bytes.length === 0) return { ok: false, message: "Choose an image to upload." };
  if (input.bytes.length > MAX_UPLOAD_BYTES) return { ok: false, message: "Images can be up to 12 MB." };
  if (!sniffImage(input.bytes)) return { ok: false, message: "Only PNG, JPEG, GIF, WebP and AVIF images." };
  let output: { data: Buffer; info: { width: number; height: number } };
  try {
    output = await sharp(input.bytes, { limitInputPixels: MAX_PIXELS, failOn: "error" })
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    return { ok: false, message: "The image could not be read. Try saving it again as PNG or JPEG." };
  }
  if (output.data.length > MAX_STORED_BYTES) {
    return { ok: false, message: "Even scaled down, the image is over 4 MB. Try a smaller one." };
  }
  const doc: MediaDoc = {
    _id: sha256Hex(output.data),
    bytes: new Binary(output.data),
    contentType: "image/webp",
    width: output.info.width,
    height: output.info.height,
    size: output.data.length,
    alt: input.alt.trim().slice(0, 300),
    name: cleanName(input.name),
    createdAt: at,
  };
  const result = await mediaItems(db).updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true });
  const stored = result.upsertedCount
    ? doc
    : ((await mediaItems(db).findOne({ _id: doc._id }, { projection: { bytes: 0 } })) ?? doc);
  return { ok: true, media: view(stored), existed: !result.upsertedCount };
}

export async function listMedia(db: Db): Promise<MediaView[]> {
  const docs = await mediaItems(db)
    .find({}, { projection: { bytes: 0 } })
    .sort({ createdAt: -1 })
    .limit(500)
    .toArray();
  return docs.map(view);
}

export async function readMedia(db: Db, id: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  if (!/^[a-f0-9]{64}$/.test(id)) return null;
  const doc = await mediaItems(db).findOne({ _id: id }, { projection: { bytes: 1, contentType: 1 } });
  return doc ? { bytes: Buffer.from(doc.bytes.buffer), contentType: doc.contentType } : null;
}

export async function setMediaAlt(db: Db, id: string, alt: string): Promise<boolean> {
  return (
    (await mediaItems(db).updateOne({ _id: id }, { $set: { alt: alt.trim().slice(0, 300) } }))
      .matchedCount === 1
  );
}

// Whether a draft, a published copy or a kept version shows the image.
export async function mediaInUse(db: Db, id: string): Promise<boolean> {
  const needle = new RegExp(`/media/${id}\\.webp`);
  const [content, versions] = await Promise.all([
    contentItems(db).countDocuments(
      { $or: [{ "draft.body": needle }, { "published.body": needle }] },
      { limit: 1 },
    ),
    contentVersions(db).countDocuments({ "data.body": needle }, { limit: 1 }),
  ]);
  return content + versions > 0;
}

export async function deleteMedia(db: Db, id: string): Promise<"deleted" | "in-use" | "missing"> {
  if (await mediaInUse(db, id)) return "in-use";
  return (await mediaItems(db).deleteOne({ _id: id })).deletedCount ? "deleted" : "missing";
}
