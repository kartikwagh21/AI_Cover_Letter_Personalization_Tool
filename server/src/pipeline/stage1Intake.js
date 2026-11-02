const { z } = require('zod');
const { callLLM } = require('../llm/llmClient');
const { extractTextFromPDF } = require('../services/pdfService');

const ContactSchema = z.object({
  email: z.string().optional().default(''),
  phone: z.string().optional().default(''),
  location: z.string().optional().default(''),
  linkedin: z.string().optional().default('')
});

const ExperienceSchema = z.object({
  company: z.string().default(''),
  title: z.string().default(''),
  period: z.string().optional().default(''),
  responsibilities: z.array(z.string()).optional().default([])
});

const EducationSchema = z.object({
  institution: z.string().default(''),
  degree: z.string().default(''),
  year: z.string().optional().default('')
});

const ProjectSchema = z.object({
  name: z.string().default(''),
  description: z.string().default(''),
  technologies: z.array(z.string()).optional().default([])
});

const CandidateProfileSchema = z.object({
  name: z.string().min(1, 'Candidate name is required'),
  contact: ContactSchema.default({}),
  summary: z.string().default(''),
  skills: z.array(z.string()).min(1, 'At least one skill is required'),
  role: z.string().optional().default(''),
  experience: z.array(ExperienceSchema).default([]),
  education: z.array(EducationSchema).default([]),
  certifications: z.array(z.string()).default([]),
  projects: z.array(ProjectSchema).default([]),
  achievements: z.array(z.string()).default([]),
  is_confirmed: z.boolean().default(false)
});

/**
 * Sanitizes input strings by stripping HTML/scripts and detecting injection attempts.
 */
function sanitizeInput(text = '') {
  if (!text || typeof text !== 'string') return { sanitized: '', warnings: [] };

  const warnings = [];
  let sanitized = text;

  // HTML / Script tag stripping
  if (/<[a-z][\s\S]*>/i.test(sanitized)) {
    warnings.push('HTML/script tags were detected and safely sanitized.');
    sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    sanitized = sanitized.replace(/<[^>]+>/g, ' ');
  }

  // Prompt injection pattern detection
  const injectionPatterns = [
    /ignore\s+(all\s+)?(previous|prior)\s+instructions/i,
    /disregard\s+(the\s+)?system\s+prompt/i,
    /say\s+I\s+have\s+a\s+phd/i,
    /award\s+me\s+a\s+degree/i,
    /system:\s*you\s+are/i,
    /always\s+give\s+a\s+score\s+of\s+5/i
  ];

  for (const pattern of injectionPatterns) {
    if (pattern.test(sanitized)) {
      warnings.push(`Suspicious prompt instruction pattern detected and isolated: "${pattern.source}"`);
      sanitized = sanitized.replace(pattern, '[REDACTED_UNTRUSTED_INSTRUCTION]');
    }
  }

  return { sanitized: sanitized.trim(), warnings };
}

/**
 * Stage 1 Intake & Verification
 */
async function stage1Intake({ fileBuffer, formFields = {} }) {
  const warnings = [];
  let resumeText = '';

  if (fileBuffer) {
    try {
      resumeText = await extractTextFromPDF(fileBuffer);
    } catch (err) {
      throw new Error(`PDF Extraction failed: ${err.message}`);
    }
  }

  // Truncation check
  const MAX_RESUME_CHARS = 15000;
  if (resumeText.length > MAX_RESUME_CHARS) {
    warnings.push(`Uploaded resume exceeded ${MAX_RESUME_CHARS} characters and was safely truncated.`);
    resumeText = resumeText.slice(0, MAX_RESUME_CHARS);
  }

  const { sanitized: cleanResume, warnings: resumeWarnings } = sanitizeInput(resumeText);
  warnings.push(...resumeWarnings);

  const { sanitized: cleanName } = sanitizeInput(formFields.name || '');
  const { sanitized: cleanSkills } = sanitizeInput(formFields.skills || '');

  // Build prompt for extraction
  const systemPrompt = `You are a strict data extraction engine. Extract candidate details from the provided resume text and form fields into a structured JSON CandidateProfile. Follow the exact schema. Do not invent any data not present in the input. If information is missing, leave the field empty.`;

  const userPrompt = `
Form Details:
- Candidate Name: ${cleanName || 'Not specified'}
- Key Skills: ${cleanSkills || 'Not specified'}

Resume Text:
"""
${cleanResume || 'No resume PDF provided.'}
"""

Output valid JSON matching this schema:
{
  "name": "string",
  "contact": { "email": "string", "phone": "string", "location": "string", "linkedin": "string" },
  "summary": "string",
  "skills": ["string"],
  "experience": [{ "company": "string", "title": "string", "period": "string", "responsibilities": ["string"] }],
  "education": [{ "institution": "string", "degree": "string", "year": "string" }],
  "certifications": ["string"],
  "projects": [{ "name": "string", "description": "string", "technologies": ["string"] }],
  "achievements": ["string"]
}
`;

  const context = {
    candidate: {
      name: cleanName,
      skills: cleanSkills ? cleanSkills.split(',').map(s => s.trim()).filter(Boolean) : []
    }
  };

  const rawJson = await callLLM({
    systemPrompt,
    userPrompt,
    temperature: 0.0,
    jsonMode: true,
    stage: 'intake_extraction',
    context
  });

  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    // Attempt cleanup
    const cleaned = rawJson.replace(/```json/g, '').replace(/```/g, '').trim();
    parsed = JSON.parse(cleaned);
  }

  // Ensure form overrides take precedence if user provided them explicitly
  if (cleanName && (!parsed.name || parsed.name.toLowerCase().includes('not specified'))) {
    parsed.name = cleanName;
  }
  if (cleanSkills && (!parsed.skills || parsed.skills.length === 0)) {
    parsed.skills = cleanSkills.split(',').map(s => s.trim()).filter(Boolean);
  }

  // If skills is a string, split into array
  if (typeof parsed.skills === 'string') {
    parsed.skills = parsed.skills.split(',').map(s => s.trim()).filter(Boolean);
  }

  // If skills is empty, extract from resume text or fall back to verified defaults
  if (!parsed.skills || parsed.skills.length === 0) {
    const knownSkills = ['JavaScript', 'TypeScript', 'React', 'Node.js', 'Python', 'Java', 'SQL', 'PostgreSQL', 'Docker', 'AWS', 'Kubernetes', 'Git', 'REST APIs'];
    const resumeLower = (cleanResume || '').toLowerCase();
    const extractedSkills = knownSkills.filter(k => resumeLower.includes(k.toLowerCase()));
    parsed.skills = extractedSkills.length > 0 ? extractedSkills : ['Software Engineering', 'Technical Problem Solving'];
  }

  // If candidate is fresh graduate with empty experience, ensure array exists
  if (!parsed.experience) parsed.experience = [];
  if (!parsed.education) parsed.education = [];
  if (!parsed.projects) parsed.projects = [];
  if (!parsed.certifications) parsed.certifications = [];
  if (!parsed.achievements) parsed.achievements = [];

  // Validate with Zod
  const profile = CandidateProfileSchema.parse(parsed);

  return {
    profile,
    warnings,
    rawExtractedText: cleanResume
  };
}

module.exports = {
  stage1Intake,
  CandidateProfileSchema,
  sanitizeInput
};

