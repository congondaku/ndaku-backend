require('dotenv').config();
const AWS = require('aws-sdk');

console.log('Checking AWS credentials...');
console.log('AWS_ACCESS_KEY_ID present:', !!process.env.AWS_ACCESS_KEY_ID);
console.log('AWS_SECRET_ACCESS_KEY present:', !!process.env.AWS_SECRET_ACCESS_KEY);
console.log('AWS_REGION:', process.env.AWS_REGION);
console.log('AWS_S3_BUCKET_NAME:', process.env.AWS_S3_BUCKET_NAME);

// Configure AWS
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
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
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        MaxKeys: 5
      }).promise();
      
      console.log(`Access to bucket '${process.env.AWS_S3_BUCKET_NAME}' successful!`);
      console.log(`Objects in bucket: ${objects.Contents.length}`);
    } catch (bucketError) {
      console.error(`Error accessing bucket: ${bucketError.message}`);
    }
  } catch (error) {
    console.error('Connection failed:', error.message);
  }
}

testConnection();
