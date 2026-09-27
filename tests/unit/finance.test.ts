import { describe, expect, it } from "vitest";
import { nextOccurrence, periodLabel, withPeriod } from "@/lib/billing/recurring";
import { toCsv } from "@/lib/finance/csv";
import {
  bulletinFor,
  convertMinor,
  formatRate,
  parseTcmbBulletin,
  scaledRate,
  type Bulletin,
} from "@/lib/finance/fx";
import { agingBucket } from "@/lib/finance/options";

// The shape of TCMB's today.xml (trimmed), including a currency quoted per 100 units.
const BULLETIN = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="isokur.xsl"?>
<Tarih_Date Tarih="25.09.2026" Date="09/25/2026"  Bulten_No="2026/184" >
  <Currency CrossOrder="0" Kod="USD" CurrencyCode="USD">
      <Unit>1</Unit>
      <Isim>ABD DOLARI</Isim>
      <CurrencyName>US DOLLAR</CurrencyName>
      <ForexBuying>41.5012</ForexBuying>
      <ForexSelling>41.5760</ForexSelling>
      <BanknoteBuying>41.4721</BanknoteBuying>
      <BanknoteSelling>41.6384</BanknoteSelling>
        <CrossRateUSD/>
        <CrossRateOther/>
  </Currency>
  <Currency CrossOrder="9" Kod="EUR" CurrencyCode="EUR">
      <Unit>1</Unit>
      <Isim>EURO</Isim>
      <CurrencyName>EURO</CurrencyName>
      <ForexBuying>48.7001</ForexBuying>
      <ForexSelling>48.7879</ForexSelling>
  </Currency>
  <Currency CrossOrder="10" Kod="GBP" CurrencyCode="GBP">
      <Unit>1</Unit>
      <Isim>İNGİLİZ STERLİNİ</Isim>
      <CurrencyName>POUND STERLING</CurrencyName>
      <ForexBuying>55.9</ForexBuying>
  </Currency>
  <Currency CrossOrder="17" Kod="JPY" CurrencyCode="JPY">
      <Unit>100</Unit>
      <ForexBuying>27.9812</ForexBuying>
  </Currency>
</Tarih_Date>`;

describe("TCMB bulletins", () => {
  it("reads the date and the forex buying rates of the currencies used here", () => {
    expect(parseTcmbBulletin(BULLETIN)).toEqual({
      date: "2026-09-25",
      rates: { USD: 415_012, EUR: 487_001, GBP: 559_000 },
    });
  });

  it("refuses what isn't a bulletin", () => {
    expect(parseTcmbBulletin("<html>Not found</html>")).toBeNull();
    expect(
      parseTcmbBulletin('<Tarih_Date Tarih="31.02.2026"><Currency CurrencyCode="USD"></Currency>'),
    ).toBeNull();
    expect(parseTcmbBulletin('<Tarih_Date Tarih="25.09.2026"></Tarih_Date>')).toBeNull();
  });

  it("keeps rates exact", () => {
    expect(scaledRate("41.5012")).toBe(415_012);
    expect(scaledRate("41.5")).toBe(415_000);
    expect(scaledRate("41")).toBe(410_000);
    expect(scaledRate("41.50123")).toBeNull();
    expect(scaledRate("-1")).toBeNull();
    expect(scaledRate("0")).toBeNull();
    expect(formatRate(415_012)).toBe("41.5012");
    expect(formatRate(410_500, ",")).toBe("41,0500");
  });
});

describe("conversions", () => {
  const rates = { USD: 415_012, EUR: 487_001 };

  it("go through the lira, exactly", () => {
    expect(convertMinor(92_500, "USD", "TRY", rates)).toBe(3_838_861); // 925.00 × 41.5012 = 38,388.61
    expect(convertMinor(3_838_861, "TRY", "USD", rates)).toBe(92_500);
    expect(convertMinor(10_000, "EUR", "USD", rates)).toBe(11_735); // 100 € at 48.7001 / 41.5012
    expect(convertMinor(500, "TRY", "TRY", {})).toBe(500);
  });

  it("give nothing without a rate", () => {
    expect(convertMinor(100, "GBP", "TRY", rates)).toBeNull();
    expect(convertMinor(100, "TRY", "GBP", rates)).toBeNull();
  });

  it("use the last bulletin before the day, while it's recent", () => {
    const bulletins: Bulletin[] = [
      { date: "2026-09-10", rates },
      { date: "2026-09-24", rates },
      { date: "2026-09-25", rates },
    ];
    const book = { bulletins, empty: new Set<string>() };
    expect(bulletinFor(book, "2026-09-26")?.date).toBe("2026-09-25"); // Saturday
    expect(bulletinFor(book, "2026-09-28")?.date).toBe("2026-09-25"); // Monday: Friday's
    expect(bulletinFor(book, "2026-09-25")?.date).toBe("2026-09-24"); // not the same day's
    expect(bulletinFor(book, "2026-09-10")).toBeNull();
    expect(bulletinFor(book, "2026-09-23")).toBeNull(); // 13 days after the 10th: too old
    expect(bulletinFor({ bulletins: [], empty: new Set() }, "2026-09-26")).toBeNull();
  });

  it("never skip a business day whose bulletin is simply missing", () => {
    const bulletins: Bulletin[] = [{ date: "2026-09-09", rates }];
    // Tuesday the 15th needs Monday the 14th's: not on record, so the rate is missing, not the 9th's.
    expect(bulletinFor({ bulletins, empty: new Set() }, "2026-09-15")).toBeNull();
    // Unless the days in between are known to have had none (a holiday week).
    const holiday = new Set(["2026-09-10", "2026-09-11", "2026-09-14"]);
    expect(bulletinFor({ bulletins, empty: holiday }, "2026-09-15")?.date).toBe("2026-09-09");
    // Ten days at most.
    const long = new Set([
      "2026-09-10",
      "2026-09-11",
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
    ]);
    expect(bulletinFor({ bulletins, empty: long }, "2026-09-19")?.date).toBe("2026-09-09");
    expect(bulletinFor({ bulletins, empty: long }, "2026-09-20")).toBeNull();
  });
});

describe("receivables", () => {
  it("group unpaid invoices by how late they are", () => {
    expect(agingBucket(null, "2026-09-28")).toBe("current");
    expect(agingBucket("2026-09-28", "2026-09-28")).toBe("current");
    expect(agingBucket("2026-09-27", "2026-09-28")).toBe("1-30");
    expect(agingBucket("2026-08-29", "2026-09-28")).toBe("1-30");
    expect(agingBucket("2026-08-28", "2026-09-28")).toBe("31-60");
    expect(agingBucket("2026-07-01", "2026-09-28")).toBe("61-90");
    expect(agingBucket("2026-06-29", "2026-09-28")).toBe("90+");
  });
});

describe("recurring invoices", () => {
  it("fall on the plan's day of the month, or the month's last day", () => {
    expect(nextOccurrence("2026-01-31", "month", 31)).toBe("2026-02-28");
    expect(nextOccurrence("2026-02-28", "month", 31)).toBe("2026-03-31");
    expect(nextOccurrence("2028-01-30", "month", 30)).toBe("2028-02-29");
    expect(nextOccurrence("2026-11-15", "quarter", 15)).toBe("2027-02-15");
    expect(nextOccurrence("2028-02-29", "year", 29)).toBe("2029-02-28");
    expect(nextOccurrence("2026-12-01", "month", 1)).toBe("2027-01-01");
  });

  it("name the period an invoice covers", () => {
    expect(periodLabel("2026-10-01", "month")).toBe("October 2026");
    expect(periodLabel("2026-10-15", "quarter")).toBe("Oct–Dec 2026");
    expect(periodLabel("2026-12-01", "quarter")).toBe("Dec 2026 – Feb 2027");
    expect(periodLabel("2026-10-01", "year")).toBe("Oct 2026 – Sep 2027");
    expect(periodLabel("2026-01-01", "year")).toBe("Jan–Dec 2026");
    expect(withPeriod("Care plan: {period} ({period})", "October 2026")).toBe(
      "Care plan: October 2026 (October 2026)",
    );
  });
});

describe("the accountant's CSV", () => {
  const header = ["Date", "Party", "Amount", "Rate"];
  const rows = [
    ["2026-09-28", 'Ada "Countess" Lovelace, Ltd', { minor: -125_050 }, { rate: 415_012 }],
    ["2026-09-29", '=HYPERLINK("http://evil")', { minor: 5 }, null],
  ];

  it("writes the standard form", () => {
    expect(toCsv(header, rows, "standard")).toBe(
      '\ufeffDate,Party,Amount,Rate\r\n2026-09-28,"Ada ""Countess"" Lovelace, Ltd",-1250.50,41.5012\r\n' +
        '2026-09-29,"\'=HYPERLINK(""http://evil"")",0.05,\r\n',
    );
  });

  it("writes what Excel in Turkish opens as columns", () => {
    expect(toCsv(header, rows, "excel-tr")).toBe(
      '\ufeffDate;Party;Amount;Rate\r\n2026-09-28;"Ada ""Countess"" Lovelace, Ltd";-1250,50;41,5012\r\n' +
        '2026-09-29;"\'=HYPERLINK(""http://evil"")";0,05;\r\n',
    );
  });
});
