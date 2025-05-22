const express = require('express');
const {
  registerUser,
  loginUser,
  getCurrentUser,
  getUserProfile,
  updateProfile,
  changePassword,
  requestPhoneVerification,
  requestPasswordReset,
  resetPassword,
  deleteUser
} = require('../controllers/userController');
const { authenticate, roleCheck } = require('../middleware/auth');

const router = express.Router();

// Public Routes
router.post('/register', registerUser);
router.post('/login', loginUser);

// Password Reset Routes (Public) - These are the missing routes!
router.post('/request-password-reset', requestPasswordReset);
router.post('/reset-password', resetPassword);

// Protected Routes
router.get('/me', authenticate, getCurrentUser);
router.get('/profile', authenticate, getUserProfile);
router.put('/profile', authenticate, updateProfile);
router.put('/change-password', authenticate, changePassword);
router.post('/request-phone-verification', authenticate, requestPhoneVerification);

// Admin Routes
router.delete('/delete/:id', authenticate, roleCheck('admin'), deleteUser);

// Legacy route for backward compatibility
router.put('/update-profile', authenticate, updateProfile);

module.exports = router;
