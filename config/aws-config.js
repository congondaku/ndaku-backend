// config/aws-config.js
const AWS = require('aws-sdk');
const multerS3 = require('multer-s3');
const multer = require('multer');
const path = require('path');

// Check if AWS keys are available
if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  console.error('⚠️ AWS credentials not found in environment variables!');
  console.error('Please ensure AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are set in your .env file');
  console.error('File uploads might fail or fall back to local storage');
}

// Load environment variables 
const awsAccessKeyId = process.env.AWS_ACCESS_KEY_ID;
const awsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
const awsRegion = process.env.AWS_REGION || 'us-east-1';
const bucketName = process.env.AWS_S3_BUCKET_NAME || 'congondaku';

// Log AWS config for debugging
console.log('AWS Config:', {
  accessKeyExists: !!awsAccessKeyId,
  secretKeyExists: !!awsSecretAccessKey,
  region: awsRegion,
  bucket: bucketName
});

// Create S3 service object with explicit credentials
const s3 = new AWS.S3({
  accessKeyId: awsAccessKeyId,
  secretAccessKey: awsSecretAccessKey,
  region: awsRegion
});

// Test S3 connection
s3.listBuckets((err, data) => {
  if (err) {
    console.error('Error testing S3 connection:', err);
  } else {
    console.log('Successfully connected to AWS S3. Available buckets:',
      data.Buckets.map(b => b.Name).join(', '));
  }
});

// Configure multer
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

// Create multer upload with primary storage
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5 MB
  },
  fileFilter: fileFilter
});

// Function to delete a file from S3
const deleteFileFromS3 = async (fileUrl) => {
  try {
    if (!fileUrl) return false;
    
    // Extract key from S3 URL
    // Examples:
    // https://congondaku.s3.amazonaws.com/real-estate-listings/1234567890.jpg
    // https://s3.amazonaws.com/congondaku/real-estate-listings/1234567890.jpg
    
    let key = '';
    if (fileUrl.includes(bucketName)) {
      const urlParts = fileUrl.split('/');
      const bucketIndex = urlParts.findIndex(part => part === bucketName || part.includes(bucketName));
      if (bucketIndex >= 0) {
        key = urlParts.slice(bucketIndex + 1).join('/');
      }
    }
    
    if (!key) {
      console.warn('Could not parse S3 URL:', fileUrl);
      return false;
    }
    
    console.log(`Attempting to delete S3 file: ${key} from bucket ${bucketName}`);
    
    await s3.deleteObject({
      Bucket: bucketName,
      Key: key
    }).promise();
    
    console.log(`Successfully deleted file from S3: ${key}`);
    return true;
  } catch (error) {
    console.error('Error deleting file from S3:', error);
    return false;
  }
};

module.exports = {
  upload,
  deleteFileFromS3,
  s3 // Export s3 client for potential direct usage
};
