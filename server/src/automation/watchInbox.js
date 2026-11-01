const fs = require('fs');
const path = require('path');
const { runPipeline } = require('../pipeline/pipeline');
const { executeAutomationWorkflow } = require('./automation');

const INBOX_DIR = path.join(__dirname, '../../inbox');
const PROCESSED_DIR = path.join(INBOX_DIR, 'processed');

function ensureInboxDirs() {
  if (!fs.existsSync(INBOX_DIR)) fs.mkdirSync(INBOX_DIR, { recursive: true });
  if (!fs.existsSync(PROCESSED_DIR)) fs.mkdirSync(PROCESSED_DIR, { recursive: true });
}

async function processFile(filePath) {
  const filename = path.basename(filePath);
  if (!filename.endsWith('.json') || filename.startsWith('.')) return;

  console.log(`[Inbox Watcher] Found candidate payload: ${filename}`);
  try {
    const rawContent = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(rawContent);

    const verifiedProfile = data.verifiedProfile || data.candidate || data;
    const jobDescription = data.jobDescription || data.job_description || '';
    const role = data.role || data.job_role || 'Software Engineer';
    const company = data.company || data.job_company || 'Tech Company';
    const tone = data.tone || 'Formal';
    const length = data.length || 'medium';
    const promptVersion = data.promptVersion || 'v3';

    console.log(`[Inbox Watcher] Executing pipeline for ${verifiedProfile.name} -> ${role} at ${company}...`);
    const pipelineResult = await runPipeline({
      verifiedProfile,
      jobDescription,
      role,
      company,
      tone,
      length,
      promptVersion
    });

    const workflowResult = await executeAutomationWorkflow({
      pipelineResult,
      jobDescription,
      modelProvider: 'CLI-Inbox-Watcher'
    });

    console.log(`[Inbox Watcher] Workflow completed successfully!`);
    console.log(`  - Run ID: ${workflowResult.run_id}`);
    console.log(`  - DOCX: ${workflowResult.docxFilePath}`);
    if (workflowResult.emlFilePath) console.log(`  - Email Draft: ${workflowResult.emlFilePath}`);
    console.log(`  - Receipt: ${workflowResult.receiptFilePath}`);

    // Move to processed
    const destPath = path.join(PROCESSED_DIR, `${Date.now()}_${filename}`);
    fs.renameSync(filePath, destPath);
    console.log(`  - Moved inbox file to: ${destPath}\n`);
  } catch (err) {
    console.error(`[Inbox Watcher] Failed processing ${filename}:`, err);
  }
}

async function scanInbox() {
  ensureInboxDirs();
  const files = fs.readdirSync(INBOX_DIR);
  for (const file of files) {
    const fullPath = path.join(INBOX_DIR, file);
    if (fs.statSync(fullPath).isFile() && file.endsWith('.json')) {
      await processFile(fullPath);
    }
  }
}

async function start() {
  ensureInboxDirs();
  console.log(`[Inbox Watcher] Monitoring inbox directory: ${INBOX_DIR}`);
  // Initial scan
  await scanInbox();

  const isContinuous = process.argv.includes('--watch') || process.argv.includes('-w');
  if (isContinuous) {
    console.log('[Inbox Watcher] Running in continuous watch mode. Press Ctrl+C to stop.');
    fs.watch(INBOX_DIR, async (eventType, filename) => {
      if (filename && filename.endsWith('.json')) {
        const fullPath = path.join(INBOX_DIR, filename);
        if (fs.existsSync(fullPath)) {
          // brief settle time
          setTimeout(() => scanInbox(), 500);
        }
      }
    });
  } else {
    console.log('[Inbox Watcher] Batch scan finished. (Pass --watch for persistent daemon).');
  }
}

if (require.main === module) {
  start();
}

module.exports = {
  scanInbox,
  processFile
};

