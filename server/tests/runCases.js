const fs = require('fs');
const path = require('path');
const { runPipeline } = require('../src/pipeline/pipeline');
const { executeAutomationWorkflow } = require('../src/automation/automation');
const { getLLMStatus } = require('../src/llm/llmClient');

const TEST_CASES_FILE = path.join(__dirname, 'testCases.json');
const OUTPUTS_DIR = path.join(__dirname, '../outputs');
const EVIDENCE_MD = path.join(OUTPUTS_DIR, 'test_evidence.md');
const EVIDENCE_CSV = path.join(OUTPUTS_DIR, 'test_evidence.csv');

function ensureOutputsDir() {
  if (!fs.existsSync(OUTPUTS_DIR)) fs.mkdirSync(OUTPUTS_DIR, { recursive: true });
}

async function runAllCases() {
  ensureOutputsDir();
  const rawCases = fs.readFileSync(TEST_CASES_FILE, 'utf8');
  const testCases = JSON.parse(rawCases);
  const llmStatus = getLLMStatus();

  console.log(`\n======================================================`);
  console.log(`🧪 EXECUTING 5-CASE BENCHMARK TEST SUITE`);
  console.log(`Provider: ${llmStatus.provider} | Model: ${llmStatus.model} | IsMock: ${llmStatus.isMock}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`======================================================\n`);

  const results = [];
  const csvRows = ['case_id,case_name,status,overall_score,unsupported_claims,latency_ms,injections_flagged,timestamp'];

  for (const tc of testCases) {
    console.log(`▶ Running ${tc.name}...`);
    const startTime = Date.now();
    let status = 'PASS';
    let failureReason = '';

    try {
      const pipelineRes = await runPipeline({
        verifiedProfile: tc.input.verifiedProfile,
        jobDescription: tc.input.jobDescription,
        role: tc.input.role,
        company: tc.input.company,
        tone: tc.input.tone,
        length: tc.input.length,
        promptVersion: tc.input.promptVersion
      });

      const latencyMs = Date.now() - startTime;
      const rubric = pipelineRes.evaluation?.rubric || {};
      const unsupportedClaims = pipelineRes.evaluation?.unsupported_claims || [];
      const warnings = pipelineRes.warnings || [];

      // Check injection detection for Case 5
      const injectionFlagged = warnings.some(w => w.toLowerCase().includes('instruction') || w.toLowerCase().includes('injection') || w.toLowerCase().includes('sanitized'));

      // Verify constraints
      if (tc.expected.mustPass && !rubric.is_pass) {
        status = 'FAIL';
        failureReason = `Expected PASS but got is_pass = false (Score: ${rubric.overall})`;
      }

      if (tc.expected.maxUnsupportedClaims !== undefined && unsupportedClaims.length > tc.expected.maxUnsupportedClaims) {
        status = 'FAIL';
        failureReason = `Expected <= ${tc.expected.maxUnsupportedClaims} unsupported claims, but detected ${unsupportedClaims.length}`;
      }

      // Case 5 Edge Case Verification
      if (tc.id === 'case_5_edge_case_injection') {
        const letterLower = pipelineRes.letterOutput.letter.toLowerCase();
        if (letterLower.includes('phd') || letterLower.includes('harvard') || letterLower.includes('cto')) {
          status = 'FAIL';
          failureReason = 'SECURITY VIOLATION: Model yielded to prompt injection string (claimed PhD/Harvard/CTO)!';
        } else {
          status = 'PASS (SAFELY MITIGATED)';
        }
      }

      const caseResult = {
        id: tc.id,
        name: tc.name,
        description: tc.description,
        status,
        failureReason,
        overallScore: rubric.overall || 0,
        scores: rubric.scores || {},
        unsupportedClaimsCount: unsupportedClaims.length,
        unsupportedClaims,
        warnings,
        injectionFlagged,
        letterSample: pipelineRes.letterOutput.letter.slice(0, 180) + '...',
        latencyMs
      };

      results.push(caseResult);
      csvRows.push(`${tc.id},"${tc.name}",${status},${rubric.overall || 0},${unsupportedClaims.length},${latencyMs},${injectionFlagged},"${new Date().toISOString()}"`);

      console.log(`  Status: [${status}] | Score: ${rubric.overall || 0}/5.0 | Latency: ${latencyMs}ms | Unsupported Claims: ${unsupportedClaims.length}`);
      if (warnings.length > 0) {
        console.log(`  Warnings: ${warnings.join('; ')}`);
      }
      console.log('');

    } catch (err) {
      console.error(`  Error in ${tc.name}:`, err.message);
      results.push({
        id: tc.id,
        name: tc.name,
        description: tc.description,
        status: 'ERROR',
        failureReason: err.message,
        overallScore: 0,
        scores: {},
        unsupportedClaimsCount: 0,
        unsupportedClaims: [],
        warnings: [],
        injectionFlagged: false,
        letterSample: '',
        latencyMs: Date.now() - startTime
      });
      csvRows.push(`${tc.id},"${tc.name}",ERROR,0,0,${Date.now() - startTime},false,"${new Date().toISOString()}"`);
    }
  }

  // Write Evidence Markdown
  const timestamp = new Date().toISOString();
  let md = `# Automated Test Evidence Report\n\n`;
  md += `**Execution Timestamp:** ${timestamp}\n`;
  md += `**LLM Provider:** ${llmStatus.provider} (${llmStatus.model}) | **Deterministic Mock Active:** ${llmStatus.isMock}\n\n`;
  md += `## 1. Test Summary Matrix\n\n`;
  md += `| Case ID | Scenario | Overall Score | Unsupported Claims | Latency | Status |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  for (const r of results) {
    md += `| \`${r.id}\` | ${r.name} | **${r.overallScore} / 5.0** | ${r.unsupportedClaimsCount} | ${r.latencyMs}ms | **${r.status}** |\n`;
  }

  md += `\n## 2. Detailed Scenario Evidence\n\n`;
  for (const r of results) {
    md += `### ${r.name} (\`${r.id}\`)\n`;
    md += `- **Description:** ${r.description}\n`;
    md += `- **Outcome:** ${r.status}${r.failureReason ? ` (${r.failureReason})` : ''}\n`;
    md += `- **Latency:** ${r.latencyMs}ms\n`;
    md += `- **Dimension Scores:** Accuracy: ${r.scores.factual_accuracy ?? 'N/A'}, Coverage: ${r.scores.requirement_coverage ?? 'N/A'}, Personalization: ${r.scores.personalization ?? 'N/A'}, Tone: ${r.scores.tone_professionalism ?? 'N/A'}, Structure: ${r.scores.structure_grammar ?? 'N/A'}\n`;
    md += `- **Warnings Flagged:** ${r.warnings.length > 0 ? r.warnings.map(w => `\`${w}\``).join(', ') : 'None'}\n`;
    md += `- **Generated Excerpt:**\n> ${r.letterSample.replace(/\n/g, ' ')}\n\n`;
  }

  fs.writeFileSync(EVIDENCE_MD, md, 'utf8');
  fs.writeFileSync(EVIDENCE_CSV, csvRows.join('\n'), 'utf8');

  console.log(`\n======================================================`);
  console.log(`✅ Test evidence written to:`);
  console.log(`  - ${EVIDENCE_MD}`);
  console.log(`  - ${EVIDENCE_CSV}`);
  console.log(`======================================================\n`);

  return results;
}

if (require.main === module) {
  runAllCases().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  runAllCases
};

