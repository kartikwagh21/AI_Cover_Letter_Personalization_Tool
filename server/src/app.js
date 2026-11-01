const express = require('express');
const cors = require('cors');
const resumeRoutes = require('./routes/resumeRoutes');
const apiRoutes = require('./routes/apiRoutes');
const errorHandler = require('./middlewares/errorHandler');
const { getLLMStatus } = require('./llm/llmClient');

const app = express();

// Apply global middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health Check Endpoints
app.get('/api/health', (req, res) => {
  const llmStatus = getLLMStatus();
  res.status(200).json({
    status: 'UP',
    message: 'AI Cover Letter Personalization backend is operational.',
    ...llmStatus,
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP', message: 'Backend service is online.' });
});

// Register routes
app.use('/api', apiRoutes);
app.use('/api/resume', resumeRoutes);

// Register global error handler (should be final middleware)
app.use(errorHandler);

module.exports = app;
