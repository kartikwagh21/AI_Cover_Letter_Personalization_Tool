const { stage1Intake } = require('./stage1Intake');
const { stage2JobAnalysis } = require('./stage2JobAnalysis');
const { stage3Generate } = require('./stage3Generate');
const { stage4Evaluate } = require('./stage4Evaluate');

/**
 * Executes the complete 4-stage pipeline.
 */
async function runPipeline({
  fileBuffer = null,
  formFields = {},
  verifiedProfile = null,
  jobDescription = '',
  role = '',
  company = '',
  tone = 'Formal',
  length = 'medium',
  promptVersion = 'v3'
}) {
  const startTime = Date.now();
  const allWarnings = [];

  // Stage 1: Intake & Verification
  let profile = verifiedProfile;
  if (!profile) {
    const intakeResult = await stage1Intake({ fileBuffer, formFields });
    profile = intakeResult.profile;
    if (intakeResult.warnings) allWarnings.push(...intakeResult.warnings);
  }

  // Ensure role and company fallbacks from formFields if not passed explicitly
  const targetRole = role || formFields.role || 'Software Engineer';
  const targetCompany = company || formFields.company || 'Target Company';

  // Stage 2: Job Analysis & Matching
  const analysisResult = await stage2JobAnalysis({
    jobDescription,
    role: targetRole,
    company: targetCompany,
    verifiedProfile: profile
  });
  const jobAnalysis = analysisResult.jobAnalysis;
  if (analysisResult.warnings) allWarnings.push(...analysisResult.warnings);

  // Stage 3: Cover Letter Generation
  let letterResult = await stage3Generate({
    verifiedProfile: profile,
    jobAnalysis,
    tone,
    length,
    promptVersion
  });

  // Stage 4: Evaluation & Fact Check
  let evalResult = await stage4Evaluate({
    letter: letterResult.letter,
    verifiedProfile: profile,
    jobAnalysis,
    tone,
    length,
    promptVersion
  });

  // Auto-regeneration check: if unsupported claims > 0, auto-regenerate ONCE with corrections
  if (evalResult.unsupported_claims && evalResult.unsupported_claims.length > 0) {
    console.warn(`[Pipeline] Detected ${evalResult.unsupported_claims.length} unsupported claim(s). Initiating 1 auto-regeneration attempt...`);
    allWarnings.push(`Initial draft contained ${evalResult.unsupported_claims.length} unverified claim(s). Auto-regeneration was triggered.`);

    const regeneratedLetterResult = await stage3Generate({
      verifiedProfile: profile,
      jobAnalysis,
      tone,
      length,
      promptVersion,
      correctionFeedback: evalResult.unsupported_claims
    });

    const reEvalResult = await stage4Evaluate({
      letter: regeneratedLetterResult.letter,
      verifiedProfile: profile,
      jobAnalysis,
      tone,
      length,
      promptVersion
    });

    letterResult = regeneratedLetterResult;
    evalResult = reEvalResult;

    if (evalResult.unsupported_claims && evalResult.unsupported_claims.length > 0) {
      allWarnings.push('Warning: Regenerated letter still contains unverified claims. Please review carefully before submission.');
    }
  }

  const latencyMs = Date.now() - startTime;

  return {
    candidateProfile: profile,
    jobAnalysis,
    letterOutput: letterResult,
    evaluation: evalResult,
    warnings: allWarnings,
    latency_ms: latencyMs,
    promptVersion,
    tone,
    length
  };
}

module.exports = {
  runPipeline
};

