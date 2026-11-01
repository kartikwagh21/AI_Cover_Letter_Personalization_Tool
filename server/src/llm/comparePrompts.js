const fs = require('fs');
const path = require('path');
const { runPipeline } = require('../pipeline/pipeline');
const { getLLMStatus } = require('./llmClient');

const PROMPT_COMPARISON_MD = path.join(__dirname, '../../prompts/prompt_comparison.md');
const SAMPLE_CANDIDATE_FILE = path.join(__dirname, '../../data/sample_candidate.json');
const SAMPLE_JOB_FILE = path.join(__dirname, '../../data/sample_job.txt');

async function comparePrompts() {
  const candidate = JSON.parse(fs.readFileSync(SAMPLE_CANDIDATE_FILE, 'utf8'));
  const jobText = fs.readFileSync(SAMPLE_JOB_FILE, 'utf8');
  const llmStatus = getLLMStatus();

  console.log(`\n======================================================`);
  console.log(`📊 EXECUTING 3-VERSION PROMPT BENCHMARK COMPARISON`);
  console.log(`Provider: ${llmStatus.provider} (${llmStatus.model}) | IsMock: ${llmStatus.isMock}`);
  console.log(`======================================================\n`);

  const versions = ['v1', 'v2', 'v3'];
  const versionNames = {
    v1: 'v1_basic (Naive One-Liner)',
    v2: 'v2_structured (Role & Constraints)',
    v3: 'v3_refined (Anti-Hallucination & Gap Citations)'
  };

  const results = [];

  for (const ver of versions) {
    console.log(`Running benchmark on ${versionNames[ver]}...`);
    const startTime = Date.now();
    const res = await runPipeline({
      verifiedProfile: candidate,
      jobDescription: jobText,
      role: 'Senior Full-Stack Engineer',
      company: 'Stripe',
      tone: 'Confident',
      length: 'medium',
      promptVersion: ver
    });
    const latency = Date.now() - startTime;

    const rubric = res.evaluation.rubric;
    const scores = rubric.scores;
    const claims = res.evaluation.unsupported_claims;

    results.push({
      version: ver,
      name: versionNames[ver],
      overallScore: rubric.overall,
      factualScore: scores.factual_accuracy,
      coverageScore: scores.requirement_coverage,
      personalizationScore: scores.personalization,
      toneScore: scores.tone_professionalism,
      structureScore: scores.structure_grammar,
      isPass: rubric.is_pass ? 'PASS' : 'FAIL',
      unsupportedClaimsCount: claims.length,
      latency,
      sampleLetter: res.letterOutput.letter.slice(0, 160) + '...'
    });
  }

  // Generate prompts/prompt_comparison.md
  let md = `# Comprehensive Prompt Engineering Comparison & Benchmark Report\n\n`;
  if (llmStatus.isMock) {
    md += `> [!NOTE]\n> **Execution Mode: Deterministic Mock Benchmark.**\n> No Gemini API key was active during this benchmark run; evaluations were executed using the deterministic, version-aware Mock LLM engine with identical rubric criteria.\n\n`;
  } else {
    md += `> [!NOTE]\n> **Execution Mode: Live Google Gemini (${llmStatus.model}).**\n\n`;
  }

  md += `**Evaluation Date:** ${new Date().toISOString()}\n`;
  md += `**Test Subject:** Kartik Wagh applying for Senior Full-Stack Engineer at Stripe.\n\n`;

  md += `## 1. Quantitative Benchmark Matrix\n\n`;
  md += `| Prompt Version | Unsupported Claims | Requirement Coverage | Tone & Decor | Overall (0-5) | Status |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  for (const r of results) {
    md += `| **${r.version.toUpperCase()}** (${r.name.split(' ')[1] || r.version}) | ${r.unsupportedClaimsCount} | ${r.coverageScore} / 5.0 | ${r.toneScore} / 5.0 | **${r.overallScore} / 5.0** | **${r.isPass}** |\n`;
  }

  md += `\n## 2. Iterative Prompt Refinement Log\n\n`;
  md += `### Version 1 (\`v1_basic.md\`) — Naive One-Liner\n`;
  md += `- **Template:** \`Write a professional cover letter for {{name}} applying for {{role}} at {{company}}. Key skills: {{skills}}.\`\n`;
  md += `- **Observed Failures in v1:**\n`;
  md += `  - Complete absence of negative constraints or ground truth bounds.\n`;
  md += `  - Employs generic boilerplate clichés ("stellar addition", "passion to excel").\n`;
  md += `  - High hallucination vulnerability: models frequently invent unverified past employers, metrics, and unearned degrees.\n`;
  md += `  - Fails to acknowledge required skills the candidate does not have.\n\n`;

  md += `### Version 2 (\`v2_structured.md\`) — Structured Role & Constraints\n`;
  md += `- **Enhancements:** Introduced explicit system persona ("professional cover letter writer"), separated candidate details from job description, and added a soft negative constraint ("Do not invent facts that contradict the candidate background").\n`;
  md += `- **Observed Limitations in v2:**\n`;
  md += `  - Soft negative constraints are often bypassed by LLM attentional drift.\n`;
  md += `  - Output remains unstructured Markdown text, making machine parsing and programmatic verification fragile.\n`;
  md += `  - Lacks structured citations explaining *which* verified facts were incorporated.\n`;
  md += `  - No explicit length target enforcement or tone tuning.\n\n`;

  md += `### Version 3 (\`v3_refined.md\`) — Master Grounded Architecture\n`;
  md += `- **Architectural Breakthroughs in v3:**\n`;
  md += `  - **Strict JSON Contract:** Mandates structured output \`{ letter, facts_used, requirements_addressed, gaps_acknowledged }\` validated via Zod schema with automated single-turn repair.\n`;
  md += `  - **Delimited Security Fencing:** Encloses candidate facts and job requirements inside \`<<<VERIFIED_CANDIDATE_PROFILE>>>\` blocks, preventing untrusted prompt injection.\n`;
  md += `  - **Honest Gap Handling:** Integrates deterministic code matching results, prompting the model to transparently position missing skills as adjacent learning targets rather than falsifying competence.\n`;
  md += `  - **Multi-Parameter Controls:** Dynamically modulates length (short/medium/long) and tone (Formal/Confident/Friendly-professional).\n`;
  md += `  - **Closed-Loop Fact Verification:** Stage 4 forensic checker validates every claim in the generated letter against verified profile ground truth; triggers auto-regeneration if any claim lacks support.\n\n`;

  md += `## 3. Rubric Scoring Details Across Versions\n\n`;
  md += `| Evaluation Dimension | Weight | v1 Basic | v2 Structured | v3 Refined |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- |\n`;
  md += `| Factual Accuracy | 30% | ${results[0].factualScore} | ${results[1].factualScore} | ${results[2].factualScore} |\n`;
  md += `| Requirement Coverage | 25% | ${results[0].coverageScore} | ${results[1].coverageScore} | ${results[2].coverageScore} |\n`;
  md += `| Personalization | 15% | ${results[0].personalizationScore} | ${results[1].personalizationScore} | ${results[2].personalizationScore} |\n`;
  md += `| Tone & Professionalism | 15% | ${results[0].toneScore} | ${results[1].toneScore} | ${results[2].toneScore} |\n`;
  md += `| Structure & Grammar | 15% | ${results[0].structureScore} | ${results[1].structureScore} | ${results[2].structureScore} |\n`;
  md += `| **Weighted Overall Score** | **100%** | **${results[0].overallScore}** | **${results[1].overallScore}** | **${results[2].overallScore}** |\n`;

  fs.writeFileSync(PROMPT_COMPARISON_MD, md, 'utf8');

  console.log(`\n======================================================`);
  console.log(`✅ Benchmark comparison completed! Report written to:`);
  console.log(`  - ${PROMPT_COMPARISON_MD}`);
  console.log(`======================================================\n`);
}

if (require.main === module) {
  comparePrompts().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  comparePrompts
};

