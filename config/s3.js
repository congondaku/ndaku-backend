const AWS = require('aws-sdk');
const multerS3 = require('multer-s3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Load from environment variables only - no file reading
const awsAccessKeyId = process.env.AWS_ACCESS_KEY_ID;
const awsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
const awsRegion = process.env.AWS_REGION || 'us-east-1';
const bucketName = process.env.AWS_S3_BUCKET_NAME || 'congondaku';

// Log AWS config for debugging (without revealing actual credentials)
console.log('AWS Config:', {
  accessKeyExists: !!awsAccessKeyId,
  secretKeyExists: !!awsSecretAccessKey,
  region: awsRegion,
  bucket: bucketName
});

// Check for missing credentials
if (!awsAccessKeyId || !awsSecretAccessKey) {
  console.warn('⚠️ WARNING: AWS credentials not found in environment variables!');
  console.warn('Uploads may fall back to local storage');
}

// Create S3 service object with explicit credentials
const s3 = new AWS.S3({
  accessKeyId: awsAccessKeyId,
  secretAccessKey: awsSecretAccessKey,
  region: awsRegion
});

// Test S3 connection on startup
s3.listBuckets((err, data) => {
  if (err) {
    console.error('Error testing S3 connection:', err);
  } else {
    console.log('Successfully connected to AWS S3. Available buckets:',
      data.Buckets.map(b => b.Name).join(', '));
  }
});

// Configure multer with error handling
const storage = multerS3({
  s3: s3,
  bucket: bucketName,
  acl: 'public-read',
  contentType: multerS3.AUTO_CONTENT_TYPE,
  metadata: (req, file, cb) => {
    cb(null, { fieldName: file.fieldname });
  },
  key: (req, file, cb) => {
    const extension = path.extname(file.originalname);
    const filename = `real-estate-listings/${Date.now()}-${Math.floor(Math.random() * 1000000000)}${extension}`;
    cb(null, filename);
  }
});

// Fallback to disk storage if S3 fails
const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.floor(Math.random() * 1000)}${extension}`);
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed'), false);
  }
};

// Create multer upload with better error handling
let upload;
try {
  // Check if we have AWS credentials before trying to set up S3 storage
  if (awsAccessKeyId && awsSecretAccessKey) {
    upload = multer({
      storage: storage,
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
      fileFilter: fileFilter
    });
    console.log('S3 storage configured for uploads');
  } else {
    throw new Error('AWS credentials missing, falling back to disk storage');
  }
} catch (err) {
  console.error('Error configuring S3 storage:', err);
  console.log('Falling back to disk storage for uploads');
  upload = multer({
    storage: diskStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    fileFilter: fileFilter
  });
}

// Function to delete a file from S3
const deleteFileFromS3 = async (fileUrl) => {
  try {
    if (!fileUrl) {
      console.warn('No file URL provided for S3 deletion');
      return false;
    }
    
    // Simple URL parsing - just get everything after the bucket name
    const urlParts = fileUrl.split('/');
    const bucketIndex = urlParts.findIndex(part => 
      part === bucketName || part.includes('.s3.') || part.includes('amazonaws.com')
    );
    
    // Extract the key
    const key = urlParts.slice(bucketIndex + 1).join('/');
    
    if (!key) {
      console.warn('Could not parse S3 URL:', fileUrl);
      return false;
    }
    
    console.log(`Deleting from S3: bucket=${bucketName}, key=${key}`);
    
    const result = await s3.deleteObject({
      Bucket: bucketName,
      Key: key
    }).promise();
    
    console.log('S3 deletion successful, result:', result);
    return true;
  } catch (error) {
    console.error('S3 deletion error:', {
      message: error.message,
      code: error.code,
      stack: error.stack,
      fileUrl
    });
    // Return false but don't throw - we don't want to break the update flow
    return false;
  }
};

module.exports = {
  upload,
  deleteFileFromS3,
  s3 // Export s3 client for potential direct usage
};