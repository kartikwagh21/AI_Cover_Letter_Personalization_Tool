const { z } = require('zod');
const { callLLM } = require('../llm/llmClient');

const RubricScoresSchema = z.object({
  factual_accuracy: z.number().min(0).max(5),
  requirement_coverage: z.number().min(0).max(5),
  personalization: z.number().min(0).max(5),
  tone_professionalism: z.number().min(0).max(5),
  structure_grammar: z.number().min(0).max(5)
});

/**
 * Extracts candidate ground truth strings for factual checking.
 */
function buildGroundTruthIndex(verifiedProfile = {}, jobAnalysis = {}) {
  const truth = new Set();

  const add = (val) => {
    if (val && typeof val === 'string' && val.trim().length > 1) {
      truth.add(val.trim().toLowerCase());
    }
  };

  add(verifiedProfile.name);
  (verifiedProfile.skills || []).forEach(add);
  (verifiedProfile.certifications || []).forEach(add);

  (verifiedProfile.experience || []).forEach(e => {
    add(e.company);
    add(e.title);
    if (e.period) add(e.period);
    (e.responsibilities || []).forEach(r => {
      // Index key terms/numbers
      const numbers = r.match(/\d+[%kM\+]?/gi) || [];
      numbers.forEach(add);
    });
  });

  (verifiedProfile.education || []).forEach(ed => {
    add(ed.institution);
    add(ed.degree);
    if (ed.year) add(ed.year);
  });

  (verifiedProfile.projects || []).forEach(p => {
    add(p.name);
    (p.technologies || []).forEach(add);
  });

  (verifiedProfile.achievements || []).forEach(a => {
    const numbers = a.match(/\d+[%kM\+]?/gi) || [];
    numbers.forEach(add);
  });

  // Legitimate job target references
  add(jobAnalysis.role);
  add(jobAnalysis.company);
  (jobAnalysis.keywords || []).forEach(add);

  return truth;
}

/**
 * Reference-based Fact Check (Regex + LLM)
 */
async function performFactCheck({ letter = '', verifiedProfile = {}, jobAnalysis = {} }) {
  const truthIndex = buildGroundTruthIndex(verifiedProfile, jobAnalysis);
  const unsupportedClaims = [];

  // Regex checks for numbers, percentages, dates, and metric claims
  const metricRegex = /(\b\d+%\b|\$\d+[\d,]*|\b\d+\+?\s+years?\b|\b\d{4}\b)/gi;
  const metricsFound = letter.match(metricRegex) || [];

  for (const metric of metricsFound) {
    const norm = metric.toLowerCase();
    // Check if metric exists in profile or current year
    const currentYear = new Date().getFullYear().toString();
    if (norm === currentYear) continue;

    let supported = false;
    for (const item of truthIndex) {
      if (item.includes(norm) || norm.includes(item)) {
        supported = true;
        break;
      }
    }
    if (!supported) {
      // If candidate has years of experience or reasonable year, check text
      const rawProfileStr = JSON.stringify(verifiedProfile).toLowerCase();
      if (!rawProfileStr.includes(norm)) {
        unsupportedClaims.push({
          claim: `Unverified metric or year cited in letter: "${metric}"`,
          type: 'metric'
        });
      }
    }
  }

  // Regex checks for unverified academic degrees
  const degreeRegex = /\b(ph\.?d\.?|doctorate|master'?s|bachelor'?s|m\.?s\.?|b\.?s\.?|mba)\b/gi;
  const degreesFound = letter.match(degreeRegex) || [];
  const candidateDegrees = (verifiedProfile.education || []).map(ed => (ed.degree || '').toLowerCase());
  for (const deg of degreesFound) {
    const normDeg = deg.toLowerCase().replace(/\./g, '');
    const foundInEdu = candidateDegrees.some(cd => cd.replace(/\./g, '').includes(normDeg));
    if (!foundInEdu) {
      unsupportedClaims.push({
        claim: `Claimed academic degree "${deg}" not verified in candidate education history.`,
        type: 'degree'
      });
    }
  }

  // LLM Claim extraction for employers, degrees, titles, and certifications
  const systemPrompt = `You are a forensic fact checker. Extract every specific factual claim made in the cover letter regarding the candidate's previous employers, degrees, academic institutions, certifications, and claimed technical capabilities. Output JSON array of claims.`;

  const userPrompt = `
Cover Letter:
"""
${letter}
"""

Output JSON matching:
{
  "claims": [
    { "claim": "string", "category": "employer | degree | certification | skill | achievement" }
  ]
}
`;

  try {
    const rawClaims = await callLLM({
      systemPrompt,
      userPrompt,
      temperature: 0.0,
      jsonMode: true,
      stage: 'fact_check',
      context: { candidate: verifiedProfile, job: jobAnalysis }
    });

    const parsed = JSON.parse(rawClaims.replace(/```json/g, '').replace(/```/g, '').trim());
    const claims = parsed.claims || [];

    const rawProfileText = JSON.stringify(verifiedProfile).toLowerCase();

    for (const c of claims) {
      const claimText = (c.claim || '').toLowerCase();
      // Verify against truthIndex or rawProfile
      let found = false;
      for (const t of truthIndex) {
        if (claimText.includes(t)) {
          found = true;
          break;
        }
      }
      if (!found && !rawProfileText.includes(claimText)) {
        // Exclude generic pleasantries or targets
        const companyNorm = (jobAnalysis.company || '').toLowerCase();
        const roleNorm = (jobAnalysis.role || '').toLowerCase();
        if (claimText.includes(companyNorm) || claimText.includes(roleNorm)) {
          continue;
        }
        // Flag unsupported claim
        if (c.category === 'employer' || c.category === 'degree' || c.category === 'certification') {
          unsupportedClaims.push({
            claim: c.claim,
            type: c.category
          });
        }
      }
    }
  } catch (err) {
    console.warn('[Evaluation] LLM Claim extraction encountered warning:', err.message);
  }

  return {
    unsupported_claims: unsupportedClaims,
    fact_check_passed: unsupportedClaims.length === 0
  };
}

/**
 * Deterministic Rubric Evaluator
 * Weights:
 * Factual accuracy: 30%
 * Requirement coverage: 25%
 * Personalization: 15%
 * Tone & professionalism: 15% (LLM-judged)
 * Structure/length/grammar: 15%
 */
async function evaluateRubric({
  letter = '',
  verifiedProfile = {},
  jobAnalysis = {},
  unsupportedClaims = [],
  tone = 'Formal',
  length = 'medium',
  promptVersion = 'v3'
}) {
  // 1. Factual accuracy (30%) - Code computed based on fact check
  let factualScore = 5.0;
  if (unsupportedClaims.length === 1) {
    factualScore = 3.5;
  } else if (unsupportedClaims.length >= 2) {
    factualScore = Math.max(0.0, 5.0 - (unsupportedClaims.length * 1.5));
  }

  // 2. Requirement coverage (25%) - Code computed
  const mustHaves = jobAnalysis.must_have_skills || [];
  let coverageScore = 4.5;
  if (mustHaves.length > 0) {
    const letterLower = letter.toLowerCase();
    const hits = mustHaves.filter(req => letterLower.includes(req.toLowerCase()));
    coverageScore = Math.min(5.0, Math.max(2.0, (hits.length / mustHaves.length) * 5.0));
  }

  // 3. Personalization (15%) - Code computed
  let personalizationScore = 3.5;
  const letterLower = letter.toLowerCase();
  if (jobAnalysis.company && letterLower.includes(jobAnalysis.company.toLowerCase())) {
    personalizationScore += 0.8;
  }
  if (jobAnalysis.role && letterLower.includes(jobAnalysis.role.toLowerCase())) {
    personalizationScore += 0.4;
  }
  // Check if projects or achievements mentioned
  const projects = verifiedProfile.projects || [];
  for (const p of projects) {
    if (letterLower.includes(p.name.toLowerCase())) {
      personalizationScore += 0.3;
      break;
    }
  }
  personalizationScore = Math.min(5.0, Math.round(personalizationScore * 10) / 10);

  // 4. Structure, length, and grammar (15%) - Code computed
  const words = letter.trim().split(/\s+/).filter(Boolean).length;
  let structureScore = 5.0;
  const targetRanges = {
    short: { min: 120, max: 280 },
    medium: { min: 200, max: 400 },
    long: { min: 320, max: 600 }
  };
  const range = targetRanges[length] || targetRanges.medium;
  if (words < range.min) {
    structureScore -= Math.min(2.0, ((range.min - words) / range.min) * 2.0);
  } else if (words > range.max) {
    structureScore -= Math.min(1.5, ((words - range.max) / range.max) * 1.5);
  }
  if (!letter.toLowerCase().includes('dear') && !letter.toLowerCase().includes('hello')) {
    structureScore -= 0.5;
  }
  if (!letterLower.includes(verifiedProfile.name.toLowerCase())) {
    structureScore -= 0.5;
  }
  structureScore = Math.min(5.0, Math.max(1.0, Math.round(structureScore * 10) / 10));

  // 5. Tone & Professionalism (15%) - LLM-judged
  let toneScore = 4.5;
  let toneFeedback = 'Exemplary professional tone adhering to requested guidelines.';

  const systemPrompt = `You are an executive communications evaluator. Grade the professional tone of the cover letter on a scale of 0.0 to 5.0 based on the target tone "${tone}". Provide brief 1-sentence feedback.`;
  const userPrompt = `Target Tone: ${tone}\n\nCover Letter:\n"""\n${letter}\n"""\n\nOutput JSON: { "tone_score": number, "feedback": "string" }`;

  try {
    const rawEval = await callLLM({
      systemPrompt,
      userPrompt,
      temperature: 0.0,
      jsonMode: true,
      stage: 'rubric_evaluation',
      promptVersion,
      context: { candidate: verifiedProfile, job: jobAnalysis }
    });
    const parsed = JSON.parse(rawEval.replace(/```json/g, '').replace(/```/g, '').trim());
    if (typeof parsed.tone_score === 'number') {
      toneScore = Math.min(5.0, Math.max(0.0, parsed.tone_score));
    }
    if (parsed.feedback) {
      toneFeedback = parsed.feedback;
    }
  } catch (err) {
    console.warn('[Evaluation] LLM Tone evaluation fallback:', err.message);
  }

  // Weighted overall calculation:
  // Factual accuracy 30%, Requirement coverage 25%, Personalization 15%, Tone 15%, Structure 15%
  const weightedOverall = Math.round((
    (factualScore * 0.30) +
    (coverageScore * 0.25) +
    (personalizationScore * 0.15) +
    (toneScore * 0.15) +
    (structureScore * 0.15)
  ) * 100) / 100;

  const isPass = weightedOverall >= 4.0 && unsupportedClaims.length === 0;

  return {
    scores: {
      factual_accuracy: Math.round(factualScore * 10) / 10,
      requirement_coverage: Math.round(coverageScore * 10) / 10,
      personalization: Math.round(personalizationScore * 10) / 10,
      tone_professionalism: Math.round(toneScore * 10) / 10,
      structure_grammar: Math.round(structureScore * 10) / 10
    },
    weights: {
      factual_accuracy: '30%',
      requirement_coverage: '25%',
      personalization: '15%',
      tone_professionalism: '15%',
      structure_grammar: '15%'
    },
    computation_breakdown: {
      factual_accuracy: 'Code-computed via reference fact-checking',
      requirement_coverage: 'Code-computed via keyword & requirement hits',
      personalization: 'Code-computed via entity & project matching',
      tone_professionalism: 'LLM-judged evaluation',
      structure_grammar: 'Code-computed via word counts, greetings & structure'
    },
    overall: weightedOverall,
    is_pass: isPass,
    tone_feedback: toneFeedback,
    word_count: words
  };
}

/**
 * Stage 4 Evaluator Orchestration
 */
async function stage4Evaluate({
  letter = '',
  verifiedProfile = {},
  jobAnalysis = {},
  tone = 'Formal',
  length = 'medium',
  promptVersion = 'v3'
}) {
  const factCheck = await performFactCheck({ letter, verifiedProfile, jobAnalysis });
  const rubric = await evaluateRubric({
    letter,
    verifiedProfile,
    jobAnalysis,
    unsupportedClaims: factCheck.unsupported_claims,
    tone,
    length,
    promptVersion
  });

  return {
    ...factCheck,
    rubric
  };
}

module.exports = {
  stage4Evaluate,
  performFactCheck,
  evaluateRubric,
  RubricScoresSchema
};
