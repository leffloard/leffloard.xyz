import "server-only";
import type { Collection, Filter, ObjectId } from "mongodb";
import { rankBetween, ranksFor } from "@/lib/rank";

// Placing an item in a list ordered by its `rank` (lib/rank.ts). A scope is one list: a board column, say.

export type Ranked = { _id: ObjectId; rank: string };

async function siblings<T extends Ranked>(
  collection: Collection<T>,
  scope: Filter<T>,
  exclude: ObjectId | null,
): Promise<Ranked[]> {
  const filter = (exclude ? { $and: [scope, { _id: { $ne: exclude } }] } : scope) as Filter<T>;
  return (await collection
    .find(filter, { projection: { rank: 1 } })
    .sort({ rank: 1, _id: 1 })
    .toArray()) as unknown as Ranked[];
}

// Spreads a list out again when two items share a rank (written at the same moment).
async function renumber<T extends Ranked>(collection: Collection<T>, items: Ranked[]): Promise<Ranked[]> {
  const ranks = ranksFor(items.length);
  const renumbered = items.map((item, index) => ({ _id: item._id, rank: ranks[index]! }));
  if (renumbered.length) {
    await collection.bulkWrite(
      renumbered.map((item) => ({
        updateOne: {
          filter: { _id: item._id } as Filter<T>,
          update: { $set: { rank: item.rank } as Partial<T> },
        },
      })),
    );
  }
  return renumbered;
}

/**
 * The rank for an item placed right after `afterId` in a list (`null`: at the top; `"end"`: at the
 * bottom). The moving item itself is left out, so moving within a list works too. An `afterId` that is no
 * longer in the list puts the item at the bottom.
 */
export async function rankFor<T extends Ranked>(
  collection: Collection<T>,
  scope: Filter<T>,
  movingId: ObjectId | null,
  afterId: ObjectId | null | "end",
): Promise<string> {
  let list = await siblings(collection, scope, movingId);
  const hasDuplicates = list.some((item, index) => index > 0 && item.rank <= list[index - 1]!.rank);
  if (hasDuplicates) list = await renumber(collection, list);
  let index: number;
  if (afterId === "end") index = list.length - 1;
  else if (afterId === null) index = -1;
  else {
    index = list.findIndex((item) => item._id.equals(afterId));
    if (index === -1) index = list.length - 1;
  }
  return rankBetween(list[index]?.rank ?? null, list[index + 1]?.rank ?? null);
}
