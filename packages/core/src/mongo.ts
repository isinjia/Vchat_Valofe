import { MongoClient, Db, Collection } from "mongodb";
import { env } from "./env";
import type { ChatMessage } from "./types";

const g = globalThis as unknown as { __vchatbotMongo?: Promise<Db> };

export function getMongoDb(): Promise<Db> {
  if (!g.__vchatbotMongo) {
    g.__vchatbotMongo = (async () => {
      const client = new MongoClient(env("MONGODB_URI", "mongodb://127.0.0.1:27017"));
      await client.connect();
      const db = client.db(env("MONGODB_DB", "vchatbot"));
      await db
        .collection("chat_messages")
        .createIndex({ userId: 1, characterId: 1, createdAt: 1 });
      return db;
    })();
  }
  return g.__vchatbotMongo;
}

export async function chatMessages(): Promise<Collection<ChatMessage>> {
  const db = await getMongoDb();
  return db.collection<ChatMessage>("chat_messages");
}
