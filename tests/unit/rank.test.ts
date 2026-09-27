import { describe, expect, it } from "vitest";
import { isRank, rankBetween, RankError, ranksFor } from "@/lib/rank";

// The published fractional-indexing test vectors, plus random moves that must keep the order.

describe("rankBetween", () => {
  it.each([
    [null, null, "a0"],
    [null, "a0", "Zz"],
    [null, "Zz", "Zy"],
    ["a0", null, "a1"],
    ["a1", null, "a2"],
    ["a0", "a1", "a0V"],
    ["a1", "a2", "a1V"],
    ["a0V", "a1", "a0l"],
    ["Zz", "a0", "ZzV"],
    ["Zz", "a1", "a0"],
    [null, "Y00", "Xzzz"],
    ["bzz", null, "c000"],
    ["a0", "a0V", "a0G"],
    ["a0", "a0G", "a08"],
    ["b125", "b129", "b127"],
    ["a0", "a1V", "a1"],
    ["Zz", "a01", "a0"],
    [null, "a0V", "a0"],
    [null, "b999", "b99"],
    [null, "A000000000000000000000000001", "A000000000000000000000000000V"],
    ["zzzzzzzzzzzzzzzzzzzzzzzzzzy", null, "zzzzzzzzzzzzzzzzzzzzzzzzzzz"],
    ["zzzzzzzzzzzzzzzzzzzzzzzzzzz", null, "zzzzzzzzzzzzzzzzzzzzzzzzzzzV"],
  ])("between %s and %s is %s", (a, b, expected) => {
    expect(rankBetween(a, b)).toBe(expected);
  });

  it.each([
    [null, "A00000000000000000000000000"],
    ["a00", null],
    ["a00", "a1"],
    ["0", "1"],
    ["a1", "a0"],
    ["a1", "a1"],
  ])("refuses %s and %s", (a, b) => {
    expect(() => rankBetween(a, b)).toThrow(RankError);
  });

  it("keeps the order through thousands of random insertions", () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const list: string[] = [];
    for (let i = 0; i < 3000; i++) {
      const index = Math.floor(random() * (list.length + 1));
      const rank = rankBetween(list[index - 1] ?? null, list[index] ?? null);
      list.splice(index, 0, rank);
    }
    const sorted = [...list].sort();
    expect(list).toEqual(sorted);
    expect(new Set(list).size).toBe(list.length);
    expect(list.every(isRank)).toBe(true);
  });

  it("keeps keys short when items are only added at the end", () => {
    const ranks = ranksFor(5000);
    expect([...ranks].sort()).toEqual(ranks);
    expect(Math.max(...ranks.map((rank) => rank.length))).toBeLessThanOrEqual(4);
  });
});

describe("isRank", () => {
  it.each(["a0", "a0V", "Zz", "b127"])("accepts %s", (rank) => expect(isRank(rank)).toBe(true));
  it.each(["", "a00", "0", "a", "a0 ", "a0$", "A00000000000000000000000000", 7, null])("refuses %s", (rank) =>
    expect(isRank(rank)).toBe(false),
  );
});
