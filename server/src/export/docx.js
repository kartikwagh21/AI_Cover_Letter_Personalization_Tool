const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require('docx');

/**
 * Generates a styled DOCX buffer from a cover letter string and candidate metadata.
 */
async function generateCoverLetterDocx({ letter = '', candidateName = 'Candidate', role = '', company = '' }) {
  const paragraphs = [];

  // Header / Candidate Name
  paragraphs.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.LEFT,
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: candidateName,
          bold: true,
          size: 32, // 16pt
          color: '059669', // Emerald brand tone
          font: 'Calibri'
        })
      ]
    })
  );

  if (role && company) {
    paragraphs.push(
      new Paragraph({
        spacing: { after: 300 },
        children: [
          new TextRun({
            text: `Application for ${role} at ${company}`,
            italics: true,
            size: 22, // 11pt
            color: '475569',
            font: 'Calibri'
          })
        ]
      })
    );
  }

  // Split letter into paragraphs
  const rawParagraphs = letter.split(/\n\s*\n/).filter(p => p.trim().length > 0);

  for (const block of rawParagraphs) {
    const cleanBlock = block.replace(/^#+\s*/, '').trim();
    paragraphs.push(
      new Paragraph({
        spacing: { after: 200, line: 276 }, // 1.15 line spacing
        children: [
          new TextRun({
            text: cleanBlock,
            size: 22, // 11pt
            font: 'Calibri',
            color: '1E293B'
          })
        ]
      })
    );
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440, // 1 inch
              bottom: 1440,
              left: 1440,
              right: 1440
            }
          }
        },
        children: paragraphs
      }
    ]
  });

  const buffer = await Packer.toBuffer(doc);
  return buffer;
}

module.exports = {
  generateCoverLetterDocx
};

