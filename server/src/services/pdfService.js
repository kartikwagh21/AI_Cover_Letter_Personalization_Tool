const pdf = require('pdf-parse');

async function extractTextFromPDF(buffer) {
  if (!buffer || buffer.length === 0) {
    throw new Error('Empty PDF file uploaded.');
  }

  // Quick PDF header check
  const header = buffer.slice(0, 5).toString('ascii');
  if (!header.startsWith('%PDF-')) {
    throw new Error('Invalid file format. Please upload a valid PDF document.');
  }

  try {
    const data = await pdf(buffer);
    if (!data || typeof data.text !== 'string') {
      throw new Error('Could not extract readable text from PDF.');
    }
    return data.text.trim();
  } catch (error) {
    if (error.message && error.message.includes('Invalid file format')) {
      throw error;
    }
    console.error('Error parsing PDF:', error);
    throw new Error(`Failed to parse PDF resume: ${error.message}`);
  }
}

module.exports = {
  extractTextFromPDF
};
