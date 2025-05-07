// controllers/authController.js

const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Login route
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });

  if (!user || !(await user.matchPassword(password))) {
    return res.status(400).json({ message: 'Invalid email or password' });
  }

  // Generate Access Token (expires in 1 hour)
  const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

  // Generate Refresh Token (expires in 7 days)
  const refreshToken = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

  // Save refresh token in the database
  user.refreshToken = refreshToken;
  await user.save();

  res.status(200).json({
    message: 'Login successful',
    token,         // Access token
    refreshToken,  // Refresh token
  });
});

// Refresh Token route (for token renewal)
router.post('/refresh-token', async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ message: 'Refresh token required' });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);

    if (!user || user.refreshToken !== refreshToken) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    // Generate new access token
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

    res.status(200).json({ token });
  } catch (error) {
    res.status(401).json({ message: 'Invalid refresh token' });
  }
});
