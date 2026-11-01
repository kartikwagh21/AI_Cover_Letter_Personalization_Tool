const path = require('path');
const fs = require('fs');

let sqliteDB = null;
let useJsonFallback = false;

const DB_DIR = path.join(__dirname, '../../data');
const DB_FILE = path.join(DB_DIR, 'runs.db');
const JSON_BACKUP_FILE = path.join(DB_DIR, 'runs.json');

function ensureDirectories() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
}

function maskContactInfo(text = '') {
  if (!text) return '';
  // Mask email: s***@domain.com
  let masked = text.replace(/([a-zA-Z0-9_\-\.])[a-zA-Z0-9_\-\.]+@([a-zA-Z0-9_\-\.]+)/g, '$1***@$2');
  // Mask phone numbers
  masked = masked.replace(/(\+\d{1,3}[- ]?)?\(?\d{3}\)?[-. ]?\d{3}[-. ]?(\d{4})/g, '***-***-$2');
  return masked;
}

function initDB() {
  ensureDirectories();
  try {
    const Database = require('better-sqlite3');
    sqliteDB = new Database(DB_FILE);
    sqliteDB.pragma('journal_mode = WAL');

    sqliteDB.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        candidate_name TEXT,
        candidate_summary_masked TEXT,
        candidate_raw_json TEXT,
        job_role TEXT,
        job_company TEXT,
        job_description TEXT,
        prompt_version TEXT,
        model_provider TEXT,
        letter TEXT,
        match_analysis_json TEXT,
        rubric_scores_json TEXT,
        unsupported_claims_json TEXT,
        is_pass INTEGER,
        overall_score REAL,
        latency_ms INTEGER
      )
    `);
    console.log('[Storage] SQLite initialized at:', DB_FILE);
    useJsonFallback = false;
  } catch (err) {
    console.warn('[Storage] better-sqlite3 init failed or unavailable, falling back to JSON store:', err.message);
    useJsonFallback = true;
    if (!fs.existsSync(JSON_BACKUP_FILE)) {
      fs.writeFileSync(JSON_BACKUP_FILE, JSON.stringify([]), 'utf8');
    }
  }
}

function saveRun(runData) {
  if (!sqliteDB && !useJsonFallback) {
    initDB();
  }

  const id = runData.id || `run_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const timestamp = runData.timestamp || new Date().toISOString();
  const candidateName = runData.candidateProfile?.name || runData.candidate_name || 'Candidate';
  const rawSummary = runData.candidateProfile?.summary || '';
  const maskedSummary = maskContactInfo(rawSummary || `Profile for ${candidateName}`);
  const candidateRawJson = JSON.stringify(runData.candidateProfile || {});
  const jobRole = runData.jobAnalysis?.role || runData.job_role || 'Job Role';
  const jobCompany = runData.jobAnalysis?.company || runData.job_company || 'Target Company';
  const jobDescription = runData.jobDescription || '';
  const promptVersion = runData.promptVersion || 'v3';
  const modelProvider = runData.modelProvider || 'Gemini/Mock';
  const letter = runData.letterOutput?.letter || runData.letter || '';
  const matchAnalysisJson = JSON.stringify(runData.jobAnalysis || {});
  const rubricScoresJson = JSON.stringify(runData.evaluation?.rubric || {});
  const unsupportedClaimsJson = JSON.stringify(runData.evaluation?.unsupported_claims || []);
  const isPass = runData.evaluation?.rubric?.is_pass ? 1 : (runData.is_pass ? 1 : 0);
  const overallScore = runData.evaluation?.rubric?.overall ?? (runData.overall_score ?? 0);
  const latencyMs = runData.latency_ms || 0;

  const record = {
    id,
    timestamp,
    candidate_name: candidateName,
    candidate_summary_masked: maskedSummary,
    candidate_raw_json: candidateRawJson,
    job_role: jobRole,
    job_company: jobCompany,
    job_description: jobDescription,
    prompt_version: promptVersion,
    model_provider: modelProvider,
    letter,
    match_analysis_json: matchAnalysisJson,
    rubric_scores_json: rubricScoresJson,
    unsupported_claims_json: unsupportedClaimsJson,
    is_pass: isPass,
    overall_score: overallScore,
    latency_ms: latencyMs
  };

  if (!useJsonFallback && sqliteDB) {
    const stmt = sqliteDB.prepare(`
      INSERT OR REPLACE INTO runs (
        id, timestamp, candidate_name, candidate_summary_masked, candidate_raw_json,
        job_role, job_company, job_description, prompt_version, model_provider,
        letter, match_analysis_json, rubric_scores_json, unsupported_claims_json,
        is_pass, overall_score, latency_ms
      ) VALUES (
        @id, @timestamp, @candidate_name, @candidate_summary_masked, @candidate_raw_json,
        @job_role, @job_company, @job_description, @prompt_version, @model_provider,
        @letter, @match_analysis_json, @rubric_scores_json, @unsupported_claims_json,
        @is_pass, @overall_score, @latency_ms
      )
    `);
    stmt.run(record);
  } else {
    // JSON fallback
    ensureDirectories();
    let rows = [];
    if (fs.existsSync(JSON_BACKUP_FILE)) {
      try {
        rows = JSON.parse(fs.readFileSync(JSON_BACKUP_FILE, 'utf8'));
      } catch (e) {
        rows = [];
      }
    }
    const idx = rows.findIndex(r => r.id === id);
    if (idx >= 0) {
      rows[idx] = record;
    } else {
      rows.unshift(record);
    }
    fs.writeFileSync(JSON_BACKUP_FILE, JSON.stringify(rows, null, 2), 'utf8');
  }

  return record;
}

function getRuns(limit = 50) {
  if (!sqliteDB && !useJsonFallback) {
    initDB();
  }

  if (!useJsonFallback && sqliteDB) {
    const rows = sqliteDB.prepare(`
      SELECT id, timestamp, candidate_name, candidate_summary_masked,
             job_role, job_company, prompt_version, model_provider,
             is_pass, overall_score, latency_ms
      FROM runs
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(limit);
    return rows;
  } else {
    try {
      if (!fs.existsSync(JSON_BACKUP_FILE)) return [];
      const rows = JSON.parse(fs.readFileSync(JSON_BACKUP_FILE, 'utf8'));
      return rows.slice(0, limit).map(r => ({
        id: r.id,
        timestamp: r.timestamp,
        candidate_name: r.candidate_name,
        candidate_summary_masked: r.candidate_summary_masked,
        job_role: r.job_role,
        job_company: r.job_company,
        prompt_version: r.prompt_version,
        model_provider: r.model_provider,
        is_pass: r.is_pass,
        overall_score: r.overall_score,
        latency_ms: r.latency_ms
      }));
    } catch (e) {
      return [];
    }
  }
}

function getRunById(id) {
  if (!sqliteDB && !useJsonFallback) {
    initDB();
  }

  if (!useJsonFallback && sqliteDB) {
    const row = sqliteDB.prepare(`SELECT * FROM runs WHERE id = ?`).get(id);
    return row || null;
  } else {
    try {
      if (!fs.existsSync(JSON_BACKUP_FILE)) return null;
      const rows = JSON.parse(fs.readFileSync(JSON_BACKUP_FILE, 'utf8'));
      return rows.find(r => r.id === id) || null;
    } catch (e) {
      return null;
    }
  }
}

// Auto-initialize on module load
initDB();

module.exports = {
  initDB,
  saveRun,
  getRuns,
  getRunById,
  maskContactInfo
};
