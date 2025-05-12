const serverless = require('serverless-http');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Set environment flag
process.env.NETLIFY = 'true';

// Load the serverless-friendly version of your app
const app = require('../../app-serverless');

// Connect to MongoDB before handling requests
const MONGO_URI = process.env.MONGODB_URI;

// Create a connection handler
const connectToDatabase = async () => {
  if (mongoose.connection.readyState !== 1) {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('Connected to MongoDB');
  }
  return true;
};

// Create a serverless handler that ensures DB connection
const handler = serverless(app);

// Export the wrapped handler
module.exports.handler = async (event, context) => {
  // Keep the connection alive between function calls
  context.callbackWaitsForEmptyEventLoop = false;
  
  try {
    // Make sure we're connected to the database
    await connectToDatabase();
    
    // Handle the request
    return await handler(event, context);
  } catch (error) {
    console.error('Error in serverless handler:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Server Error', 
        message: error.message || 'Something went wrong'
      })
    };
  }
};
