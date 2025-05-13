// diagnose-env.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');

console.log('\n==== ENVIRONMENT DIAGNOSTIC TOOL ====\n');

// Check .env file
const envPath = path.resolve(__dirname, '.env');
console.log(`Checking .env file at: ${envPath}`);
if (fs.existsSync(envPath)) {
  console.log('✅ .env file exists');
  
  // Check file size and permissions
  const stats = fs.statSync(envPath);
  console.log(`File size: ${stats.size} bytes`);
  console.log(`File permissions: ${stats.mode.toString(8).slice(-3)}`);
  
  // Read file and check for AWS variables (safely)
  const envContent = fs.readFileSync(envPath, 'utf8');
  const lines = envContent.split('\n');
  
  const awsKeys = lines.filter(line => 
    line.trim().startsWith('AWS_') && 
    !line.trim().startsWith('#')
  ).length;
  
  console.log(`Found ${awsKeys} AWS-related variables in .env file`);
} else {
  console.log('❌ .env file not found');
}

// Check environment variables
console.log('\n== Environment Variables ==');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('MY_AWS_SECRET_ACCESS_KEY exists:', !!process.env.MY_AWS_SECRET_ACCESS_KEY);
console.log('MY_AWS_SECRET_ACCESS_KEY exists:', !!process.env.MY_AWS_SECRET_ACCESS_KEY);
console.log('MY_AWS_REGION exists:', !!process.env.MY_AWS_REGION);
console.log('MY_S3_BUCKET_NAME exists:', !!process.env.MY_S3_BUCKET_NAME);

// Import AWS config to test it
try {
  console.log('\n== Testing AWS Config Import ==');
  const { s3 } = require('./config/aws-config');
  console.log('✅ AWS config imported successfully');
  
  // Test S3 connection
  console.log('\n== Testing S3 Connection ==');
  s3.listBuckets((err, data) => {
    if (err) {
      console.log('❌ S3 connection failed:', err.message);
    } else {
      console.log('✅ S3 connection successful');
      console.log('Available buckets:', data.Buckets.map(b => b.Name));
    }
    
    console.log('\n==== DIAGNOSTIC COMPLETE ====');
  });
} catch (error) {
  console.log('❌ Error importing AWS config:', error.message);
  console.log('\n==== DIAGNOSTIC COMPLETE WITH ERRORS ====');
}