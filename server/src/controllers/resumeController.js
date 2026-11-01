const { runPipeline } = require('../pipeline/pipeline');
const { executeAutomationWorkflow } = require('../automation/automation');
const { getLLMStatus } = require('../llm/llmClient');

async function analyzeResume(req, res, next) {
  try {
    const { name, role, company, skills, jobDescription } = req.body;

    if (!name || !name.trim()) {
      throw new Error('Candidate name is required.');
    }
    if (!role || !role.trim()) {
      throw new Error('Target job role is required.');
    }
    if (!company || !company.trim()) {
      throw new Error('Target company is required.');
    }
    if (!skills || !skills.trim()) {
      throw new Error('Key skills are required.');
    }

    const fileBuffer = req.file ? req.file.buffer : null;
    const llmStatus = getLLMStatus();

    // Execute 4-stage pipeline
    const pipelineResult = await runPipeline({
      fileBuffer,
      formFields: {
        name: name.trim(),
        role: role.trim(),
        company: company.trim(),
        skills: skills.trim()
      },
      jobDescription: jobDescription || '',
      role: role.trim(),
      company: company.trim(),
      promptVersion: 'v3'
    });

    // Execute automation workflow
    const automationResult = await executeAutomationWorkflow({
      pipelineResult,
      jobDescription: jobDescription || '',
      modelProvider: llmStatus.provider
    });

    return res.status(200).json({
      success: true,
      coverLetter: pipelineResult.letterOutput.letter,
      factsUsed: pipelineResult.letterOutput.facts_used,
      requirementsAddressed: pipelineResult.letterOutput.requirements_addressed,
      gapsAcknowledged: pipelineResult.letterOutput.gaps_acknowledged,
      jobAnalysis: pipelineResult.jobAnalysis,
      evaluation: pipelineResult.evaluation,
      receipt: automationResult.receipt,
      runId: automationResult.run_id
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  analyzeResume
};
