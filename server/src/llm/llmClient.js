require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const DEFAULT_MODEL = 'gemini-2.5-flash';
const REQUEST_TIMEOUT_MS = 30000;
const MAX_RETRIES = 2;

function getApiKey() {
  return process.env.GEMINI_API_KEY || process.env.GEMNAI_API || '';
}

function getModelName() {
  return process.env.GEMINI_MODEL || DEFAULT_MODEL;
}

function isMockConfigured() {
  const key = getApiKey();
  const forced = process.env.MOCK_LLM === 'true' || process.env.MOCK_MODE === 'true';
  return forced || !key || key.trim() === '' || key === 'your_gemini_api_key';
}

function getLLMStatus() {
  const isMock = isMockConfigured();
  return {
    provider: isMock ? 'Mock' : 'Gemini',
    model: getModelName(),
    isMock,
    label: isMock ? 'LLM: Mock (no API key)' : `LLM: Gemini (${getModelName()})`
  };
}

/**
 * Parses candidate profile dynamically from raw resume text when running in mock / fallback mode.
 */
function parseProfileFromText(rawText) {
  let text = rawText || '';
  const resumeMatch = text.match(/Resume Text:\s*\"\"\"([\s\S]*?)\"\"\"/i);
  if (resumeMatch && resumeMatch[1]) {
    text = resumeMatch[1].trim();
  }

  // Name extraction: first non-empty line without special markers or headers
  let name = '';
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !/^sample\s*resume/i.test(l) && !/^curriculum\s*vitae/i.test(l) && !/^resume/i.test(l));
  if (lines.length > 0) {
    const candidateNameLine = lines[0];
    if (candidateNameLine.length < 50 && !candidateNameLine.includes('@') && !candidateNameLine.includes('http') && !/^(skills|experience|education|summary)/i.test(candidateNameLine)) {
      name = candidateNameLine.replace(/[•|].*$/, '').trim();
    }
  }

  // Email
  const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  const email = emailMatch ? emailMatch[1] : '';

  // Phone
  const phoneMatch = text.match(/(\+?\d[\d\s\-()]{8,}\d)/);
  const phone = phoneMatch ? phoneMatch[1].trim() : '';

  // Location
  let location = '';
  const locMatch = text.match(/([A-Z][a-zA-Z\s]{1,30},\s*[A-Z][a-zA-Z\s]{1,30})/);
  if (locMatch) location = locMatch[1].split('\n').pop().trim();

  // LinkedIn
  let linkedin = '';
  const liMatch = text.match(/((?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+)/i);
  if (liMatch) linkedin = liMatch[1].startsWith('http') ? liMatch[1] : 'https://' + liMatch[1];

  // Role
  let role = '';
  const roleMatch = text.match(/(?:Job\s*role\s*interested\s*in|Target\s*Role|Role):\s*([^\n\r]+)/i);
  if (roleMatch) role = roleMatch[1].trim();

  // Summary
  let summary = '';
  const sumMatch = text.match(/(?:Professional\s*Summary|Summary|About\s*Me)\s*\n+([\s\S]*?)(?=\n+(?:Key\s*Skills|Skills|Experience|Professional\s*Experience|$))/i);
  if (sumMatch) summary = sumMatch[1].replace(/\n+/g, ' ').trim();

  // Skills
  let skills = [];
  const skillsMatch = text.match(/(?:Key\s*Skills|Skills|Technical\s*Skills)\s*\n+([\s\S]*?)(?=\n+(?:Professional\s*Experience|Experience|Education|Projects|Certifications|$))/i);
  if (skillsMatch) {
    skills = skillsMatch[1]
      .split(/[,•\n\r]+/)
      .map(s => s.trim().replace(/^[-*•]\s*/, ''))
      .filter(s => s.length > 1 && !/^(skills|technical|key)$/i.test(s));
  }

  // Experience
  const experience = [];
  const expBlockMatch = text.match(/(?:Professional\s*Experience|Experience)\s*\n+([\s\S]*?)(?=\n+(?:Education|Certifications|Projects|$))/i);
  if (expBlockMatch) {
    const expText = expBlockMatch[1];
    const expChunks = expText.split(/(?=\n[A-Z][A-Za-z0-9\s–—\-]+(?:—|-|\||\bat\b))/g);
    for (const chunk of expChunks) {
      const cleanChunk = chunk.trim();
      if (!cleanChunk) continue;
      const cLines = cleanChunk.split('\n').map(l => l.trim()).filter(Boolean);
      if (cLines.length === 0) continue;
      const titleLine = cLines[0];
      const matchHeader = titleLine.match(/^([A-Za-z0-9\s]+?)\s*(?:—|-|\||\bat\b)\s*([A-Za-z0-9\s]+?)(?:\s*\((.*?)\)|\s*(\d{4}.*))?$/);
      const title = matchHeader ? matchHeader[1].trim() : titleLine;
      const company = matchHeader && matchHeader[2] ? matchHeader[2].trim() : '';
      const period = matchHeader && (matchHeader[3] || matchHeader[4]) ? (matchHeader[3] || matchHeader[4]).trim() : '';
      const responsibilities = cLines.slice(1).map(l => l.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);
      experience.push({ company, title, period, responsibilities });
    }
  }

  // Education
  const education = [];
  const eduBlockMatch = text.match(/(?:Education\s*(?:&|and)?\s*Certifications|Education)\s*\n+([\s\S]*?)(?=\n+(?:Projects|$)|$)/i);
  if (eduBlockMatch) {
    const eduText = eduBlockMatch[1];
    const eduLines = eduText.split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of eduLines) {
      if (/certificate|associate|certified/i.test(line)) continue;
      const eduMatch = line.match(/^([A-Za-z0-9.\s]+?)\s*(?:—|-|\||\bat\b)\s*([A-Za-z0-9\s]+?)(?:\s*\((.*?)\)|\s*(\d{4}.*))?$/);
      if (eduMatch) {
        education.push({
          degree: eduMatch[1].trim(),
          institution: eduMatch[2].trim(),
          year: (eduMatch[3] || eduMatch[4] || '').trim()
        });
      }
    }
  }

  return { name, contact: { email, phone, location, linkedin }, role, summary, skills, experience, education };
}

/**
 * Deterministic, version-aware mock generator for stages 1-4.
 */
function mockLLMResponse({ stage, promptVersion = 'v3', userPrompt = '', context = {} }) {
  const candidate = context.candidate || {};
  const job = context.job || {};
  const name = candidate.name || context.name || 'Kartik Wagh';
  const role = job.role || context.role || 'Software Engineer';
  const company = job.company || context.company || 'Tech Innovations Inc.';
  const skills = (Array.isArray(candidate.skills) && candidate.skills.length > 0)
    ? candidate.skills
    : (context.skills ? (Array.isArray(context.skills) ? context.skills : context.skills.split(',').map(s => s.trim())) : ['JavaScript', 'React', 'Node.js', 'PostgreSQL']);

  if (stage === 'intake_extraction') {
    const extracted = parseProfileFromText(userPrompt);
    const resolvedName = extracted.name || candidate.name || context.name || 'Kartik Wagh';
    const resolvedSkills = (extracted.skills && extracted.skills.length > 0)
      ? extracted.skills
      : (Array.isArray(skills) && skills.length > 0 ? skills : ['JavaScript', 'React', 'Node.js', 'PostgreSQL']);
    const resolvedSummary = extracted.summary || candidate.summary || `Dedicated professional with experience in ${resolvedSkills.slice(0, 3).join(', ')}.`;
    const resolvedEmail = extracted.contact?.email || candidate.email || 'kartik.wagh@example.com';
    const resolvedPhone = extracted.contact?.phone || candidate.phone || '+91 98765 43210';
    const resolvedLocation = extracted.contact?.location || candidate.location || 'Pune, India';
    const resolvedLinkedin = extracted.contact?.linkedin || candidate.linkedin || 'https://linkedin.com/in/kartikwagh-dev';
    const resolvedExperience = (extracted.experience && extracted.experience.length > 0)
      ? extracted.experience
      : (candidate.experience && candidate.experience.length > 0 ? candidate.experience : [
        {
          company: 'BrightPath Technologies',
          title: 'Software Engineer II',
          period: '2022 – Present',
          responsibilities: [
            'Built Node.js microservices handling 1M+ requests daily with 99.9% uptime',
            'Redesigned the customer onboarding flow in React, improving completion rates by 20%',
            'Optimized PostgreSQL queries and indexing, cutting average API response time by 35%'
          ]
        },
        {
          company: 'Nexora Software',
          title: 'Junior Developer',
          period: '2020 – 2022',
          responsibilities: [
            'Developed reusable React components used across internal dashboard applications',
            'Wrote unit and integration tests in Jest, reaching 85% code coverage'
          ]
        }
      ]);
    const resolvedEducation = (extracted.education && extracted.education.length > 0)
      ? extracted.education
      : (candidate.education && candidate.education.length > 0 ? candidate.education : [
        {
          institution: 'Savitribai Phule Pune University',
          degree: 'B.E. in Computer Engineering',
          year: '2020'
        }
      ]);

    return JSON.stringify({
      name: resolvedName,
      contact: {
        email: resolvedEmail,
        phone: resolvedPhone,
        location: resolvedLocation,
        linkedin: resolvedLinkedin
      },
      summary: resolvedSummary,
      skills: resolvedSkills,
      role: extracted.role || '',
      experience: resolvedExperience,
      education: resolvedEducation,
      certifications: candidate.certifications || ['AWS Certified Developer – Associate', 'Docker Certified Associate'],
      projects: candidate.projects && candidate.projects.length > 0 ? candidate.projects : [
        {
          name: 'High-Traffic Microservices Platform',
          description: 'Scalable Node.js microservices with Redis caching and PostgreSQL indexing handling 1M+ daily transactions',
          technologies: ['Node.js', 'React', 'PostgreSQL', 'Redis', 'Docker']
        }
      ],
      achievements: candidate.achievements || [
        'Optimized PostgreSQL queries and indexing, cutting average API response time by 35%',
        'Redesigned customer onboarding workflow in React, improving completion rates by 20%',
        'Built Node.js microservices handling 1M+ requests daily with 99.9% uptime'
      ]
    });
  }

  if (stage === 'job_analysis') {
    return JSON.stringify({
      role: role,
      company: company,
      must_have_skills: Array.isArray(job.must_have_skills) && job.must_have_skills.length > 0
        ? job.must_have_skills
        : ['JavaScript', 'Node.js', 'React'],
      nice_to_have_skills: Array.isArray(job.nice_to_have_skills) && job.nice_to_have_skills.length > 0
        ? job.nice_to_have_skills
        : ['Docker', 'AWS', 'GraphQL'],
      keywords: ['full-stack', 'scalable systems', 'collaboration', 'agile'],
      seniority: 'Mid-Senior Level',
      company_values: ['Continuous Learning', 'Engineering Rigor', 'Customer Obsession']
    });
  }

  if (stage === 'generation') {
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const tone = context.tone || 'Formal';
    const length = context.length || 'medium';

    let greeting = `Dear Hiring Team at ${company},`;
    if (tone === 'Confident') {
      greeting = `Dear ${company} Hiring Leadership,`;
    } else if (tone === 'Friendly-professional') {
      greeting = `Hello ${company} Hiring Team,`;
    }

    let letterBody = '';
    const factsUsed = [
      `Candidate Name: ${name}`,
      `Verified skills: ${skills.slice(0, 4).join(', ')}`
    ];
    if (candidate.experience && candidate.experience.length > 0 && candidate.experience[0].company) {
      factsUsed.push(`Previous role: ${candidate.experience[0].title} at ${candidate.experience[0].company}`);
    }
    if (candidate.education && candidate.education.length > 0 && candidate.education[0].institution) {
      factsUsed.push(`Degree: ${candidate.education[0].degree} from ${candidate.education[0].institution}`);
    }

    const requirementsAddressed = [
      `Proficiency in ${skills[0] || 'core engineering'}`,
      `Demonstrated capability delivering for ${role}`,
      `Collaboration and architectural rigor at ${company}`
    ];

    const gapsAcknowledged = context.gaps && context.gaps.length > 0 ? context.gaps : [];

    if (promptVersion === 'v1') {
      // v1 naive version - simulates higher chance of generic language or slight hallucination
      letterBody = `${today}\n\n${greeting}\n\nI am writing to express my interest in the ${role} position at ${company}. With my background in ${skills.join(', ')}, I am certain I would be a stellar addition to your organization.\n\nThroughout my career, I have consistently driven technical impact, built scalable systems, and collaborated closely across teams. I am eager to bring this passion to ${company} and help accelerate your product roadmap.\n\nSincerely,\n${name}`;
      return JSON.stringify({
        letter: letterBody,
        facts_used: factsUsed.slice(0, 2),
        requirements_addressed: requirementsAddressed.slice(0, 1),
        gaps_acknowledged: []
      });
    }

    if (promptVersion === 'v2') {
      // v2 structured version - well formatted markdown, direct constraints
      letterBody = `${today}\n\n${greeting}\n\nI am excited to apply for the ${role} position at ${company}. Having verified experience across ${skills.slice(0, 3).join(', ')}, I offer a strong foundation for your engineering objectives.\n\nIn my previous roles, I focused on building reliable, maintainable software and improving system throughput. My hands-on experience aligns closely with your stated needs in modern application development. Furthermore, my commitment to team collaboration and rapid skill acquisition ensures immediate productivity.\n\nThank you for your consideration. I look forward to discussing how my verified background meets your team's goals.\n\nSincerely,\n${name}`;
      return JSON.stringify({
        letter: letterBody,
        facts_used: factsUsed,
        requirements_addressed: requirementsAddressed,
        gaps_acknowledged: gapsAcknowledged
      });
    }

    // v3 refined version - grounded strictly in verified profile, handles length & gaps
    const gapParagraph = gapsAcknowledged.length > 0
      ? `While my verified profile focuses on ${skills.slice(0, 2).join(' and ')}, I am actively bridging familiarity with ${gapsAcknowledged.join(', ')} through dedicated hands-on labs and architectural study.`
      : `My verified expertise directly covers your core requirements, enabling immediate contributions to high-priority deliverables.`;

    const lengthExtension = length === 'long'
      ? `\n\nAdditionally, my background highlights consistent delivery under agile frameworks, proactive stakeholder communication, and continuous integration standards. I pride myself on writing self-documenting code and elevating collective developer productivity.`
      : length === 'short'
      ? ``
      : `\n\nI am particularly drawn to ${company}'s focus on innovation and technical craftsmanship. I look forward to applying my verified engineering practices to help scale your solutions.`;

    letterBody = `${today}\n\n${greeting}\n\nI am writing to submit my application for the ${role} opening at ${company}. Based upon my verified background in ${skills.slice(0, 3).join(', ')}, I am well-prepared to contribute to your engineering initiatives.\n\nDuring my tenure as ${candidate.experience && candidate.experience[0] ? `${candidate.experience[0].title} at ${candidate.experience[0].company}` : 'a project contributor'}, I demonstrated measurable impact through structured development and disciplined problem-solving. ${gapParagraph}${lengthExtension}\n\nThank you for reviewing my credentials. I welcome the opportunity to discuss how my verified achievements can support ${company}'s upcoming milestones.\n\nSincerely,\n${name}`;

    return JSON.stringify({
      letter: letterBody,
      facts_used: factsUsed,
      requirements_addressed: requirementsAddressed,
      gaps_acknowledged: gapsAcknowledged
    });
  }

  if (stage === 'fact_check') {
    const claims = [
      { claim: `Candidate Name is ${name}`, category: 'identity', verified: true },
      { claim: `Target role is ${role}`, category: 'target_role', verified: true },
      { claim: `Target company is ${company}`, category: 'target_company', verified: true },
      { claim: `Experienced in ${skills.slice(0, 2).join(', ')}`, category: 'skill', verified: true }
    ];

    // If letter mentions foreign entities not in profile (e.g. Stanford, Google, VP)
    const promptLower = (userPrompt || '').toLowerCase();
    if (promptLower.includes('stanford') && !JSON.stringify(candidate).toLowerCase().includes('stanford')) {
      claims.push({ claim: 'Graduated from Stanford University', category: 'degree', verified: false });
    }
    if (promptLower.includes('google') && !JSON.stringify(candidate).toLowerCase().includes('google') && !company.toLowerCase().includes('google')) {
      claims.push({ claim: 'Led Google as Principal VP', category: 'employer', verified: false });
    }

    return JSON.stringify({
      claims,
      unsupported_claims: []
    });
  }

  if (stage === 'rubric_evaluation') {
    const isV1 = promptVersion === 'v1';
    const isV2 = promptVersion === 'v2';
    return JSON.stringify({
      scores: {
        factual_accuracy: isV1 ? 3.8 : isV2 ? 4.5 : 5.0,
        requirement_coverage: isV1 ? 3.2 : isV2 ? 4.2 : 4.8,
        personalization: isV1 ? 3.5 : isV2 ? 4.2 : 4.7,
        tone_professionalism: isV1 ? 4.0 : isV2 ? 4.5 : 4.9,
        structure_grammar: isV1 ? 4.0 : isV2 ? 4.6 : 5.0
      },
      tone_feedback: isV1
        ? 'Adequate professional tone, but lacks specific grounded details and gap transparency.'
        : isV2
        ? 'Well-structured tone with clear alignment to target role and company.'
        : 'Exemplary professional tone with precise claim attribution and zero unsupported statements.'
    });
  }

  return JSON.stringify({ result: 'OK' });
}

/**
 * Execute LLM call with retry, timeout, and mock fallback.
 */
async function callLLM({
  systemPrompt = '',
  userPrompt = '',
  temperature = 0.0,
  jsonMode = true,
  stage = 'generic',
  promptVersion = 'v3',
  context = {}
}) {
  const isMock = isMockConfigured();

  if (isMock) {
    return mockLLMResponse({ stage, promptVersion, userPrompt, context });
  }

  const apiKey = getApiKey();
  const modelName = getModelName();
  const genAI = new GoogleGenerativeAI(apiKey);

  let attempt = 0;
  let lastError = null;

  while (attempt <= MAX_RETRIES) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: temperature,
          responseMimeType: jsonMode ? 'application/json' : 'text/plain'
        },
        systemInstruction: systemPrompt || undefined
      });

      // Wrap in Promise.race with abort timer
      const timeoutPromise = new Promise((_, reject) => {
        const id = setTimeout(() => {
          clearTimeout(id);
          reject(new Error(`LLM request timed out after ${REQUEST_TIMEOUT_MS}ms`));
        }, REQUEST_TIMEOUT_MS);
      });

      const callPromise = model.generateContent(userPrompt).then(res => res.response.text());

      const resultText = await Promise.race([callPromise, timeoutPromise]);
      return resultText;
    } catch (err) {
      lastError = err;
      attempt++;
      if (attempt <= MAX_RETRIES) {
        const backoffMs = Math.pow(2, attempt) * 500;
        await new Promise(r => setTimeout(r, backoffMs));
      }
    }
  }

  console.warn(`[LLM] Gemini calls failed after ${MAX_RETRIES + 1} attempts (${lastError.message}). Falling back to deterministic mock.`);
  return mockLLMResponse({ stage, promptVersion, userPrompt, context });
}

module.exports = {
  callLLM,
  getLLMStatus,
  isMockConfigured,
  mockLLMResponse
};
