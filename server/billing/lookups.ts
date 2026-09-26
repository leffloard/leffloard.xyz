import "server-only";
import type { Db } from "mongodb";
import { services } from "@/content/services";
import type { Currency } from "@/lib/money";
import { clients, projects } from "@/server/work/collections";

// The choices the billing editors offer: clients with what fills a document's "For", their projects, and the
// services catalogue's packages as ready-made lines (list prices in US dollars).

export type BillingClient = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  currency: Currency;
};

export async function billingClients(db: Db): Promise<BillingClient[]> {
  const docs = await clients(db)
    .find({ status: { $ne: "archived" } }, { projection: { name: 1, company: 1, email: 1, currency: 1 } })
    .collation({ locale: "en", strength: 2 })
    .sort({ name: 1 })
    .limit(1000)
    .toArray();
  return docs.map((doc) => ({
    id: doc._id.toHexString(),
    name: doc.name,
    company: doc.company,
    email: doc.email,
    currency: doc.currency,
  }));
}

export async function billingProjects(db: Db): Promise<{ id: string; label: string; clientId: string }[]> {
  const docs = await projects(db)
    .find({ stage: { $ne: "cancelled" } }, { projection: { ref: 1, title: 1, clientId: 1 } })
    .sort({ updatedAt: -1 })
    .limit(500)
    .toArray();
  return docs.map((doc) => ({
    id: doc._id.toHexString(),
    label: `${doc.ref} · ${doc.title}`,
    clientId: doc.clientId.toHexString(),
  }));
}

export function serviceCatalog(): { label: string; description: string; unitPrice: string }[] {
  return services.flatMap((service) =>
    service.packages.map((pack) => ({
      label: `${service.title}: ${pack.name} (from $${pack.price.toLocaleString("en-US")}${pack.per ? ` a ${pack.per}` : ""})`,
      description: `${service.title}, ${pack.name}: ${pack.summary}`,
      unitPrice: String(pack.price),
    })),
  );
}
