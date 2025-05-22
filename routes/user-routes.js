const express = require('express');

console.log('🔍 Loading user controller...');
try {
  const userController = require('../controllers/userController');
  console.log('🔍 User controller loaded successfully');
  console.log('🔍 Available functions:', Object.keys(userController));
  console.log('🔍 requestPasswordReset type:', typeof userController.requestPasswordReset);
  console.log('🔍 resetPassword type:', typeof userController.resetPassword);
} catch (error) {
  console.error('🚨 Error loading user controller:', error);
}

const {
  registerUser,
  loginUser,
  updateUserProfile,
  deleteUser,
  getCurrentUser,
  requestPasswordReset,
  resetPassword
} = require('../controllers/userController');

const { authenticate, roleCheck } = require('../middleware/auth');

const router = express.Router();

// Public Routes
router.post('/register', registerUser);
router.post('/login', loginUser);

// Password Reset Routes
router.post('/request-password-reset', requestPasswordReset);
router.post('/reset-password', resetPassword);

// Protected Routes
router.get('/me', authenticate, getCurrentUser);
router.put('/update-profile', authenticate, updateUserProfile);
router.delete('/delete/:id', authenticate, roleCheck('admin'), deleteUser);

module.exports = router;