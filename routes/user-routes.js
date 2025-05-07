const express = require('express');
const {
  registerUser,
  loginUser,
  updateUserProfile,
  deleteUser,
  getCurrentUser,
} = require('../controllers/userController');
const { authenticate, roleCheck } = require('../middleware/auth');

const router = express.Router();

// Public Routes
router.post('/register', registerUser);
router.post('/login', loginUser);

// Protected Routes
router.get('/me', authenticate, getCurrentUser);
router.put('/update-profile', authenticate, updateUserProfile);
router.delete('/delete/:id', authenticate, roleCheck('admin'), deleteUser); // This line uses roleCheck correctly

module.exports = router;
