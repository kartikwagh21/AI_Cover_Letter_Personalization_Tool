const multer = require('multer');

const errorHandler = (err, req, res, next) => {
  const errMsg = err ? (err.message || String(err)) : 'Unknown error';
  console.error('[Error Handler]', errMsg);

  // Handle Multer-specific errors
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'File is too large. Maximum allowed size is 5MB.'
      });
    }
    return res.status(400).json({
      success: false,
      error: `File upload error: ${err.message}`
    });
  }

  // Handle client-facing validation errors
  if (err.message && (err.message.includes('format') || err.message.includes('required') || err.message.includes('validation'))) {
    return res.status(400).json({
      success: false,
      error: err.message
    });
  }

  // Fallback to internal server error
  return res.status(500).json({
    success: false,
    error: err.message || 'An internal server error occurred'
  });
};

module.exports = errorHandler;
