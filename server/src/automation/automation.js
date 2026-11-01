const path = require('path');
const fs = require('fs');
const { saveRun } = require('../storage/db');
const { generateCoverLetterDocx } = require('../export/docx');

const OUTPUTS_DIR = path.join(__dirname, '../../outputs');
const LETTERS_DIR = path.join(OUTPUTS_DIR, 'letters');
const DRAFTS_DIR = path.join(OUTPUTS_DIR, 'drafts');
const RECEIPTS_DIR = path.join(OUTPUTS_DIR, 'receipts');
const APPLICATIONS_CSV = path.join(OUTPUTS_DIR, 'applications_log.csv');

function ensureDirectories() {
  [OUTPUTS_DIR, LETTERS_DIR, DRAFTS_DIR, RECEIPTS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  // Ensure CSV header exists
  if (!fs.existsSync(APPLICATIONS_CSV)) {
    const header = 'run_id,timestamp,candidate_name,job_role,job_company,overall_score,pass_fail,docx_file\n';
    fs.writeFileSync(APPLICATIONS_CSV, header, 'utf8');
  }
}

/**
 * Creates standard RFC 822 .eml file content
 */
function buildEmlContent({ candidateName, candidateEmail, role, company, letter }) {
  const boundary = '----=_Part_0_' + Date.now();
  const dateStr = new Date().toUTCString();
  const fromAddr = candidateEmail ? `"${candidateName}" <${candidateEmail}>` : `"${candidateName}" <applicant@example.com>`;
  const toAddr = `recruiting@${company.toLowerCase().replace(/[^a-z0-9]/g, '') || 'company'}.com`;

  return [
    `Date: ${dateStr}`,
    `From: ${fromAddr}`,
    `To: ${toAddr}`,
    `Subject: Application: ${role} - ${candidateName}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: 8bit`,
    `X-Mailer: AI-Cover-Letter-Personalization-Tool`,
    ``,
    letter
  ].join('\r\n');
}

/**
 * Executes the 5-step trigger-action automation workflow.
 */
async function executeAutomationWorkflow({ pipelineResult, id = null, jobDescription = '', modelProvider = 'Gemini' }) {
  ensureDirectories();

  const runId = id || `run_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const timestamp = new Date().toISOString();
  const actions = [];

  const candidateProfile = pipelineResult.candidateProfile || {};
  const jobAnalysis = pipelineResult.jobAnalysis || {};
  const letterOutput = pipelineResult.letterOutput || {};
  const evaluation = pipelineResult.evaluation || {};
  const isPass = evaluation.rubric?.is_pass || false;
  const overallScore = evaluation.rubric?.overall || 0;

  // ACTION 1: Save run to SQLite
  try {
    const savedRecord = saveRun({
      id: runId,
      timestamp,
      candidateProfile,
      jobAnalysis,
      jobDescription,
      promptVersion: pipelineResult.promptVersion || 'v3',
      modelProvider,
      letterOutput,
      evaluation,
      latency_ms: pipelineResult.latency_ms || 0
    });
    actions.push({
      action: 'SAVE_TO_STORAGE',
      step: 1,
      status: 'SUCCESS',
      target: 'SQLite database table "runs"',
      timestamp: new Date().toISOString(),
      details: { run_id: runId }
    });
  } catch (err) {
    actions.push({
      action: 'SAVE_TO_STORAGE',
      step: 1,
      status: 'ERROR',
      target: 'SQLite database table "runs"',
      timestamp: new Date().toISOString(),
      error: err.message
    });
  }

  // ACTION 2: Export DOCX to outputs/letters/
  const docxFilename = `${runId}_Cover_Letter.docx`;
  const docxFilePath = path.join(LETTERS_DIR, docxFilename);
  try {
    const docxBuffer = await generateCoverLetterDocx({
      letter: letterOutput.letter || '',
      candidateName: candidateProfile.name || 'Candidate',
      role: jobAnalysis.role || '',
      company: jobAnalysis.company || ''
    });
    fs.writeFileSync(docxFilePath, docxBuffer);
    actions.push({
      action: 'EXPORT_DOCX',
      step: 2,
      status: 'SUCCESS',
      target: docxFilePath,
      file_name: docxFilename,
      bytes: docxBuffer.length,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    actions.push({
      action: 'EXPORT_DOCX',
      step: 2,
      status: 'ERROR',
      target: docxFilePath,
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }

  // ACTION 3: Append row to outputs/applications_log.csv
  try {
    const cleanCandidate = (candidateProfile.name || 'Candidate').replace(/,/g, ' ');
    const cleanRole = (jobAnalysis.role || 'Role').replace(/,/g, ' ');
    const cleanCompany = (jobAnalysis.company || 'Company').replace(/,/g, ' ');
    const passLabel = isPass ? 'PASS' : 'FAIL';
    const csvRow = `${runId},${timestamp},"${cleanCandidate}","${cleanRole}","${cleanCompany}",${overallScore},${passLabel},"${docxFilename}"\n`;
    fs.appendFileSync(APPLICATIONS_CSV, csvRow, 'utf8');
    actions.push({
      action: 'APPEND_CSV_LOG',
      step: 3,
      status: 'SUCCESS',
      target: APPLICATIONS_CSV,
      timestamp: new Date().toISOString(),
      logged_row: csvRow.trim()
    });
  } catch (err) {
    actions.push({
      action: 'APPEND_CSV_LOG',
      step: 3,
      status: 'ERROR',
      target: APPLICATIONS_CSV,
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }

  // ACTION 4: If evaluation passed, write .eml draft in outputs/drafts/
  const emlFilename = `${runId}_application.eml`;
  const emlFilePath = path.join(DRAFTS_DIR, emlFilename);
  if (isPass) {
    try {
      const emlContent = buildEmlContent({
        candidateName: candidateProfile.name || 'Applicant',
        candidateEmail: candidateProfile.contact?.email || '',
        role: jobAnalysis.role || 'Position',
        company: jobAnalysis.company || 'Company',
        letter: letterOutput.letter || ''
      });
      fs.writeFileSync(emlFilePath, emlContent, 'utf8');
      actions.push({
        action: 'CREATE_EMAIL_DRAFT',
        step: 4,
        status: 'SUCCESS',
        target: emlFilePath,
        file_name: emlFilename,
        timestamp: new Date().toISOString(),
        note: 'Evaluation passed (score >= 4.0 and zero unsupported claims); email draft generated.'
      });
    } catch (err) {
      actions.push({
        action: 'CREATE_EMAIL_DRAFT',
        step: 4,
        status: 'ERROR',
        target: emlFilePath,
        error: err.message,
        timestamp: new Date().toISOString()
      });
    }
  } else {
    actions.push({
      action: 'CREATE_EMAIL_DRAFT',
      step: 4,
      status: 'SKIPPED',
      target: emlFilePath,
      timestamp: new Date().toISOString(),
      reason: `Evaluation score (${overallScore}) did not meet PASS criteria (>= 4.0 and zero unsupported claims). Draft creation withheld.`
    });
  }

  // ACTION 5: Write execution receipt JSON in outputs/receipts/
  const receiptFilename = `${runId}_receipt.json`;
  const receiptFilePath = path.join(RECEIPTS_DIR, receiptFilename);
  const receipt = {
    receipt_id: `rcpt_${runId}`,
    run_id: runId,
    timestamp,
    candidate_name: candidateProfile.name || 'Candidate',
    job_role: jobAnalysis.role || 'Target Role',
    job_company: jobAnalysis.company || 'Target Company',
    overall_score: overallScore,
    pass_status: isPass ? 'PASS' : 'FAIL',
    unsupported_claims_count: (evaluation.unsupported_claims || []).length,
    actions_executed: actions,
    all_succeeded: actions.every(a => a.status === 'SUCCESS' || a.status === 'SKIPPED')
  };

  try {
    fs.writeFileSync(receiptFilePath, JSON.stringify(receipt, null, 2), 'utf8');
    actions.push({
      action: 'WRITE_RECEIPT_JSON',
      step: 5,
      status: 'SUCCESS',
      target: receiptFilePath,
      file_name: receiptFilename,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    actions.push({
      action: 'WRITE_RECEIPT_JSON',
      step: 5,
      status: 'ERROR',
      target: receiptFilePath,
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }

  return {
    run_id: runId,
    receipt,
    docxFilePath,
    emlFilePath: isPass ? emlFilePath : null,
    receiptFilePath
  };
}

module.exports = {
  executeAutomationWorkflow,
  OUTPUTS_DIR,
  LETTERS_DIR,
  DRAFTS_DIR,
  RECEIPTS_DIR,
  APPLICATIONS_CSV
};

