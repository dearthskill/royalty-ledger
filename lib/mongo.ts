// MongoDB access: one shared client per server process.
import { MongoClient, type Db } from 'mongodb';

const globalForMongo = globalThis as unknown as { mongoClient?: Promise<MongoClient> };

export async function mongoDb(): Promise<Db> {
  if (!globalForMongo.mongoClient) {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
    globalForMongo.mongoClient = MongoClient.connect(process.env.MONGODB_URI);
  }
  const client = await globalForMongo.mongoClient;
  return client.db(process.env.MONGODB_DB || 'royalty_events');
}
