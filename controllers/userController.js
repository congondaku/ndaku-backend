const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const WhatsAppVerification = require('../models/WhatsAppVerification');
const whatsappService = require('../services/whatsappService');

// Register User
const registerUser = async (req, res) => {
  const { firstName, lastName, phoneNumber, email, password } = req.body;

  try {
    // Check if user already exists
    const existingUser = await User.findOne({ $or: [{ email }, { phoneNumber }] });

    if (existingUser) {
      return res.status(400).json({ message: 'Email or phone number already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = new User({
      firstName,
      lastName,
      phoneNumber,
      email,
      password: hashedPassword,
    });

    await user.save();

    res.status(201).json({ message: 'User registered successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error while registering user' });
  }
};

// Login User
const loginUser = async (req, res) => {
  const { email, password } = req.body;

  try {
    console.log('Login attempt with email:', email); // 👈 Check what email is being sent

    const user = await User.findOne({ email });

    console.log('Found user:', user); // 👈 See if user is found

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: '1h',
    });

    res.status(200).json({
      message: "Login successful",
      token,
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        username: user.username,
      },
    })
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error while logging in' });
  }
};


// Get Current User
const getCurrentUser = async (req, res) => {
  try {
    const user = req.user;
    const { password, ...userWithoutPassword } = user.toObject();

    res.status(200).json({ user: userWithoutPassword });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error while fetching user' });
  }
};

// Update Profile
const updateUserProfile = async (req, res) => {
  const { firstName, lastName, phoneNumber } = req.body;

  try {
    const user = req.user;

    user.firstName = firstName || user.firstName;
    user.lastName = lastName || user.lastName;
    user.phoneNumber = phoneNumber || user.phoneNumber;
    user.profileUpdated = true;

    await user.save();

    res.status(200).json({ message: 'Profile updated successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error while updating profile' });
  }
};

// Delete User (admin only)
const deleteUser = async (req, res) => {
  const { id } = req.params;

  try {
    const user = await User.findByIdAndDelete(id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error while deleting user' });
  }
};

const normalizePhoneNumber = (phoneNumber) => {
  if (!phoneNumber) return '';
  let normalized = phoneNumber.replace(/[^\d+]/g, '');
  if (!normalized.startsWith('+')) {
    normalized = '+' + normalized;
  }
  return normalized;
};

// Generate 6-digit reset code
const generateResetCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Request Password Reset via WhatsApp
const requestPasswordReset = async (req, res) => {
  try {
    let { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    // Normalize phone number
    phoneNumber = normalizePhoneNumber(phoneNumber);
    console.log(`🔐 Password reset request for: ${phoneNumber.substring(0, 7)}***`);

    // Check if user exists with this phone number
    const user = await User.findOne({ phoneNumber });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this phone number'
      });
    }

    // Check if WhatsApp service is ready
    const serviceStatus = whatsappService.getStatus();
    if (!serviceStatus.isReady) {
      return res.status(503).json({
        success: false,
        message: 'WhatsApp service temporarily unavailable'
      });
    }

    // Check for existing reset request (rate limiting)
    const existingReset = await WhatsAppVerification.findByPhone(phoneNumber);
    if (existingReset) {
      if (existingReset.isBlocked()) {
        return res.status(429).json({
          success: false,
          message: 'Too many attempts. Please try again later.',
          blockedUntil: existingReset.blockedUntil
        });
      }

      // Rate limit: 1 request per minute
      const timeSinceLastAttempt = Date.now() - existingReset.lastAttemptAt;
      if (timeSinceLastAttempt < 60000) {
        return res.status(429).json({
          success: false,
          message: 'Please wait before requesting another code',
          retryAfter: Math.ceil((60000 - timeSinceLastAttempt) / 1000)
        });
      }
    }

    // Generate reset code
    const resetCode = generateResetCode();

    // Save reset request to database
    await WhatsAppVerification.createVerification(phoneNumber, resetCode);

    // Send reset code via WhatsApp
    const resetMessage = `🔐 *Réinitialisation de mot de passe Ndaku*

Bonjour ${user.firstName},

Votre code de réinitialisation est: *${resetCode}*

Ce code expire dans 5 minutes.
⚠️ Ne partagez ce code avec personne.

Si vous n'avez pas demandé cette réinitialisation, ignorez ce message.

---
Ndaku - Plateforme de location sécurisée`;

    await whatsappService.sendMessage(phoneNumber, resetMessage);

    // Log the action (without sensitive data)
    console.log(`🔐 Password reset code sent via WhatsApp to ${phoneNumber.substring(0, 7)}***`);

    res.json({
      success: true,
      message: 'Password reset code sent via WhatsApp',
      phoneNumber: phoneNumber.substring(0, 7) + '***'
    });

  } catch (error) {
    console.error('Error sending password reset code:', error);

    let errorMessage = 'Failed to send reset code';
    let statusCode = 500;

    if (error.message.includes('not registered')) {
      errorMessage = 'Phone number not registered on WhatsApp';
      statusCode = 400;
    } else if (error.message.includes('not ready')) {
      errorMessage = 'WhatsApp service temporarily unavailable';
      statusCode = 503;
    }

    res.status(statusCode).json({
      success: false,
      message: errorMessage
    });
  }
};

// Verify Reset Code and Update Password
const resetPassword = async (req, res) => {
  try {
    let { phoneNumber, code, newPassword } = req.body;

    if (!phoneNumber || !code || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Phone number, code, and new password are required'
      });
    }

    // Validate new password strength
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Normalize phone number
    phoneNumber = normalizePhoneNumber(phoneNumber);

    // Find verification record
    const verification = await WhatsAppVerification.findByPhone(phoneNumber);
    if (!verification) {
      return res.status(400).json({
        success: false,
        message: 'Reset code expired or not found'
      });
    }

    // Check if blocked
    if (verification.isBlocked()) {
      return res.status(429).json({
        success: false,
        message: 'Too many failed attempts. Please request a new code.',
        blockedUntil: verification.blockedUntil
      });
    }

    // Verify the code
    if (verification.verificationCode !== code) {
      await verification.incrementAttempts();
      
      return res.status(400).json({
        success: false,
        message: 'Invalid reset code',
        attemptsLeft: Math.max(0, 5 - verification.attempts)
      });
    }

    // Find user by phone number
    const user = await User.findOne({ phoneNumber });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update user password
    user.password = hashedPassword;
    await user.save();

    // Clean up verification record
    await WhatsAppVerification.deleteOne({ _id: verification._id });

    // Log successful password reset
    console.log(`🔐 Password reset successful for ${phoneNumber.substring(0, 7)}***`);

    // Send confirmation message
    const confirmationMessage = `✅ *Mot de passe mis à jour - Ndaku*

Bonjour ${user.firstName},

Votre mot de passe a été mis à jour avec succès.

Si ce n'était pas vous, contactez-nous immédiatement.

---
Ndaku - Plateforme de location sécurisée`;

    try {
      await whatsappService.sendMessage(phoneNumber, confirmationMessage);
    } catch (error) {
      console.error('Failed to send confirmation message:', error);
      // Don't fail the request if confirmation message fails
    }

    res.json({
      success: true,
      message: 'Password reset successfully'
    });

  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset password'
    });
  }
};

module.exports = {
  registerUser,
  loginUser,
  updateUserProfile,
  getCurrentUser,
  deleteUser,
  requestPasswordReset,
  resetPassword
};
