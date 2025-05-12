import { getESClient } from "./connection.js";
import { MCP_ERROR_CODES, createElasticsearchError, esOperationFailedError, invalidParamsError } from "./utils.js";

// Document Management Tools
export async function index_document(params) {
  const { index, id, document_body } = params;
  const esClient = getESClient();

  if (!index || typeof index !== "string") {
    throw invalidParamsError(null, "Missing or invalid 'index' parameter (string expected).");
  }
  if (!document_body || typeof document_body !== "object") {
    throw invalidParamsError(null, "Missing or invalid 'document_body' parameter (object expected).");
  }

  try {
    const response = await esClient.index({
      index: index,
      id: id, // if id is undefined, Elasticsearch will generate one
      document: document_body,
      refresh: "wait_for",
    });
    return response.body || response; // ES client v8 returns .body, older versions might return directly
  } catch (e) {
    console.error("Error in index_document (integrated):", e.meta ? e.meta.body : e);
    throw esOperationFailedError(null, e.message, e);
  }
}

export async function get_document(params) {
  const { index, id } = params;
  const esClient = getESClient();

  if (!index || typeof index !== "string") {
    throw invalidParamsError(null, "Missing or invalid 'index' parameter.");
  }
  if (!id || typeof id !== "string") {
    throw invalidParamsError(null, "Missing or invalid 'id' parameter.");
  }

  try {
    const response = await esClient.get({ index, id });
    return response.body || response;
  } catch (e) {
    if (e.meta && e.meta.statusCode === 404) {
        throw createElasticsearchError(MCP_ERROR_CODES.SERVER_ERROR_ES_OPERATION_FAILED, `Document with id '${id}' not found in index '${index}'.`, { statusCode: 404 });
    }
    console.error("Error in get_document (integrated):", e.meta ? e.meta.body : e);
    throw esOperationFailedError(null, e.message, e);
  }
}

export async function update_document(params) {
  const { index, id, update_body } = params;
  const esClient = getESClient();

  if (!index || typeof index !== "string") {
    throw invalidParamsError(null, "Missing or invalid 'index' parameter.");
  }
  if (!id || typeof id !== "string") {
    throw invalidParamsError(null, "Missing or invalid 'id' parameter.");
  }
  if (!update_body || typeof update_body !== "object") {
    throw invalidParamsError(null, "Missing or invalid 'update_body' parameter (e.g., { doc: { ... } } or { script: { ... } }).");
  }

  try {
    const response = await esClient.update({
      index,
      id,
      body: update_body,
      refresh: "wait_for",
    });
    return response.body || response;
  } catch (e) {
    console.error("Error in update_document (integrated):", e.meta ? e.meta.body : e);
    throw esOperationFailedError(null, e.message, e);
  }
}

export async function delete_document(params) {
  const { index, id } = params;
  const esClient = getESClient();

  if (!index || typeof index !== "string") {
    throw invalidParamsError(null, "Missing or invalid 'index' parameter.");
  }
  if (!id || typeof id !== "string") {
    throw invalidParamsError(null, "Missing or invalid 'id' parameter.");
  }

  try {
    const response = await esClient.delete({ index, id, refresh: "wait_for" });
    return response.body || response;
  } catch (e) {
    console.error("Error in delete_document (integrated):", e.meta ? e.meta.body : e);
    throw esOperationFailedError(null, e.message, e);
  }
}

export async function delete_by_query(params) {
    const { index, query_body } = params;
    const esClient = getESClient();

    if (!index || (typeof index !== "string" && !Array.isArray(index))) {
        throw invalidParamsError(null, "Missing or invalid 'index' parameter (string or array of strings expected).");
    }
    if (!query_body || typeof query_body !== "object") {
        throw invalidParamsError(null, "Missing or invalid 'query_body' parameter (Elasticsearch query DSL object expected).");
    }

    try {
        const response = await esClient.deleteByQuery({
            index: index,
            body: {
                query: query_body
            },
            refresh: true,
            conflicts: 'proceed'
        });
        return response.body || response;
    } catch (e) {
        console.error("Error in delete_by_query (integrated):", e.meta ? e.meta.body : e);
        throw esOperationFailedError(null, e.message, e);
    }
}

export async function bulk_operations(params) {
    const { operations } = params;
    const esClient = getESClient();

    if (!operations || !Array.isArray(operations)) {
        throw invalidParamsError(null, "Missing or invalid 'operations' parameter (array expected).");
    }
    if (operations.length === 0) {
        throw invalidParamsError(null, "'operations' array cannot be empty.");
    }

    try {
        const response = await esClient.bulk({ refresh: true, body: operations });
        return response.body || response;
    } catch (e) {
        console.error("Error in bulk_operations (integrated):", e.meta ? e.meta.body : e);
        throw esOperationFailedError(null, e.message, e);
    }
}

// Search Tools
export async function search_documents(params) {
  const { index, query_body, from, size, sort, _source } = params;
  const esClient = getESClient();

  if (!index || (typeof index !== "string" && !Array.isArray(index))) {
    throw invalidParamsError(null, "Missing or invalid 'index' parameter (string or array of strings expected).");
  }
  if (!query_body || typeof query_body !== "object") {
    throw invalidParamsError(null, "Missing or invalid 'query_body' (Elasticsearch query DSL object expected).");
  }

  try {
    const searchParams = {
      index: index,
      body: query_body, // In ES client v8, query_body is passed directly as `body`
    };
    if (from !== undefined) searchParams.from = from;
    if (size !== undefined) searchParams.size = size;
    if (sort) searchParams.sort = sort;
    if (_source) searchParams._source = _source;

    const response = await esClient.search(searchParams);
    return response.body || response; // .body contains hits, etc.
  } catch (e) {
    console.error("Error in search_documents (integrated):", e.meta ? e.meta.body : e);
    throw esOperationFailedError(null, e.message, e);
  }
}

export async function vector_search_documents(params) {
  const { index, vector_field, query_vector, k, filter, _source } = params;
  const esClient = getESClient();

  if (!index || typeof index !== "string") {
    throw invalidParamsError(null, "Missing or invalid 'index' parameter.");
  }
  if (!vector_field || typeof vector_field !== "string") {
    throw invalidParamsError(null, "Missing or invalid 'vector_field' parameter.");
  }
  if (!query_vector || !Array.isArray(query_vector)) {
    throw invalidParamsError(null, "Missing or invalid 'query_vector' parameter (array of numbers expected).");
  }
  if (k && typeof k !== "number") {
    throw invalidParamsError(null, "Invalid 'k' parameter (number expected).");
  }

  try {
    // Construct the k-NN query body
    // This structure can vary based on ES version and specific k-NN setup (e.g., script_score vs. direct knn query type)
    // Assuming a common k-NN query structure for ES 8.x+
    const knnQuery = {
      field: vector_field,
      query_vector: query_vector,
      k: k || 10,
      num_candidates: (k || 10) * 5, // Example: common practice to set num_candidates higher than k
    };
    if (filter) {
      knnQuery.filter = filter; // ES query DSL for filtering
    }

    const searchParams = {
      index: index,
      knn: knnQuery,
    };
    if (_source) searchParams._source = _source;
    
    const response = await esClient.search(searchParams);
    return response.body || response;
  } catch (e) {
    console.error("Error in vector_search_documents (integrated):", e.meta ? e.meta.body : e);
    throw esOperationFailedError(null, e.message, e);
  }
}

// Index Management Tools
export async function create_index_template(params) {
  const { name, template_body } = params;
  const esClient = getESClient();

  if (!name || typeof name !== "string") {
    throw invalidParamsError(null, "Missing or invalid 'name' parameter for template.");
  }
  if (!template_body || typeof template_body !== "object") {
    throw invalidParamsError(null, "Missing or invalid 'template_body' parameter.");
  }

  try {
    const response = await esClient.indices.putTemplate({ name, body: template_body });
    return response.body || response;
  } catch (e) {
    console.error("Error in create_index_template (integrated):", e.meta ? e.meta.body : e);
    throw esOperationFailedError(null, e.message, e);
  }
}

export async function create_index(params) {
  const { index, settings, mappings } = params;
  const esClient = getESClient();

  if (!index || typeof index !== "string") {
    throw invalidParamsError(null, "Missing or invalid 'index' parameter.");
  }

  try {
    const body = {};
    if (settings) body.settings = settings;
    if (mappings) body.mappings = mappings;
    const response = await esClient.indices.create({ index, body });
    return response.body || response;
  } catch (e) {
    console.error("Error in create_index (integrated):", e.meta ? e.meta.body : e);
    throw esOperationFailedError(null, e.message, e);
  }
}

export async function delete_index(params) {
  const { index } = params;
  const esClient = getESClient();

  if (!index || typeof index !== "string") {
    throw invalidParamsError(null, "Missing or invalid 'index' parameter.");
  }

  try {
    const response = await esClient.indices.delete({ index });
    return response.body || response;
  } catch (e) {
    console.error("Error in delete_index (integrated):", e.meta ? e.meta.body : e);
    throw esOperationFailedError(null, e.message, e);
  }
}

export async function get_index_mapping(params) {
  const { index } = params;
  const esClient = getESClient();

  if (!index || typeof index !== "string") {
    throw invalidParamsError(null, "Missing or invalid 'index' parameter.");
  }

  try {
    const response = await esClient.indices.getMapping({ index });
    return response.body || response;
  } catch (e) {
    console.error("Error in get_index_mapping (integrated):", e.meta ? e.meta.body : e);
    throw esOperationFailedError(null, e.message, e);
  }
}

// Cluster Tools
export async function get_cluster_health(params) {
  const esClient = getESClient();
  try {
    const response = await esClient.cluster.health(params || {}); // params can include level, local, etc.
    return response.body || response;
  } catch (e) {
    console.error("Error in get_cluster_health (integrated):", e.meta ? e.meta.body : e);
    throw esOperationFailedError(null, e.message, e);
  }
}

export async function get_cluster_stats(params) {
  const esClient = getESClient();
  try {
    const response = await esClient.cluster.stats(params || {}); // params can include node_id
    return response.body || response;
  } catch (e) {
    console.error("Error in get_cluster_stats (integrated):", e.meta ? e.meta.body : e);
    throw esOperationFailedError(null, e.message, e);
  }
}

