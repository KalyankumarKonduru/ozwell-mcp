import { Meteor } from "meteor/meteor";
import { MongoInternals } from "meteor/mongo";
import { ObjectId } from "mongodb"; // Natively available via Meteor's MongoDB driver
import { MCP_ERROR_CODES, createMongoError, dbOperationFailedError, invalidParamsError } from "./utils.js";

// Helper to get the default DB instance from Meteor
function getDefaultDB() {
  if (MongoInternals.defaultRemoteCollectionDriver && MongoInternals.defaultRemoteCollectionDriver.mongo && MongoInternals.defaultRemoteCollectionDriver.mongo.db) {
    return MongoInternals.defaultRemoteCollectionDriver.mongo.db;
  } else {
    // Fallback for older Meteor versions or different setups, though less common for default DB
    // This might require manual MONGO_URL parsing if not using the default driver's access
    console.warn("Could not access default MongoDB instance via MongoInternals. Ensure MONGO_URL is set.");
    // Attempt to connect manually if absolutely necessary, but this is not ideal for default DB
    // For specific, non-default DBs, a new MongoClient would be used.
    throw createMongoError(MCP_ERROR_CODES.SERVER_ERROR_DB_CONNECTION_FAILED, "Default MongoDB instance not accessible.");
  }
}

export async function find_documents(params, dbInstance) {
  const { collection, query, projection, sort, limit, skip } = params;
  const db = dbInstance || getDefaultDB();

  if (!collection || typeof collection !== "string") {
    throw invalidParamsError(null, "Missing or invalid 'collection' parameter (string expected).");
  }
  if (query && typeof query !== "object") {
    throw invalidParamsError(null, "Invalid 'query' parameter (object expected).");
  }

  try {
    let cursor = db.collection(collection).find(query || {});
    if (projection && typeof projection === "object") cursor = cursor.project(projection);
    if (sort && typeof sort === "object") cursor = cursor.sort(sort);
    if (typeof skip === "number" && skip > 0) cursor = cursor.skip(skip);
    if (typeof limit === "number" && limit > 0) cursor = cursor.limit(limit);
    
    const documents = await cursor.toArray();
    return documents;
  } catch (e) {
    console.error("Error in find_documents (integrated):", e);
    throw dbOperationFailedError(null, e.message);
  }
}

export async function insert_document(params, dbInstance) {
  const { collection, document } = params;
  const db = dbInstance || getDefaultDB();

  if (!collection || typeof collection !== "string") {
    throw invalidParamsError(null, "Missing or invalid 'collection' parameter.");
  }
  if (!document || (typeof document !== "object" && !Array.isArray(document))) {
    throw invalidParamsError(null, "Missing or invalid 'document' parameter (object or array expected).");
  }

  try {
    if (Array.isArray(document)) {
      const result = await db.collection(collection).insertMany(document);
      return { acknowledged: result.acknowledged, insertedCount: result.insertedCount, insertedIds: result.insertedIds };
    } else {
      const result = await db.collection(collection).insertOne(document);
      return { acknowledged: result.acknowledged, insertedId: result.insertedId };
    }
  } catch (e) {
    console.error("Error in insert_document (integrated):", e);
    throw dbOperationFailedError(null, e.message);
  }
}

export async function update_documents(params, dbInstance) {
  const { collection, query, update, options } = params;
  const db = dbInstance || getDefaultDB();

  if (!collection || typeof collection !== "string") {
    throw invalidParamsError(null, "Missing or invalid 'collection' parameter.");
  }
  if (!query || typeof query !== "object") {
    throw invalidParamsError(null, "Missing or invalid 'query' parameter.");
  }
  if (!update || typeof update !== "object") {
    throw invalidParamsError(null, "Missing or invalid 'update' parameter.");
  }

  try {
    const opOptions = options && typeof options === "object" ? options : {};
    let result;
    if (opOptions.multi === true || opOptions.updateMany === true) {
        delete opOptions.multi;
        delete opOptions.updateMany;
        result = await db.collection(collection).updateMany(query, update, opOptions);
    } else {
        result = await db.collection(collection).updateOne(query, update, opOptions);
    }
    return { 
        acknowledged: result.acknowledged, 
        matchedCount: result.matchedCount, 
        modifiedCount: result.modifiedCount, 
        upsertedCount: result.upsertedCount,
        upsertedId: result.upsertedId 
    };
  } catch (e) {
    console.error("Error in update_documents (integrated):", e);
    throw dbOperationFailedError(null, e.message);
  }
}

export async function delete_documents(params, dbInstance) {
  const { collection, query, options } = params;
  const db = dbInstance || getDefaultDB();

  if (!collection || typeof collection !== "string") {
    throw invalidParamsError(null, "Missing or invalid 'collection' parameter.");
  }
  if (!query || typeof query !== "object") {
    throw invalidParamsError(null, "Missing or invalid 'query' parameter.");
  }

  try {
    const opOptions = options && typeof options === "object" ? options : {};
    let result;
    if (opOptions.justOne === true || opOptions.deleteOne === true) {
        delete opOptions.justOne;
        delete opOptions.deleteOne;
        result = await db.collection(collection).deleteOne(query, opOptions);
    } else {
        result = await db.collection(collection).deleteMany(query, opOptions);
    }
    return { acknowledged: result.acknowledged, deletedCount: result.deletedCount };
  } catch (e) {
    console.error("Error in delete_documents (integrated):", e);
    throw dbOperationFailedError(null, e.message);
  }
}

export async function count_documents(params, dbInstance) {
  const { collection, query } = params;
  const db = dbInstance || getDefaultDB();

  if (!collection || typeof collection !== "string") {
    throw invalidParamsError(null, "Missing or invalid 'collection' parameter.");
  }
  if (query && typeof query !== "object") {
    throw invalidParamsError(null, "Invalid 'query' parameter (object expected).");
  }

  try {
    const count = await db.collection(collection).countDocuments(query || {});
    return count;
  } catch (e) {
    console.error("Error in count_documents (integrated):", e);
    throw dbOperationFailedError(null, e.message);
  }
}

export async function list_collections(params, dbInstance) {
  const { database } = params; // Optional: allow specifying a different database
  const db = dbInstance || getDefaultDB();
  try {
    const currentDb = database ? db.client.db(database) : db;
    const collections = await currentDb.listCollections().toArray();
    return collections.map(col => col.name);
  } catch (e) {
    console.error("Error in list_collections (integrated):", e);
    throw dbOperationFailedError(null, e.message);
  }
}

export async function get_collection_info(params, dbInstance) {
  const { collection } = params;
  const db = dbInstance || getDefaultDB();

  if (!collection || typeof collection !== "string") {
    throw invalidParamsError(null, "Missing or invalid 'collection' parameter.");
  }
  try {
    const stats = await db.collection(collection).stats();
    const indexes = await db.collection(collection).listIndexes().toArray();
    const options = await db.collection(collection).options();
    return {
      name: collection,
      stats: {
        ns: stats.ns,
        count: stats.count,
        size: stats.size,
        storageSize: stats.storageSize,
        avgObjSize: stats.avgObjSize,
        nindexes: stats.nindexes,
      },
      indexes: indexes.map(idx => ({ name: idx.name, key: idx.key, unique: !!idx.unique, sparse: !!idx.sparse })),
      options: options,
    };
  } catch (e) {
    console.error("Error in get_collection_info (integrated):", e);
    throw dbOperationFailedError(null, e.message);
  }
}

export async function get_schema_sample(params, dbInstance) {
  const { collection, sample_size = 20 } = params;
  const db = dbInstance || getDefaultDB();

  if (!collection || typeof collection !== "string") {
    throw invalidParamsError(null, "Missing or invalid 'collection' parameter.");
  }
  if (typeof sample_size !== "number" || sample_size <= 0) {
    throw invalidParamsError(null, "Invalid 'sample_size' parameter (positive number expected).");
  }

  try {
    const documents = await db.collection(collection).find().limit(sample_size).toArray();
    return documents;
  } catch (e) {
    console.error("Error in get_schema_sample (integrated):", e);
    throw dbOperationFailedError(null, e.message);
  }
}

export async function create_index(params, dbInstance) {
  const { collection, keys, options } = params;
  const db = dbInstance || getDefaultDB();

  if (!collection || typeof collection !== "string") {
    throw invalidParamsError(null, "Missing or invalid 'collection' parameter.");
  }
  if (!keys || typeof keys !== "object") {
    throw invalidParamsError(null, "Missing or invalid 'keys' parameter (object expected).");
  }
  const opOptions = options && typeof options === "object" ? options : {};

  try {
    const indexName = await db.collection(collection).createIndex(keys, opOptions);
    return { indexName };
  } catch (e) {
    console.error("Error in create_index (integrated):", e);
    throw dbOperationFailedError(null, e.message);
  }
}

export async function drop_index(params, dbInstance) {
  const { collection, index_name } = params;
  const db = dbInstance || getDefaultDB();

  if (!collection || typeof collection !== "string") {
    throw invalidParamsError(null, "Missing or invalid 'collection' parameter.");
  }
  if (!index_name || typeof index_name !== "string") {
    throw invalidParamsError(null, "Missing or invalid 'index_name' parameter.");
  }

  try {
    const result = await db.collection(collection).dropIndex(index_name);
    return result;
  } catch (e) {
    console.error("Error in drop_index (integrated):", e);
    throw dbOperationFailedError(null, e.message);
  }
}

export async function list_indexes(params, dbInstance) {
  const { collection } = params;
  const db = dbInstance || getDefaultDB();

  if (!collection || typeof collection !== "string") {
    throw invalidParamsError(null, "Missing or invalid 'collection' parameter.");
  }

  try {
    const indexes = await db.collection(collection).listIndexes().toArray();
    return indexes;
  } catch (e) {
    console.error("Error in list_indexes (integrated):", e);
    throw dbOperationFailedError(null, e.message);
  }
}

export async function list_databases(params, dbInstance) {
  const db = dbInstance || getDefaultDB();
  try {
    const adminDb = db.client.db("admin");
    const dbs = await adminDb.admin().listDatabases();
    return dbs.databases;
  } catch (e) {
    console.error("Error in list_databases (integrated):", e);
    throw dbOperationFailedError(null, e.message);
  }
}

export async function get_db_stats(params, dbInstance) {
    const { database } = params;
    const db = dbInstance || getDefaultDB();
    try {
        const targetDb = database ? db.client.db(database) : db;
        const stats = await targetDb.stats();
        return stats;
    } catch (e) {
        console.error("Error in get_db_stats (integrated):", e);
        throw dbOperationFailedError(null, e.message);
    }
}

export async function run_aggregation(params, dbInstance) {
  const { collection, pipeline } = params;
  const db = dbInstance || getDefaultDB();

  if (!collection || typeof collection !== "string") {
    throw invalidParamsError(null, "Missing or invalid 'collection' parameter.");
  }
  if (!pipeline || !Array.isArray(pipeline)) {
    throw invalidParamsError(null, "Missing or invalid 'pipeline' parameter (array expected).");
  }
  if (pipeline.length === 0) {
    throw invalidParamsError(null, "'pipeline' parameter cannot be an empty array.");
  }

  try {
    const results = await db.collection(collection).aggregate(pipeline).toArray();
    return results;
  } catch (e) {
    console.error("Error in run_aggregation (integrated):", e);
    throw dbOperationFailedError(null, e.message);
  }
}

// Note: ObjectId is directly available from 'mongodb' package which Meteor uses.
// No need for a separate connection.js for MongoDB if using Meteor's default DB.
// The tools will use MongoInternals.defaultRemoteCollectionDriver().mongo.db by default.

