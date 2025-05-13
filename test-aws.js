require('dotenv').config();
const AWS = require('aws-sdk');

console.log('Checking AWS credentials...');
console.log('MY_AWS_ACCESS_KEY_ID present:', !!process.env.MY_AWS_ACCESS_KEY_ID);
console.log('MY_AWS_SECRET_ACCESS_KEY present:', !!process.env.MY_AWS_SECRET_ACCESS_KEY); // Fix the variable name
console.log('MY_AWS_REGION:', process.env.MY_AWS_REGION);
console.log('MY_S3_BUCKET_NAME:', process.env.MY_S3_BUCKET_NAME);

// Configure AWS
AWS.config.update({
  accessKeyId: process.env.MY_AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.MY_AWS_SECRET_ACCESS_KEY,
  region: process.env.MY_AWS_REGION || 'us-east-1'
});
// Create S3 service object
const s3 = new AWS.S3();

async function testConnection() {
  try {
    const data = await s3.listBuckets().promise();
    console.log('Connection successful!');
    console.log('Available buckets:', data.Buckets.map(b => b.Name));
    
    // Test specific bucket access
    try {
      const objects = await s3.listObjectsV2({
        Bucket: process.env.MY_S3_BUCKET_NAME,
        MaxKeys: 5
      }).promise();
      
      console.log(`Access to bucket '${process.env.MY_S3_BUCKET_NAME}' successful!`);
      console.log(`Objects in bucket: ${objects.Contents.length}`);
    } catch (bucketError) {
      console.error(`Error accessing bucket: ${bucketError.message}`);
    }
  } catch (error) {
    console.error('Connection failed:', error.message);
  }
}

testConnection();
