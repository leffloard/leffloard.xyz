"use server";

import { z } from "zod";
import { ok } from "@/lib/action-result";
import { MAX_SEARCH_LENGTH } from "@/lib/search";
import { adminAction } from "@/server/auth/action";
import { searchEverything } from "@/server/search/everything";

// The command palette's search across the admin (server/search/everything.ts).
export const searchEverythingAction = adminAction(
  z.object({ query: z.string().max(MAX_SEARCH_LENGTH) }).strict(),
  async ({ query }, { db }) => ok(await searchEverything(db, query)),
);
