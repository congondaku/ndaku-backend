const express = require('express');
const router = express.Router();
const { authenticate, roleCheck } = require('../middleware/auth');
const {
  registerAdmin,
  loginAdmin,
  getAllUsers,
  deleteUser,
  getAllListings,
  deleteListing,
  updateAdminProfile
} = require('../controllers/adminController');

// Admin Authentication
router.post('/register', registerAdmin);
router.post('/login', loginAdmin);

// User Management
router.get('/users', authenticate, roleCheck('admin'), getAllUsers);
router.delete('/users/:id', authenticate, roleCheck('admin'), deleteUser);

// Listing Management
router.get('/listings', authenticate, roleCheck('admin'), getAllListings);
router.delete('/listings/:id', authenticate, roleCheck('admin'), deleteListing);

// Admin Profile Update
router.put('/update-profile', authenticate, roleCheck(['admin', 'superadmin']), updateAdminProfile);

module.exports = router;
