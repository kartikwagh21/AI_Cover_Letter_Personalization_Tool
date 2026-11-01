const ExcelJS = require('exceljs');

/**
 * Builds a 3-sheet Excel workbook from the runs records.
 * Sheets: Inputs, Outputs, Evaluation
 */
async function generateRunsExcel(runs = []) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'AI Cover Letter Personalization Tool';
  workbook.created = new Date();

  // Sheet 1: Inputs
  const inputsSheet = workbook.addWorksheet('Inputs', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });
  inputsSheet.columns = [
    { header: 'Run ID', key: 'id', width: 25 },
    { header: 'Timestamp', key: 'timestamp', width: 22 },
    { header: 'Candidate Name', key: 'candidate_name', width: 20 },
    { header: 'Masked Summary', key: 'candidate_summary_masked', width: 35 },
    { header: 'Job Role', key: 'job_role', width: 22 },
    { header: 'Target Company', key: 'job_company', width: 20 },
    { header: 'Job Description', key: 'job_description', width: 40 },
    { header: 'Prompt Version', key: 'prompt_version', width: 15 },
    { header: 'Model Provider', key: 'model_provider', width: 18 }
  ];

  // Sheet 2: Outputs
  const outputsSheet = workbook.addWorksheet('Outputs', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });
  outputsSheet.columns = [
    { header: 'Run ID', key: 'id', width: 25 },
    { header: 'Timestamp', key: 'timestamp', width: 22 },
    { header: 'Candidate Name', key: 'candidate_name', width: 20 },
    { header: 'Target Role', key: 'job_role', width: 22 },
    { header: 'Target Company', key: 'job_company', width: 20 },
    { header: 'Generated Cover Letter', key: 'letter', width: 60 }
  ];

  // Sheet 3: Evaluation
  const evalSheet = workbook.addWorksheet('Evaluation', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });
  evalSheet.columns = [
    { header: 'Run ID', key: 'id', width: 25 },
    { header: 'Timestamp', key: 'timestamp', width: 22 },
    { header: 'Candidate Name', key: 'candidate_name', width: 20 },
    { header: 'Overall Score (0-5)', key: 'overall_score', width: 18 },
    { header: 'Pass / Fail', key: 'pass_fail', width: 14 },
    { header: 'Factual Accuracy (30%)', key: 'factual_accuracy', width: 22 },
    { header: 'Req Coverage (25%)', key: 'requirement_coverage', width: 20 },
    { header: 'Personalization (15%)', key: 'personalization', width: 20 },
    { header: 'Tone & Decor (15%)', key: 'tone_professionalism', width: 20 },
    { header: 'Structure (15%)', key: 'structure_grammar', width: 18 },
    { header: 'Unsupported Claims', key: 'unsupported_claims_count', width: 18 },
    { header: 'Latency (ms)', key: 'latency_ms', width: 14 }
  ];

  // Populate data
  for (const r of runs) {
    let rubric = {};
    let claims = [];
    try {
      rubric = typeof r.rubric_scores_json === 'string' ? JSON.parse(r.rubric_scores_json) : (r.rubric_scores_json || {});
      claims = typeof r.unsupported_claims_json === 'string' ? JSON.parse(r.unsupported_claims_json) : (r.unsupported_claims_json || []);
    } catch (e) {}

    const scores = rubric.scores || {};

    inputsSheet.addRow({
      id: r.id,
      timestamp: r.timestamp,
      candidate_name: r.candidate_name,
      candidate_summary_masked: r.candidate_summary_masked,
      job_role: r.job_role,
      job_company: r.job_company,
      job_description: r.job_description || '',
      prompt_version: r.prompt_version,
      model_provider: r.model_provider
    });

    outputsSheet.addRow({
      id: r.id,
      timestamp: r.timestamp,
      candidate_name: r.candidate_name,
      job_role: r.job_role,
      job_company: r.job_company,
      letter: r.letter || ''
    });

    evalSheet.addRow({
      id: r.id,
      timestamp: r.timestamp,
      candidate_name: r.candidate_name,
      overall_score: r.overall_score || 0,
      pass_fail: r.is_pass ? 'PASS' : 'FAIL',
      factual_accuracy: scores.factual_accuracy ?? 'N/A',
      requirement_coverage: scores.requirement_coverage ?? 'N/A',
      personalization: scores.personalization ?? 'N/A',
      tone_professionalism: scores.tone_professionalism ?? 'N/A',
      structure_grammar: scores.structure_grammar ?? 'N/A',
      unsupported_claims_count: claims.length,
      latency_ms: r.latency_ms || 0
    });
  }

  // Header styling
  [inputsSheet, outputsSheet, evalSheet].forEach(sheet => {
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF059669' } // Emerald green
    };
    headerRow.height = 24;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

module.exports = {
  generateRunsExcel
};

