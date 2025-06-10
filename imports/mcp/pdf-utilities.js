import { Meteor } from 'meteor/meteor';
import { Buffer } from 'buffer';

/**
 * Attempts to repair common PDF issues
 * @param {Buffer} pdfBuffer - The potentially corrupt PDF buffer
 * @returns {Promise<Buffer>} Repaired PDF buffer
 */
export async function repairPDF(pdfBuffer) {
  try {
    // Check if the PDF starts with the PDF header
    const pdfHeader = '%PDF-';
    const bufferStart = pdfBuffer.slice(0, 10).toString('ascii');
    
    if (!bufferStart.startsWith(pdfHeader)) {
      console.warn("PDF header missing, attempting to fix...");
      
      // Try to find the PDF header elsewhere in the file (sometimes there's junk at the start)
      const pdfString = pdfBuffer.toString('ascii', 0, Math.min(1024, pdfBuffer.length));
      const headerIndex = pdfString.indexOf(pdfHeader);
      
      if (headerIndex > 0) {
        // Remove junk before the PDF header
        pdfBuffer = pdfBuffer.slice(headerIndex);
        console.log("Removed junk data before PDF header");
      } else {
        // If we can't find the header, add it
        const newBuffer = Buffer.concat([
          Buffer.from('%PDF-1.4\n'),
          pdfBuffer
        ]);
        pdfBuffer = newBuffer;
        console.log("Added missing PDF header");
      }
    }
    
    // Check for and fix truncated files by ensuring proper EOF marker
    const lastBytes = pdfBuffer.slice(Math.max(0, pdfBuffer.length - 30)).toString('ascii');
    if (!lastBytes.includes('%%EOF')) {
      console.warn("PDF EOF marker missing, attempting to fix...");
      
      // Add EOF marker
      const newBuffer = Buffer.concat([
        pdfBuffer,
        Buffer.from('\n%%EOF\n')
      ]);
      pdfBuffer = newBuffer;
      console.log("Added missing PDF EOF marker");
    }
    
    // Attempt to fix damaged cross-reference table (XRef)
    // This is a simplified approach - a real implementation would
    // parse the PDF structure and rebuild the XRef table
    if (detectXRefIssue(pdfBuffer)) {
      console.warn("XRef table issues detected, attempting basic repair...");
      pdfBuffer = fixXRefIssues(pdfBuffer);
    }
    
    return pdfBuffer;
  } catch (error) {
    console.error("Error repairing PDF:", error);
    // Return the original buffer if repair fails
    return pdfBuffer;
  }
}

/**
 * Detect common XRef table issues in PDFs
 * @param {Buffer} pdfBuffer - The PDF buffer to check
 * @returns {boolean} True if XRef issues detected
 */
function detectXRefIssue(pdfBuffer) {
  try {
    // Convert the last portion of the PDF to a string to look for XRef markers
    const tailPortion = pdfBuffer.slice(Math.max(0, pdfBuffer.length - 1024)).toString('ascii');
    
    // Check for damaged or missing xref table indicators
    const hasXrefMarker = /xref\s+\d+\s+\d+/i.test(tailPortion);
    const hasStartxref = /startxref\s+\d+/i.test(tailPortion);
    
    return !hasXrefMarker || !hasStartxref;
  } catch (error) {
    console.error("Error detecting XRef issues:", error);
    return false;
  }
}

/**
 * Attempt to fix common XRef table issues
 * @param {Buffer} pdfBuffer - The PDF buffer to fix
 * @returns {Buffer} Repaired PDF buffer
 */
function fixXRefIssues(pdfBuffer) {
  try {

    const pdfString = pdfBuffer.toString('ascii');
    
    if (pdfString.includes('startxref')) {
      return pdfBuffer;
    }
    
    const xrefAddition = `
xref
0 1
0000000000 65535 f
trailer
<< /Size 1 /Root 1 0 R >>
startxref
0
%%EOF
`;
    
    // Remove any existing EOF marker
    let processedBuffer = pdfBuffer;
    if (pdfString.includes('%%EOF')) {
      const eofIndex = pdfString.lastIndexOf('%%EOF');
      processedBuffer = pdfBuffer.slice(0, eofIndex);
    }
    
    // Add our xref structure
    return Buffer.concat([
      processedBuffer,
      Buffer.from(xrefAddition)
    ]);
  } catch (error) {
    console.error("Error fixing XRef issues:", error);
    return pdfBuffer;
  }
}

/**
 * Alternative approach to extract text when PDF parsing fails
 * @param {Buffer} pdfBuffer - The PDF buffer
 * @returns {Promise<string>} Extracted text
 */
export async function extractTextFromBrokenPDF(pdfBuffer) {
  try {
    // Try to repair the PDF first
    const repairedBuffer = await repairPDF(pdfBuffer);
    
    // Convert to string and look for text patterns
    const pdfString = repairedBuffer.toString('utf8', 0, Math.min(repairedBuffer.length, 2000000));
    
    let extractedText = '';
    
    // 1. Look for content between BT (Begin Text) and ET (End Text) markers
    const btEtRegex = /BT\s*(.*?)\s*ET/gs;
    let matches = [...pdfString.matchAll(btEtRegex)];
    for (const match of matches) {
      if (match[1]) {
        // Clean up the text content
        const cleaned = cleanPdfTextContent(match[1]);
        if (cleaned.length > 1) {
          extractedText += cleaned + '\n';
        }
      }
    }
    
    // 2. Look for text in parentheses after Tj, TJ, Tx operators
    const textOperatorRegex = /\/(Tj|TJ|Tx|T\*)\s*\(([^)]+)\)/g;
    matches = [...pdfString.matchAll(textOperatorRegex)];
    for (const match of matches) {
      if (match[2]) {
        const cleaned = cleanPdfTextContent(match[2]);
        if (cleaned.length > 1) {
          extractedText += cleaned + '\n';
        }
      }
    }
    
    // 3. Look for strings in parentheses (often contain text content)
    const parensRegex = /\(([^\)\\]{3,}(?:\\.[^\)\\]*)*)\)/g;
    matches = [...pdfString.matchAll(parensRegex)];
    for (const match of matches) {
      if (match[1]) {
        const cleaned = cleanPdfTextContent(match[1]);
        if (cleaned.length > 1) {
          extractedText += cleaned + '\n';
        }
      }
    }
    
    // 4. Look for hex-encoded text strings (common in some PDFs)
    const hexRegex = /<([0-9A-Fa-f]{4,})>/g;
    matches = [...pdfString.matchAll(hexRegex)];
    for (const match of matches) {
      if (match[1]) {
        try {
          // Convert hex to text
          let hexText = '';
          for (let i = 0; i < match[1].length; i += 2) {
            if (i + 1 < match[1].length) {
              const hexPair = match[1].substr(i, 2);
              const charCode = parseInt(hexPair, 16);
              if (charCode >= 32 && charCode <= 126) { // Printable ASCII
                hexText += String.fromCharCode(charCode);
              }
            }
          }
          
          if (hexText.length > 2) {
            extractedText += hexText + '\n';
          }
        } catch (e) {
          // Ignore hex parsing errors
        }
      }
    }
    
    // Remove excessive newlines and spaces
    extractedText = extractedText
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\s+/g, ' ')
      .trim();
    
    return extractedText || "Text extraction failed from broken PDF";
  } catch (error) {
    console.error("Error extracting text from broken PDF:", error);
    return "Error extracting text from PDF: " + error.message;
  }
}

/**
 * Clean up text content extracted from PDF
 * @param {string} text - Raw PDF text content
 * @returns {string} Cleaned text
 */
function cleanPdfTextContent(text) {
  return text
    .replace(/\\(\d{3})/g, (m, code) => String.fromCharCode(parseInt(code, 8))) // Convert octal escapes
    .replace(/\\n/g, '\n') // Convert newline escapes
    .replace(/\\r/g, '\r') // Convert return escapes
    .replace(/\\t/g, '\t') // Convert tab escapes
    .replace(/\\\\/g, '\\') // Convert backslash escapes
    .replace(/\\\(/g, '(') // Convert escaped parentheses
    .replace(/\\\)/g, ')') // Convert escaped parentheses
    .replace(/[^\x20-\x7E\r\n\t]/g, ' ') // Keep only ASCII printable characters and whitespace
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

/**
 * Extract text from PDF by interpreting PDF content streams directly
 * This is a more robust method for extremely corrupted PDFs
 * @param {Buffer} pdfBuffer - PDF buffer
 * @returns {string} Extracted text
 */
export function extractPdfStreamText(pdfBuffer) {
  try {
    // Convert buffer to string for processing
    const pdfData = pdfBuffer.toString('latin1');
    
    // Identify all object streams
    const streamRegex = /stream\s([\s\S]*?)\sendstream/g;
    const streams = [...pdfData.matchAll(streamRegex)].map(match => match[1]);
    
    let extractedText = '';
    
    // Process each stream
    for (const stream of streams) {
      // Look for text in the stream
      const textMatches = stream.match(/\(([^\)\\]+(?:\\.[^\)\\]*)*)\)/g) || [];
      
      for (const match of textMatches) {
        const text = match.substring(1, match.length - 1)
          .replace(/\\(\d{3})/g, (m, code) => String.fromCharCode(parseInt(code, 8)))
          .replace(/\\\(/g, '(')
          .replace(/\\\)/g, ')')
          .replace(/\\\\/g, '\\');
        
        if (text.length > 1 && /[a-zA-Z0-9]/.test(text)) {
          extractedText += text + ' ';
        }
      }
    }
    
    return extractedText.trim() || 'No text extracted from streams';
  } catch (error) {
    console.error('Error extracting text from PDF streams:', error);
    return 'Error extracting text from PDF streams';
  }
}