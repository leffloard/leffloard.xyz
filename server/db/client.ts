import "server-only";
import { MongoClient, type Db } from "mongodb";
import { getEnv } from "@/server/env";

type MongoState = { client: MongoClient; connecting: Promise<MongoClient> };

// One client per process; kept on globalThis so dev hot reloads don't open new pools.
const store = globalThis as typeof globalThis & { __leffloardMongo?: MongoState };

function createState(): MongoState {
  const client = new MongoClient(getEnv().MONGO_URL, {
    appName: "leffloard.xyz",
    serverSelectionTimeoutMS: 5_000,
    maxPoolSize: 10,
  });
  const connecting = client.connect().catch((error: unknown) => {
    delete store.__leffloardMongo;
    throw error;
  });
  return { client, connecting };
}

export async function getClient(): Promise<MongoClient> {
  store.__leffloardMongo ??= createState();
  return store.__leffloardMongo.connecting;
}

export async function getDb(): Promise<Db> {
  const client = await getClient();
  return client.db(getEnv().DB_NAME);
}

export async function closeClient(): Promise<void> {
  const state = store.__leffloardMongo;
  delete store.__leffloardMongo;
  if (state) await state.client.close();
}
