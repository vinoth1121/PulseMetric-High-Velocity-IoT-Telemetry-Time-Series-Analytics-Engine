import { MongoClient, Db, Collection } from 'mongodb';
import dotenv from 'dotenv';
import { CanonicalReading } from '../adapters/types.js';

dotenv.config();

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/pulsemetric';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function getDb(): Promise<Db> {
  if (db && client) {
    return db;
  }

  client = new MongoClient(uri, {
    maxPoolSize: 20,
    minPoolSize: 2,
    maxIdleTimeMS: 30000,
    connectTimeoutMS: 10000,
    serverSelectionTimeoutMS: 10000
  });

  await client.connect();
  db = client.db();
  return db;
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

export async function getCollections() {
  const database = await getDb();
  return {
    readingsHot: database.collection<CanonicalReading>('readings_hot'),
    readingsLate: database.collection<CanonicalReading>('readings_late'),
    rollup5m: database.collection('rollup_5m'),
    rollup1h: database.collection('rollup_1h'),
    alerts: database.collection('alerts'),
    deadLetter: database.collection('dead_letter'),
    deviceRegistry: database.collection('device_registry'),
    db: database
  };
}
