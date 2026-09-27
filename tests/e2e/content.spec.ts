import sharp from "sharp";
import { axeViolations, signInOwner } from "./helpers";
import { expect, test, watchPage } from "./test";

// The content editor: the owner edits a case study, previews the draft on the real page, publishes it and
// brings back the earlier copy; the leak check stops a draft with a secret or a word on the owner's list;
// the availability badge follows the profile. Runs last (see playwright.config.ts): it changes the site.

test.describe.configure({ mode: "serial" });

const NEW_TAGLINE = "A small OpenGL renderer, now edited from the admin.";

test("the owner edits a case study, previews it, publishes it and can bring the old copy back", async ({
  page,
  browser,
}) => {
  await signInOwner(page.context());
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/admin/content");
  await expect(page.getByRole("heading", { level: 1, name: "Content" })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole("link", { name: "Work", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Work" })).toBeVisible();
  await page.getByRole("link", { name: /MiniEngine/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "MiniEngine" })).toBeVisible();
  const oldTagline = await page.getByLabel("Tagline").inputValue();
  await page.getByLabel("Tagline").fill(NEW_TAGLINE);
  await page.getByRole("button", { name: "Save the draft" }).click();
  // The first save renders Markdown, whose highlighter may still be loading on a fresh server.
  await expect(page.getByText("Draft saved.")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Changes not published")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  // Visitors still see the published copy.
  const visitor = await browser.newContext();
  const visitorPage = await visitor.newPage();
  await visitorPage.goto("/work/miniengine");
  await expect(visitorPage.getByText(oldTagline)).toBeVisible();

  // The preview shows the draft on the real page, with a banner, until it is ended.
  const [preview] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("button", { name: "Preview" }).click(),
  ]);
  const previewErrors: string[] = [];
  watchPage(preview, previewErrors);
  await expect(preview).toHaveURL(/\/work\/miniengine$/);
  await expect(preview.getByText(NEW_TAGLINE)).toBeVisible();
  await expect(preview.getByText("You are seeing the drafts")).toBeVisible();
  await preview.getByRole("button", { name: "Exit preview" }).click();
  await expect(preview.getByText(oldTagline)).toBeVisible();
  await expect(preview.getByText("You are seeing the drafts")).toHaveCount(0);
  expect(previewErrors).toEqual([]);
  await preview.close();

  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Published. It is on the site now.")).toBeVisible();
  await visitorPage.reload();
  await expect(visitorPage.getByText(NEW_TAGLINE)).toBeVisible();

  // The replaced copy is a version: brought back into the draft, then published again.
  await page.getByRole("button", { name: "Bring back" }).click();
  await expect(page.getByText("Brought back into the draft.")).toBeVisible();
  await expect(page.getByLabel("Tagline")).toHaveValue(oldTagline);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Published. It is on the site now.")).toBeVisible();
  await visitorPage.reload();
  await expect(visitorPage.getByText(oldTagline)).toBeVisible();
  await visitor.close();
});

test("the leak check stops a secret and the owner's own words", async ({ page }) => {
  await signInOwner(page.context());
  await page.emulateMedia({ reducedMotion: "reduce" });

  await page.goto("/admin/content/settings");
  await page.getByLabel("Words that must never be published").fill("Initech");
  await page.getByRole("button", { name: "Save the words" }).click();
  await expect(page.getByText("Saved. Publishing now checks for these words.")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  await page.goto("/admin/content/post/new");
  await page.getByLabel("Title").fill("Moving mail to a new server");
  await page.getByLabel("Address name").fill("moving-mail");
  await page.getByLabel("Description").fill("What changed when the site's email moved.");
  await page.getByLabel("Tags").fill("operations");
  await page
    .getByLabel("Post")
    .fill("## The setting\n\nSMTP_PASSWORD=abcd1234efgh5678 went into the file for Initech.");
  await page.getByRole("button", { name: "Create the draft" }).click();
  await expect(page.getByText("Draft created.")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("The leak check found:")).toBeVisible();
  await expect(page.getByText("A secret from a settings file")).toBeVisible();
  await expect(page.getByText("A word on your list")).toBeVisible();
  const response = await page.request.get("/blog/moving-mail");
  expect(response.status()).toBe(404);

  // Without the secret and the name it goes through.
  await page.getByLabel("Post").fill("## The setting\n\nThe password went into the server's settings file.");
  await page.getByRole("button", { name: "Save and publish" }).click();
  await expect(page.getByText("Published. It is on the site now.")).toBeVisible();
  await page.goto("/blog/moving-mail");
  await expect(page.getByRole("heading", { level: 1, name: "Moving mail to a new server" })).toBeVisible();
});

test("the availability badge follows the profile", async ({ page }) => {
  await signInOwner(page.context());
  await page.goto("/admin/content/profile");
  await page.getByLabel("Taking new projects").uncheck();
  await page.getByRole("button", { name: "Save and publish" }).click();
  await expect(page.getByText("Published. It is on the site now.")).toBeVisible();
  await page.goto("/");
  await expect(page.getByText("Fully booked at the moment").first()).toBeVisible();

  await page.goto("/admin/content/profile");
  await page.getByLabel("Taking new projects").check();
  await page.getByRole("button", { name: "Save and publish" }).click();
  await expect(page.getByText("Published. It is on the site now.")).toBeVisible();
  await page.goto("/");
  await expect(page.getByText("Taking new projects").first()).toBeVisible();
});

test.describe("the media library", () => {
  // The upload that is not an image is refused with 400, which the browser reports.
  test.use({ allowedErrors: /http 400: .*\/admin\/media$|status of 400 \(Bad Request\)/ });

  test("the owner uploads an image, and the site serves it for a year", async ({ page }) => {
    await signInOwner(page.context());
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/admin/content/media");
    expect(await axeViolations(page)).toEqual([]);
    const png = await sharp({
      create: { width: 640, height: 360, channels: 3, background: { r: 34, g: 211, b: 238 } },
    })
      .png()
      .toBuffer();
    await page
      .getByLabel("Image")
      .setInputFiles({ name: "architecture.png", mimeType: "image/png", buffer: png });
    await page.getByLabel("Description").first().fill("The request flow");
    await page.getByRole("button", { name: "Upload" }).click();
    await expect(page.getByText("Uploaded. Copy its Markdown below.")).toBeVisible();
    const image = page.getByRole("img", { name: "The request flow" });
    await expect(image).toBeVisible();

    const src = (await image.getAttribute("src"))!;
    expect(src).toMatch(/^\/media\/[a-f0-9]{64}\.webp$/);
    const served = await page.request.get(src);
    expect(served.status()).toBe(200);
    expect(served.headers()["content-type"]).toBe("image/webp");
    expect(served.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(served.headers()["content-security-policy"]).toBe("default-src 'none'; sandbox");
    expect(served.headers()["x-content-type-options"]).toBe("nosniff");

    // Not an image: refused by its bytes, whatever its name says.
    await page.getByLabel("Image").setInputFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"),
    });
    await page.getByRole("button", { name: "Upload" }).click();
    await expect(page.getByText("Only PNG, JPEG, GIF, WebP and AVIF images.")).toBeVisible();

    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("No images yet.")).toBeVisible();
    expect((await page.request.get(src)).status()).toBe(404);
  });
});

test("the owner picks public repositories for the work page, which shows them with their stars", async ({
  page,
}) => {
  await signInOwner(page.context());
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/admin/content/github");
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByText("Synced: 2 public repositories.")).toBeVisible();
  await expect(page.getByText("private-notes")).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);

  // Nothing is listed until it is ticked; the case study's repository shows its stars either way.
  await page.goto("/work");
  await expect(page.getByRole("heading", { name: "Smaller things on GitHub." })).toHaveCount(0);
  await page.goto("/work/miniengine");
  await expect(page.getByText("12 stars")).toBeVisible();

  await page.goto("/admin/content/github");
  await page.getByLabel("tiny-queue on the work page").check();
  await expect(page.getByText("Shown on the work page.")).toBeVisible();
  // MiniEngine has a case study, so it is not listed twice.
  await page.getByLabel("MiniEngine on the work page").check();
  await expect(page.getByText("Shown on the work page.").nth(1)).toBeVisible();

  await page.goto("/work");
  const openSource = page.locator("section", {
    has: page.getByRole("heading", { name: "Smaller things on GitHub." }),
  });
  await expect(openSource.getByRole("link", { name: /tiny-queue/ })).toHaveAttribute(
    "href",
    "https://github.com/leffloard/tiny-queue",
  );
  await expect(openSource.getByText("4 stars")).toBeVisible();
  await expect(openSource.getByRole("link", { name: /MiniEngine/ })).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);
});
