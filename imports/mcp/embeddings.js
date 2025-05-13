// imports/mcp/embeddings.js
import { Meteor } from "meteor/meteor";
import { HTTP } from "meteor/http";

/**
 * Generates an embedding vector for the given text using the configured API
 * @param {string} text - Text to generate embeddings for
 * @returns {Promise<Array<number>>} - The embedding vector as an array of numbers
 */
export async function generateEmbedding(text) {
  const EMBEDDINGS_API_URL = Meteor.settings.private?.EMBEDDINGS_API_URL;
  const EMBEDDINGS_API_KEY = Meteor.settings.private?.EMBEDDINGS_API_KEY;
  const EMBEDDINGS_MODEL = Meteor.settings.private?.EMBEDDINGS_MODEL || "text-embedding-3-small";
  
  if (!EMBEDDINGS_API_URL || !EMBEDDINGS_API_KEY) {
    console.warn("Embeddings API URL or Key is not configured in settings.json");
    return createPlaceholderEmbedding();
  }
  
  try {
    // Extract and clean the text
    const cleanedText = text.trim().substring(0, 8192); // Limit to 8k chars (typical limit)
    
    // Make the API call
    const response = await HTTP.call("POST", EMBEDDINGS_API_URL, {
      headers: {
        "Authorization": `Bearer ${EMBEDDINGS_API_KEY}`,
        "Content-Type": "application/json",
      },
      data: {
        input: cleanedText,
        model: EMBEDDINGS_MODEL
      },
      timeout: 20000, // 20 seconds timeout
    });
    
    // Handle different API response formats
    let embeddingVector;
    if (response.data.data && response.data.data[0] && response.data.data[0].embedding) {
      // OpenAI-like format
      embeddingVector = response.data.data[0].embedding;
    } else if (response.data.embedding) {
      // Direct embedding format
      embeddingVector = response.data.embedding;
    } else if (response.data.embeddings && response.data.embeddings[0]) {
      // Array of embeddings format
      embeddingVector = response.data.embeddings[0];
    } else {
      console.error("Unexpected embedding API response format:", response.data);
      throw new Error("Unexpected embedding API response format");
    }
    
    if (!Array.isArray(embeddingVector) || embeddingVector.length === 0) {
      throw new Error("Invalid embedding vector received");
    }
    
    return embeddingVector;
  } catch (error) {
    console.error("Error generating embedding:", error.message);
    console.error("Response:", error.response?.data);
    
    // In case of failure, return a placeholder embedding
    return createPlaceholderEmbedding();
  }
}

/**
 * Creates a placeholder embedding vector for fallback when the API fails
 * @param {number} dimensions - The number of dimensions for the embedding vector
 * @returns {Array<number>} - A random embedding vector
 */
function createPlaceholderEmbedding(dimensions = 384) {
  console.warn(`Generating placeholder embedding vector with ${dimensions} dimensions`);
  // Create a consistent but random embedding using a seed based on the time
  const seed = Date.now() % 1000;
  const vector = Array(dimensions).fill(0);
  
  // Simple pseudorandom number generator with seed
  let value = seed;
  for (let i = 0; i < dimensions; i++) {
    value = (value * 9301 + 49297) % 233280;
    // Generate values between -0.5 and 0.5
    vector[i] = (value / 233280) - 0.5;
  }
  
  return vector;
}

/**
 * Calculates cosine similarity between two vectors
 * @param {Array<number>} vector1 - First vector
 * @param {Array<number>} vector2 - Second vector
 * @returns {number} - Cosine similarity (-1 to 1)
 */
export function cosineSimilarity(vector1, vector2) {
  if (!vector1 || !vector2 || vector1.length !== vector2.length) {
    throw new Error("Invalid vectors for cosine similarity calculation");
  }
  
  let dotProduct = 0;
  let magnitude1 = 0;
  let magnitude2 = 0;
  
  for (let i = 0; i < vector1.length; i++) {
    dotProduct += vector1[i] * vector2[i];
    magnitude1 += vector1[i] * vector1[i];
    magnitude2 += vector2[i] * vector2[i];
  }
  
  magnitude1 = Math.sqrt(magnitude1);
  magnitude2 = Math.sqrt(magnitude2);
  
  if (magnitude1 === 0 || magnitude2 === 0) {
    return 0;
  }
  
  return dotProduct / (magnitude1 * magnitude2);
}