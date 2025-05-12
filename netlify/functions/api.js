const serverless = require('serverless-http');
const app = require('../../app'); // This points to your app.js file

// Winston might have issues in a serverless environment, so let's handle that
// If winston has any serverless-specific issues, they'll be caught here
try {
  // Wrap the Express app with serverless handler
  module.exports.handler = serverless(app);
} catch (error) {
  console.error('Error initializing serverless handler:', error);
  
  // Provide a fallback handler in case of winston initialization issues
  module.exports.handler = async (event, context) => {
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Server initialization error',
        message: 'There was a problem setting up the serverless environment'
      })
    };
  };
}