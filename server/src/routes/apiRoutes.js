const express = require('express');
const router = express.Router();
const uploadResume = require('../middlewares/upload');
const pipelineController = require('../controllers/pipelineController');

// Profile Extraction (Intake Stage)
router.post('/profile/extract', uploadResume, pipelineController.extractProfile);

// Cover Letter Generation & Automation Pipeline
router.post('/generate', pipelineController.generateCoverLetter);

// Run History & Details
router.get('/runs', pipelineController.listRuns);
router.get('/runs/:id', pipelineController.getRun);
router.get('/runs/:id/docx', pipelineController.downloadRunDocx);

// Multi-format Exports
router.get('/export/runs.csv', pipelineController.exportRunsCsv);
router.get('/export/runs.xlsx', pipelineController.exportRunsXlsx);

// Automation Inbox Trigger
router.post('/automation/process-inbox', pipelineController.triggerInboxProcess);

module.exports = router;

