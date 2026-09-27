import sharp from "sharp";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONTENT_SCHEMAS } from "@/lib/content/schemas";
import { resetClock, setClock } from "@/server/clock";
import { createContent } from "@/server/content/editor";
import {
  deleteMedia,
  listMedia,
  mediaInUse,
  readMedia,
  sniffImage,
  storeImage,
} from "@/server/content/media";
import { seedContent } from "@/server/content/seed";
import { closeClient } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { setupTestDb } from "./db";
import { setupTestEnv } from "./env";

const { db, url, name } = setupTestDb();
setupTestEnv({ MONGO_URL: url, DB_NAME: name });

const NOW = new Date("2026-09-28T06:00:00Z");

beforeEach(async () => {
  await runMigrations(db());
  setClock(() => NOW);
});

afterEach(() => resetClock());

afterAll(async () => {
  await closeClient();
});

// A large JPEG from a "camera": with EXIF data and turned on its side.
async function cameraPhoto(): Promise<Buffer> {
  return sharp({ create: { width: 3200, height: 2000, channels: 3, background: { r: 30, g: 120, b: 200 } } })
    .jpeg()
    .withExif({ IFD0: { Make: "PhoneMaker", Model: "Model X", Copyright: "Somebody" } })
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

describe("the media library", () => {
  it("recognises images by their bytes, not their names", () => {
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(sniffImage(new TextEncoder().encode("GIF89a..."))).toBe("gif");
    expect(sniffImage(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
    expect(sniffImage(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'>"))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("<?php echo 1; ?>"))).toBeNull();
  });

  it("stores an upright, scaled WebP without the camera's metadata, once per image", async () => {
    const photo = await cameraPhoto();
    const first = await storeImage(db(), {
      bytes: photo,
      name: "C:\\Users\\me\\IMG_0001.jpg",
      alt: "A blue test",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.media).toMatchObject({
      name: "IMG_0001.jpg",
      alt: "A blue test",
      width: 1500,
      height: 2400,
    });
    expect(first.media.src).toMatch(/^\/media\/[a-f0-9]{64}\.webp$/);

    const stored = await readMedia(db(), first.media.id);
    expect(stored?.contentType).toBe("image/webp");
    const meta = await sharp(stored!.bytes).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();

    const again = await storeImage(db(), { bytes: photo, name: "copy.jpg", alt: "" });
    expect(again.ok && again.existed && again.media.id).toBe(first.media.id);
    expect(await listMedia(db())).toHaveLength(1);
  });

  it("refuses what is not an image, or too large", async () => {
    expect(
      await storeImage(db(), { bytes: new TextEncoder().encode("<svg/>"), name: "x.png", alt: "" }),
    ).toEqual({
      ok: false,
      message: "Only PNG, JPEG, GIF, WebP and AVIF images.",
    });
    const broken = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    expect(await storeImage(db(), { bytes: broken, name: "x.png", alt: "" })).toMatchObject({ ok: false });
    expect(
      await storeImage(db(), { bytes: new Uint8Array(13 * 1024 * 1024), name: "big.png", alt: "" }),
    ).toEqual({
      ok: false,
      message: "Images can be up to 12 MB.",
    });
    expect(await readMedia(db(), "../../etc/passwd")).toBeNull();
  });

  it("keeps an image a draft or a published page shows", async () => {
    await seedContent(db(), NOW);
    const stored = await storeImage(db(), {
      bytes: await cameraPhoto(),
      name: "diagram.jpg",
      alt: "Diagram",
    });
    if (!stored.ok) throw new Error("not stored");
    const post = CONTENT_SCHEMAS.post.parse({
      slug: "with-a-diagram",
      title: "With a diagram",
      description: "A post that shows an image from the library.",
      date: "2026-09-28",
      tags: ["notes"],
      body: `## Diagram\n\n![Diagram](${stored.media.src})`,
    });
    const created = await createContent(db(), "post", post, NOW);
    expect(created.ok && created.doc.draft).toMatchObject({
      html: expect.stringContaining(`<img src="${stored.media.src}" alt="Diagram" loading="lazy"`),
    });
    expect(await mediaInUse(db(), stored.media.id)).toBe(true);
    expect(await deleteMedia(db(), stored.media.id)).toBe("in-use");

    const unused = await storeImage(
      db(),
      {
        bytes: await sharp({ create: { width: 10, height: 10, channels: 3, background: "white" } })
          .png()
          .toBuffer(),
        name: "dot.png",
        alt: "",
      },
      NOW,
    );
    if (!unused.ok) throw new Error("not stored");
    expect(await deleteMedia(db(), unused.media.id)).toBe("deleted");
    expect(await deleteMedia(db(), unused.media.id)).toBe("missing");
  });
});
