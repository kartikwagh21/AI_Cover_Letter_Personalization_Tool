const path = require('path');
const fs = require('fs');
const { stage1Intake } = require('../pipeline/stage1Intake');
const { runPipeline } = require('../pipeline/pipeline');
const { executeAutomationWorkflow, scanInbox, LETTERS_DIR } = require('../automation/automation');
const { getRuns, getRunById } = require('../storage/db');
const { generateCoverLetterDocx } = require('../export/docx');
const { generateRunsExcel } = require('../export/excel');
const { getLLMStatus } = require('../llm/llmClient');

/**
 * POST /api/profile/extract
 * Extracts structured profile from uploaded PDF and/or form fields for human verification review.
 */
async function extractProfile(req, res, next) {
  try {
    const fileBuffer = req.file ? req.file.buffer : null;
    const formFields = req.body || {};

    const { profile, warnings, rawExtractedText } = await stage1Intake({
      fileBuffer,
      formFields
    });

    return res.status(200).json({
      success: true,
      profile,
      warnings,
      hasResumeText: !!rawExtractedText
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/generate
 * Executes 4-stage pipeline and trigger-action automation.
 */
async function generateCoverLetter(req, res, next) {
  try {
    const {
      verifiedProfile,
      jobDescription,
      role,
      company,
      tone = 'Formal',
      length = 'medium',
      promptVersion = 'v3',
      confirmed
    } = req.body;

    // Hard requirement: candidate profile must be confirmed by user
    if (!confirmed && (!verifiedProfile || !verifiedProfile.is_confirmed)) {
      return res.status(400).json({
        success: false,
        error: 'Candidate verification required. You must check "I confirm this information is accurate" before generation.'
      });
    }

    if (!verifiedProfile || !verifiedProfile.name) {
      return res.status(400).json({
        success: false,
        error: 'Verified candidate profile with valid name is required.'
      });
    }

    const llmStatus = getLLMStatus();

    // Run 4-Stage Pipeline
    const pipelineResult = await runPipeline({
      verifiedProfile,
      jobDescription: jobDescription || '',
      role: role || (verifiedProfile.role || 'Software Engineer'),
      company: company || (verifiedProfile.company || 'Target Company'),
      tone,
      length,
      promptVersion
    });

    // Execute 5-action automation workflow
    const automationResult = await executeAutomationWorkflow({
      pipelineResult,
      jobDescription,
      modelProvider: llmStatus.provider
    });

    return res.status(200).json({
      success: true,
      runId: automationResult.run_id,
      coverLetter: pipelineResult.letterOutput.letter,
      factsUsed: pipelineResult.letterOutput.facts_used,
      requirementsAddressed: pipelineResult.letterOutput.requirements_addressed,
      gapsAcknowledged: pipelineResult.letterOutput.gaps_acknowledged,
      jobAnalysis: pipelineResult.jobAnalysis,
      evaluation: pipelineResult.evaluation,
      warnings: pipelineResult.warnings,
      receipt: automationResult.receipt,
      latency_ms: pipelineResult.latency_ms,
      llmStatus
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/runs
 */
async function listRuns(req, res, next) {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const runs = getRuns(limit);
    return res.status(200).json({
      success: true,
      count: runs.length,
      runs
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/runs/:id
 */
async function getRun(req, res, next) {
  try {
    const { id } = req.params;
    const run = getRunById(id);
    if (!run) {
      return res.status(404).json({ success: false, error: 'Run not found.' });
    }
    return res.status(200).json({ success: true, run });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/runs/:id/docx
 */
async function downloadRunDocx(req, res, next) {
  try {
    const { id } = req.params;
    const run = getRunById(id);
    if (!run) {
      return res.status(404).json({ success: false, error: 'Run not found.' });
    }

    const docxFile = path.join(LETTERS_DIR, `${id}_Cover_Letter.docx`);
    let buffer;
    if (fs.existsSync(docxFile)) {
      buffer = fs.readFileSync(docxFile);
    } else {
      buffer = await generateCoverLetterDocx({
        letter: run.letter || '',
        candidateName: run.candidate_name || 'Candidate',
        role: run.job_role || '',
        company: run.job_company || ''
      });
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${id}_Cover_Letter.docx"`);
    return res.send(buffer);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/export/runs.csv
 */
async function exportRunsCsv(req, res, next) {
  try {
    const runs = getRuns(500);
    const headers = [
      'id', 'timestamp', 'candidate_name', 'candidate_summary_masked',
      'job_role', 'job_company', 'prompt_version', 'model_provider',
      'is_pass', 'overall_score', 'latency_ms'
    ];

    const lines = [headers.join(',')];
    for (const r of runs) {
      const row = [
        r.id,
        r.timestamp,
        `"${(r.candidate_name || '').replace(/"/g, '""')}"`,
        `"${(r.candidate_summary_masked || '').replace(/"/g, '""')}"`,
        `"${(r.job_role || '').replace(/"/g, '""')}"`,
        `"${(r.job_company || '').replace(/"/g, '""')}"`,
        r.prompt_version,
        r.model_provider,
        r.is_pass ? 'PASS' : 'FAIL',
        r.overall_score || 0,
        r.latency_ms || 0
      ];
      lines.push(row.join(','));
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="cover_letter_runs.csv"');
    return res.send(lines.join('\n'));
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/export/runs.xlsx
 */
async function exportRunsXlsx(req, res, next) {
  try {
    const runs = getRuns(500);
    // Enrich with full record data if needed
    const fullRuns = runs.map(r => getRunById(r.id) || r);
    const buffer = await generateRunsExcel(fullRuns);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="cover_letter_runs.xlsx"');
    return res.send(buffer);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/automation/process-inbox
 */
async function triggerInboxProcess(req, res, next) {
  try {
    const { scanInbox } = require('../automation/watchInbox');
    await scanInbox();
    return res.status(200).json({
      success: true,
      message: 'Inbox batch scan completed.'
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  extractProfile,
  generateCoverLetter,
  listRuns,
  getRun,
  downloadRunDocx,
  exportRunsCsv,
  exportRunsXlsx,
  triggerInboxProcess
};

