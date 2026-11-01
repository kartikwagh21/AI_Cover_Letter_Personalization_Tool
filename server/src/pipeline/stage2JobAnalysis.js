const { z } = require('zod');
const { callLLM } = require('../llm/llmClient');
const { sanitizeInput } = require('./stage1Intake');

const JobExtractionSchema = z.object({
  role: z.string().default('Target Role'),
  company: z.string().default('Target Company'),
  must_have_skills: z.array(z.string()).default([]),
  nice_to_have_skills: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  seniority: z.string().default('Not specified'),
  company_values: z.array(z.string()).default([])
});

/**
 * Normalizes a skill string for comparison.
 */
function normalizeSkill(s = '') {
  return s.toLowerCase().replace(/[\.\-_]/g, '').trim();
}

/**
 * Deterministic skill matcher executed purely in code.
 * LLM extracts skills; deterministic algorithms compute matches, partials, and gaps.
 */
function matchSkills(verifiedSkills = [], mustHaves = [], niceToHaves = []) {
  const normVerified = verifiedSkills.map(s => ({ original: s, norm: normalizeSkill(s) }));
  const allRequired = [...mustHaves, ...niceToHaves];

  const matched = [];
  const partial = [];
  const gaps = [];

  for (const req of mustHaves) {
    const normReq = normalizeSkill(req);
    // Exact match
    const exactHit = normVerified.find(v => v.norm === normReq);
    if (exactHit) {
      if (!matched.includes(exactHit.original)) matched.push(exactHit.original);
      continue;
    }
    // Partial substring match (e.g. "react" in "reactjs", "postgres" in "postgresql")
    const partialHit = normVerified.find(v => v.norm.includes(normReq) || normReq.includes(v.norm));
    if (partialHit) {
      partial.push({ required: req, candidateSkill: partialHit.original });
    } else {
      gaps.push(req);
    }
  }

  for (const nice of niceToHaves) {
    const normNice = normalizeSkill(nice);
    const hit = normVerified.find(v => v.norm === normNice || v.norm.includes(normNice) || normNice.includes(v.norm));
    if (hit) {
      if (!matched.includes(hit.original)) matched.push(hit.original);
    }
  }

  const totalMust = mustHaves.length;
  const coveredCount = matched.length + (partial.length * 0.5);
  const matchPercentage = totalMust > 0 ? Math.min(100, Math.round((coveredCount / totalMust) * 100)) : 100;

  return {
    matched_skills: matched,
    partial_matches: partial,
    gaps: gaps,
    match_percentage: matchPercentage
  };
}

/**
 * Stage 2: Job Analysis & Matching
 */
async function stage2JobAnalysis({ jobDescription = '', role = '', company = '', verifiedProfile = {} }) {
  const warnings = [];

  const { sanitized: cleanJD, warnings: jdWarnings } = sanitizeInput(jobDescription);
  warnings.push(...jdWarnings);

  // Truncation safeguard for very large job descriptions (> 10,000 characters)
  const MAX_JD_CHARS = 10000;
  let processedJD = cleanJD;
  if (processedJD.length > MAX_JD_CHARS) {
    warnings.push(`Job description exceeded ${MAX_JD_CHARS} characters and was truncated for token safety.`);
    processedJD = processedJD.slice(0, MAX_JD_CHARS);
  }

  const systemPrompt = `You are a job requirement extraction engine. Analyze the job posting and extract must-have skills, nice-to-have skills, key domain keywords, seniority level, and company values into a valid JSON object. Do not evaluate matches; only extract explicit requirements.`;

  const userPrompt = `
Job Context:
Target Role: ${role || 'Not specified'}
Target Company: ${company || 'Not specified'}

Job Description:
"""
${processedJD || 'No detailed job description provided.'}
"""

Output valid JSON matching this schema:
{
  "role": "string",
  "company": "string",
  "must_have_skills": ["string"],
  "nice_to_have_skills": ["string"],
  "keywords": ["string"],
  "seniority": "string",
  "company_values": ["string"]
}
`;

  const rawJson = await callLLM({
    systemPrompt,
    userPrompt,
    temperature: 0.0,
    jsonMode: true,
    stage: 'job_analysis',
    context: {
      role,
      company,
      job: {
        role,
        company,
        must_have_skills: ['JavaScript', 'React', 'Node.js'],
        nice_to_have_skills: ['Docker', 'PostgreSQL', 'AWS']
      }
    }
  });

  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    const cleaned = rawJson.replace(/```json/g, '').replace(/```/g, '').trim();
    parsed = JSON.parse(cleaned);
  }

  const extracted = JobExtractionSchema.parse(parsed);

  if (role && (!extracted.role || extracted.role === 'Target Role')) extracted.role = role;
  if (company && (!extracted.company || extracted.company === 'Target Company')) extracted.company = company;

  // Run deterministic code matching
  const candidateSkills = verifiedProfile.skills || [];
  const matchingResults = matchSkills(candidateSkills, extracted.must_have_skills, extracted.nice_to_have_skills);

  return {
    jobAnalysis: {
      ...extracted,
      ...matchingResults
    },
    warnings
  };
}

module.exports = {
  stage2JobAnalysis,
  matchSkills,
  normalizeSkill
};

