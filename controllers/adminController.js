const Admin = require('../models/Admin');
const User = require('../models/User');
const Listing = require('../models/Listing');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Register an Admin
exports.registerAdmin = async (req, res) => {
  const { firstName, lastName, email, password } = req.body;

  try {
    const existingAdmin = await Admin.findOne({ email });
    if (existingAdmin) return res.status(400).json({ error: 'Admin already exists' });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const admin = new Admin({ firstName, lastName, email, password: hashedPassword });
    await admin.save();

    res.status(201).json({ message: 'Admin registered successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Error registering admin' });
  }
};

// Admin login
exports.loginAdmin = async (req, res) => {
  const { email, password } = req.body;

  try {
    const admin = await Admin.findOne({ email });
    if (!admin) return res.status(400).json({ message: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

    const token = jwt.sign({ adminId: admin._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

    res.status(200).json({ message: 'Login successful', token });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

// Fetch all users
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.status(200).json({ users });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching users' });
  }
};

// Delete a user
exports.deleteUser = async (req, res) => {
  const { id } = req.params;

  try {
    const user = await User.findByIdAndDelete(id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    res.status(200).json({ message: 'User deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

// View all listings
exports.getAllListings = async (req, res) => {
  try {
    const listings = await Listing.find();
    res.status(200).json({ listings });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching listings' });
  }
};

// Delete a listing
exports.deleteListing = async (req, res) => {
  const { id } = req.params;

  try {
    const listing = await Listing.findByIdAndDelete(id);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });

    res.status(200).json({ message: 'Listing deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

// Update admin profile
exports.updateAdminProfile = async (req, res) => {
  const { firstName, lastName, email, password } = req.body;
  const adminId = req.user?.adminId || req.admin?._id;

  try {
    const admin = await Admin.findById(adminId);
    if (!admin) return res.status(404).json({ message: 'Admin not found' });

    if (firstName) admin.firstName = firstName;
    if (lastName) admin.lastName = lastName;
    if (email) admin.email = email;
    if (password) {
      const salt = await bcrypt.genSalt(10);
      admin.password = await bcrypt.hash(password, salt);
    }

    await admin.save();
    res.status(200).json({ message: 'Profile updated successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Error updating profile' });
  }
};
