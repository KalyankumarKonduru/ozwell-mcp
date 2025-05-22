// imports/mcp/document-processor.js
import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { Buffer } from 'buffer';
import { generateEmbedding } from './embeddings.js';
import { repairPDF, extractTextFromBrokenPDF, extractPdfStreamText } from './pdf-utilities.js';

// Constants for chunking
const CHUNK_SIZE = 1000; // Characters per chunk
const CHUNK_OVERLAP = 200; // Overlap between chunks
const MAX_CHUNKS = 50; // Maximum number of chunks per document

/**
 * Extracts text from various file types
 * @param {Buffer} fileBuffer - The file buffer
 * @param {String} fileName - Original file name
 * @param {String} fileType - MIME type
 * @returns {Promise<Object>} Extracted text and metadata
 */
// Fix for imports/mcp/document-processor.js
// Replace the PDF processing section with this:

export async function extractTextFromFile(fileBuffer, fileName, fileType) {
  try {
    let extractedText = "";
    let extractionMethod = "none";
    let extractionSuccess = false;
    
    // PDF Processing (FIXED VERSION)
    if (fileType === "application/pdf" || fileName.endsWith('.pdf')) {
      console.log(`📄 Processing PDF: ${fileName} (${fileBuffer.length} bytes)`);
      
      // Method 1: Standard pdf-parse with proper error handling
      try {
        const pdfParse = require('pdf-parse');
        
        // Basic parsing first
        const pdfData = await pdfParse(fileBuffer);
        extractedText = pdfData.text || '';
        
        console.log(`📄 PDF parse result: ${extractedText.length} characters extracted`);
        console.log(`📄 First 100 chars: ${extractedText.substring(0, 100)}`);
        
        // Check if we got actual text (not binary data)
        if (extractedText && extractedText.length > 0 && isReadableText(extractedText)) {
          extractionMethod = "pdf_parse_standard";
          extractionSuccess = true;
          
          return {
            text: extractedText,
            method: extractionMethod,
            success: extractionSuccess,
            metadata: {
              pageCount: pdfData.numpages || null,
              info: pdfData.info || null,
              version: pdfData.version || null
            }
          };
        } else {
          console.warn("⚠️ PDF parsing returned unreadable text or binary data");
        }
      } catch (pdfError) {
        console.error("❌ Standard PDF parsing failed:", pdfError.message);
      }
      
      // Method 2: Try with different pdf-parse options
      try {
        console.log("🔄 Trying PDF parse with alternative options...");
        const pdfParse = require('pdf-parse');
        
        const options = {
          // More robust parsing options
          pagerender: function(pageData) {
            if (!pageData.getTextContent) {
              return Promise.resolve('');
            }
            
            return pageData.getTextContent({ 
              normalizeWhitespace: true,
              disableCombineTextItems: false 
            }).then(function(textContent) {
              let text = '';
              let lastY = -1;
              
              for (let item of textContent.items) {
                // Add line breaks for different Y positions
                if (lastY !== -1 && Math.abs(lastY - item.transform[5]) > 5) {
                  text += '\n';
                }
                text += item.str;
                if (item.hasEOL) {
                  text += '\n';
                } else {
                  text += ' ';
                }
                lastY = item.transform[5];
              }
              
              return text.trim();
            }).catch(function(error) {
              console.warn("Text content extraction failed:", error);
              return '';
            });
          }
        };
        
        const pdfData = await pdfParse(fileBuffer, options);
        extractedText = pdfData.text || '';
        
        console.log(`📄 Alternative PDF parse result: ${extractedText.length} characters`);
        
        if (extractedText && extractedText.length > 0 && isReadableText(extractedText)) {
          extractionMethod = "pdf_parse_alternative";
          extractionSuccess = true;
          
          return {
            text: extractedText,
            method: extractionMethod,
            success: extractionSuccess,
            metadata: {
              pageCount: pdfData.numpages || null,
              note: "Extracted using alternative PDF parsing method"
            }
          };
        }
      } catch (altError) {
        console.error("❌ Alternative PDF parsing failed:", altError.message);
      }
      
      // Method 3: Check if PDF is image-based (scanned)
      try {
        console.log("🔍 Checking if PDF contains only images...");
        
        // If we reach here, the PDF likely contains only images or is corrupted
        extractedText = "This PDF appears to contain scanned images or is corrupted. Text extraction failed. Please ensure the PDF contains selectable text or use OCR software to convert it to a text-searchable PDF.";
        extractionMethod = "pdf_image_or_corrupted";
        extractionSuccess = false;
        
        return {
          text: extractedText,
          method: extractionMethod,
          success: extractionSuccess,
          metadata: {
            note: "PDF appears to be image-based or corrupted"
          }
        };
      } catch (error) {
        console.error("❌ PDF analysis failed:", error);
      }
    }
    
    // Handle other file types (keep existing code)
    else if (fileType === "text/plain" || fileName.endsWith('.txt')) {
      extractedText = fileBuffer.toString('utf8');
      extractionMethod = "text_direct";
      extractionSuccess = true;
    } 
    else if (fileType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || 
             fileName.endsWith('.docx')) {
      try {
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ buffer: fileBuffer });
        extractedText = result.value;
        extractionMethod = "mammoth_docx";
        extractionSuccess = true;
        
        return {
          text: extractedText,
          method: extractionMethod,
          success: extractionSuccess,
          metadata: { messages: result.messages || [] }
        };
      } catch (docxError) {
        console.error("DOCX extraction error:", docxError);
        extractedText = `Error extracting text from DOCX: ${docxError.message}`;
        extractionMethod = "mammoth_docx_failed";
      }
    }
    else if (fileType === "application/vnd.ms-excel" || fileName.endsWith('.xls') ||
             fileType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || 
             fileName.endsWith('.xlsx')) {
      try {
        const XLSX = require('xlsx');
        const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
        
        extractedText = workbook.SheetNames.map(sheetName => {
          const sheet = workbook.Sheets[sheetName];
          const csv = XLSX.utils.sheet_to_csv(sheet);
          return `Sheet: ${sheetName}\n${csv}`;
        }).join('\n\n');
        
        extractionMethod = "xlsx";
        extractionSuccess = true;
        
        return {
          text: extractedText,
          method: extractionMethod,
          success: extractionSuccess,
          metadata: { 
            sheetNames: workbook.SheetNames,
            sheetCount: workbook.SheetNames.length
          }
        };
      } catch (xlsError) {
        console.error("Excel extraction error:", xlsError);
        extractedText = `Error extracting text from Excel: ${xlsError.message}`;
        extractionMethod = "xlsx_failed";
      }
    }
    else if (fileType === "application/json" || fileName.endsWith('.json')) {
      try {
        const jsonContent = JSON.parse(fileBuffer.toString('utf8'));
        extractedText = JSON.stringify(jsonContent, null, 2);
        extractionMethod = "json_parse";
        extractionSuccess = true;
      } catch (jsonError) {
        console.error("JSON parsing error:", jsonError);
        extractedText = `Error parsing JSON: ${jsonError.message}`;
        extractionMethod = "json_parse_failed";
      }
    }
    else if (fileType === "text/csv" || fileName.endsWith('.csv')) {
      extractedText = fileBuffer.toString('utf8');
      extractionMethod = "csv_direct";
      extractionSuccess = true;
    }
    else if (fileType === "text/html" || fileName.endsWith('.html') || fileName.endsWith('.htm')) {
      try {
        extractedText = fileBuffer.toString('utf8')
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        
        extractionMethod = "html_strip_tags";
        extractionSuccess = true;
      } catch (htmlError) {
        console.error("HTML parsing error:", htmlError);
        extractedText = `Error extracting text from HTML: ${htmlError.message}`;
        extractionMethod = "html_parse_failed";
      }
    }
    else {
      extractedText = `File type ${fileType} is not supported for text extraction.`;
      extractionMethod = "unsupported_format";
    }
    
    return {
      text: extractedText,
      method: extractionMethod,
      success: extractionSuccess
    };
  } catch (error) {
    console.error("Text extraction error:", error);
    return {
      text: `Error during text extraction: ${error.message}`,
      method: "extraction_error",
      success: false,
      error: error.message
    };
  }
}

/**
 * Check if extracted text is readable (not binary data)
 */
function isReadableText(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }
  
  // Check for readable characters vs binary/control characters
  const readableChars = text.match(/[a-zA-Z0-9\s.,!?;:()\-'"]/g) || [];
  const totalChars = text.length;
  
  // If less than 50% of characters are readable, consider it binary data
  const readableRatio = readableChars.length / totalChars;
  
  console.log(`📊 Text readability check: ${readableRatio.toFixed(2)} (${readableChars.length}/${totalChars})`);
  
  return readableRatio > 0.5;
}
/**
 * Chunk text into smaller pieces for better processing and embedding
 * @param {String} text - Full text to chunk
 * @param {Number} chunkSize - Size of each chunk in characters
 * @param {Number} overlap - Overlap between chunks in characters
 * @param {Number} maxChunks - Maximum number of chunks to create
 * @returns {Array<Object>} Array of chunk objects with text and metadata
 */
export function chunkText(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP, maxChunks = MAX_CHUNKS) {
  if (!text || text.length === 0) {
    return [];
  }
  
  // Split text into paragraphs first to try to maintain coherence
  const paragraphs = text.split(/\n\s*\n/);
  const chunks = [];
  let currentChunk = "";
  let chunkIndex = 0;
  
  for (const paragraph of paragraphs) {
    // If adding this paragraph would exceed the chunk size
    if (currentChunk.length + paragraph.length > chunkSize && currentChunk.length > 0) {
      // Add the current chunk to the chunks array
      chunks.push({
        text: currentChunk.trim(),
        index: chunkIndex++,
        charCount: currentChunk.trim().length
      });
      
      // Start a new chunk with overlap from the previous chunk
      if (currentChunk.length > overlap) {
        currentChunk = currentChunk.substring(currentChunk.length - overlap) + "\n\n";
      } else {
        currentChunk = "";
      }
    }
    
    // Add the paragraph to the current chunk
    currentChunk += paragraph + "\n\n";
  }
  
  // Add the last chunk if not empty
  if (currentChunk.trim().length > 0) {
    chunks.push({
      text: currentChunk.trim(),
      index: chunkIndex++,
      charCount: currentChunk.trim().length
    });
  }
  
  // Limit the number of chunks if specified
  return chunks.slice(0, maxChunks);
}

/**
 * Generate embeddings for text chunks
 * @param {Array<Object>} chunks - Array of text chunks
 * @returns {Promise<Array<Object>>} Chunks with embeddings
 */
export async function generateEmbeddingsForChunks(chunks) {
  const chunksWithEmbeddings = [];
  
  // Process chunks in batches to avoid overloading the API
  const BATCH_SIZE = 5;
  
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batchChunks = chunks.slice(i, i + BATCH_SIZE);
    const batchPromises = batchChunks.map(async (chunk) => {
      try {
        const embedding = await generateEmbedding(chunk.text);
        return {
          ...chunk,
          embedding
        };
      } catch (error) {
        console.error(`Error generating embedding for chunk ${chunk.index}:`, error);
        return {
          ...chunk,
          embedding: null,
          embeddingError: error.message
        };
      }
    });
    
    const processedBatch = await Promise.all(batchPromises);
    chunksWithEmbeddings.push(...processedBatch);
  }
  
  return chunksWithEmbeddings;
}

/**
 * Analyze text to extract structured information
 * @param {String} text - Text to analyze
 * @param {String} userContext - Additional context from user
 * @returns {Object} Structured data extracted from text
 */
export async function extractStructuredData(text, userContext = "") {
  // In a production system, this would call a more sophisticated analyzer,
  // possibly using Ozwell LLM or another AI service
  
  try {
    // Check for common patterns in the text
    const structuredData = {
      detection: {
        hasPersonalInfo: detectPersonalInfo(text),
        hasDateInfo: detectDates(text),
        hasNumericData: detectNumericData(text),
        documentType: detectDocumentType(text, userContext)
      },
      extractedFields: {}
    };
    
    // Based on document type, extract specific fields
    if (structuredData.detection.documentType.includes("medical") || 
        structuredData.detection.documentType.includes("health") ||
        structuredData.detection.documentType.includes("patient") ||
        structuredData.detection.documentType.includes("cardiac")) {
      structuredData.extractedFields = extractMedicalData(text);
    } else if (structuredData.detection.documentType.includes("financial") ||
              structuredData.detection.documentType.includes("invoice")) {
      structuredData.extractedFields = extractFinancialData(text);
    }
    
    return structuredData;
  } catch (error) {
    console.error("Error extracting structured data:", error);
    return {
      error: error.message,
      detection: {
        documentType: ["unknown"]
      }
    };
  }
}

// Helper functions for extractStructuredData
function detectPersonalInfo(text) {
  // Simple detection of names, emails, etc.
  const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/;
  const phonePattern = /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/;
  const ssnPattern = /\b\d{3}[-]?\d{2}[-]?\d{4}\b/;
  
  return {
    hasEmail: emailPattern.test(text),
    hasPhone: phonePattern.test(text),
    hasSSN: ssnPattern.test(text)
  };
}

function detectDates(text) {
  // Detect dates in various formats
  const datePattern = /\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/;
  return datePattern.test(text);
}

function detectNumericData(text) {
  // Detect if the text contains significant numeric data
  const numericPattern = /\b\d+\.\d+\b/;
  return numericPattern.test(text);
}

function detectDocumentType(text, userContext) {
  // Determine document type based on content and user context
  const types = [];
  
  if (/patient|doctor|medical|health|diagnosis|treatment|hospital|clinic/i.test(text + " " + userContext)) {
    types.push("medical");
  }
  
  if (/heart|cardiac|ecg|ekg|cardiology|pulse|rhythm|valve/i.test(text + " " + userContext)) {
    types.push("cardiac");
    types.push("health");
  }
  
  if (/invoice|payment|bill|amount|total|price|cost|charge|due|paid/i.test(text)) {
    types.push("financial");
    types.push("invoice");
  }
  
  if (/report|analysis|study|assessment|evaluation|summary/i.test(text)) {
    types.push("report");
  }
  
  if (types.length === 0) {
    types.push("general");
  }
  
  return types;
}

function extractMedicalData(text) {
  // Extract medical-specific data
  const fields = {};
  
  // Patient name (simplified)
  const nameMatch = text.match(/(?:patient name|name)[:\s]+([A-Za-z\s]+)/i);
  if (nameMatch && nameMatch[1]) {
    fields.patientName = nameMatch[1].trim();
  }
  
  // Dates (simplified)
  const dateMatch = text.match(/(?:date|dob|birth)[:\s]+(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i);
  if (dateMatch && dateMatch[1]) {
    fields.date = dateMatch[1].trim();
  }
  
  // Medical record number
  const mrnMatch = text.match(/(?:record|mrn|id)[:\s]+([A-Za-z0-9\-]+)/i);
  if (mrnMatch && mrnMatch[1]) {
    fields.recordNumber = mrnMatch[1].trim();
  }
  
  // Heart-related data
  if (/heart rate|pulse/i.test(text)) {
    const heartRateMatch = text.match(/heart rate|pulse[:\s]+(\d+)/i);
    if (heartRateMatch && heartRateMatch[1]) {
      fields.heartRate = parseInt(heartRateMatch[1].trim(), 10);
    }
  }
  
  if (/blood pressure/i.test(text)) {
    const bpMatch = text.match(/blood pressure[:\s]+(\d+)\/(\d+)/i);
    if (bpMatch && bpMatch[1] && bpMatch[2]) {
      fields.bloodPressure = {
        systolic: parseInt(bpMatch[1].trim(), 10),
        diastolic: parseInt(bpMatch[2].trim(), 10)
      };
    }
  }
  
  return fields;
}

function extractFinancialData(text) {
  // Extract financial-specific data
  const fields = {};
  
  // Total amount
  const amountMatch = text.match(/(?:total|amount|sum)[:\s]+[$]?(\d+(?:\.\d{2})?)/i);
  if (amountMatch && amountMatch[1]) {
    fields.totalAmount = parseFloat(amountMatch[1].trim());
  }
  
  // Invoice number
  const invoiceMatch = text.match(/(?:invoice|bill|ref)[:\s]+([A-Za-z0-9\-]+)/i);
  if (invoiceMatch && invoiceMatch[1]) {
    fields.invoiceNumber = invoiceMatch[1].trim();
  }
  
  // Date
  const dateMatch = text.match(/(?:date|issued)[:\s]+(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i);
  if (dateMatch && dateMatch[1]) {
    fields.date = dateMatch[1].trim();
  }
  
  return fields;
}