---
title: Let the model read, never let it count
description: How a bookkeeping bot uses an AI model to understand messy chat messages without ever trusting it with a single number.
date: 2026-09-25
tags: ai, python
---

Two business partners kept their shared income and expenses in a Discord channel, written the way people actually write: "+16 sale", "-500 tl server", "paid him 40". I built them a bot that turns those messages into a ledger. The interesting part was deciding where an AI model belongs in that system, and, more importantly, where it does not.

## The rule

**The model may read. It may never count.**

Reading means pulling fields out of text: this is income, the amount is 500, the currency is lira, the note is "server". Counting means anything that produces a number someone relies on: converting currencies, summing a month, splitting a profit, working out who owes whom. Language models are good at the first and unreliable at the second, and in bookkeeping a result that is right 99% of the time is wrong.

## Rules first, model second

Most messages follow a handful of shapes, so a plain rule-based parser reads them first. It is fast, free and predictable, and it has tests for every shape it knows.

Only a message the rules cannot read, or cannot read with confidence, goes to a small, fast model. Its job is narrow: return the fields it found, in a fixed structure. The bot then reacts to the original message with a check mark when it is sure, or with a question mark and a short note saying what it assumed. Ordinary chat is left alone.

## Names, not identities

The model never decides _who_ a record belongs to. It returns a name as it appeared in the message, and code maps that name to a partner or an account. If the name is unknown, no record is created; the bot asks instead. A model that invents a plausible-looking partner is worse than a model that fails loudly, so the design makes the invention impossible rather than unlikely.

## Questions get computed answers

Partners can also ask things like "what did we earn this month?". Here a stronger model writes the answer, but it does not work anything out. The ledger code computes the figures first and hands them to the model, with an explicit instruction not to derive new ones. The model's contribution is the sentence, not the arithmetic.

## Money is never a float

Underneath, amounts are stored as integers in minor units and handed out as decimals, so rounding errors cannot accumulate and the ledger always adds up. Lira amounts are converted to dollars when they are recorded, and the record keeps the original amount, the dollar value and the rate, so later rate changes never rewrite old entries. If the rate service is unreachable, the bot falls back to a manually entered rate and says so on the record.

## It works without the model

Finally, the AI layer is optional. Without an API key the bot keeps running on its rules; only the fallback and the questions switch off. A provider outage degrades the bot instead of breaking it, and testing stays simple: none of the 119 tests calls a real model. The AI tests use a fake client and check that whatever it returns is filtered by deterministic code, especially that invented names never become records.

The same pattern works well beyond bookkeeping: let the model turn messy input into structured data, keep every decision that matters in code you can test, and design the system so the model's mistakes are visible instead of silent.
