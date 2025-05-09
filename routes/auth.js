const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const auth = require('../middleware/auth');  // Add this line
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/avatars')
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${req.user.id}-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const upload = multer({ 
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only images are allowed!'));
  }
});

// Register
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Check if user exists
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create new user
    const user = new User({
      username,
      email,
      password: hashedPassword
    });

    await user.save();

    // Create token
    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update login route with improved admin handling and logging
router.post('/login', async (req, res) => {
  console.log('Login attempt:', {
    username: req.body.username,
    // headers: req.headers // Headers can be verbose, log specific ones if needed
  });

  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });

    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials (user not found)' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials (password mismatch)' });
    }

    // Determine admin status based on DB record and ADMIN_USERS list
    const ADMIN_USERS_LIST = (process.env.ADMIN_USERS_CSV || 'hungpro,vipro').split(',');
    const isAdmin = ADMIN_USERS_LIST.includes(user.username) || user.role === 'admin' || user.house === 'admin';
    console.log(`[Login] User: ${user.username}, DB isAdmin check: ${isAdmin}, Role: ${user.role}, House: ${user.house}`);

    const payload = {
      id: user._id,
      username: user.username,
      house: user.house,
      role: user.role,
      isAdmin: isAdmin, // Ensure this is a boolean
    };

    const token = jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        // If user is determined to be admin, ensure their house/role in the returned object reflects admin status
        // This doesn't change the DB record here, just the object sent to client for this session.
        house: isAdmin ? (user.house === 'admin' ? 'admin' : user.house || 'admin') : user.house,
        role: isAdmin ? (user.role === 'admin' ? 'admin' : user.role || 'admin') : user.role,
        isAdmin: isAdmin,
        magicPoints: user.magicPoints !== undefined ? user.magicPoints : 100,
        // any other fields needed by frontend
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error during login', error: err.message });
  }
});

// Update profile route
router.put('/profile', auth, async (req, res) => {
  try {
    const updates = req.body;
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: updates },
      { new: true }
    );
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Avatar upload route
router.post('/avatar', auth, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const avatarUrl = `/uploads/avatars/${req.file.filename}`;
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: { avatar: avatarUrl } },
      { new: true }
    );

    res.json({ avatarUrl });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Verify token validity
router.get('/verify', auth, async (req, res) => {
  try {
    // If the auth middleware passed, req.user is populated from the token
    const userFromDB = await User.findById(req.user.id).select('-password');
    if (!userFromDB) {
      return res.status(404).json({ authenticated: false, message: 'User not found based on token ID' });
    }

    // Re-evaluate admin status based on current DB record for freshness and security
    const ADMIN_USERS_LIST = (process.env.ADMIN_USERS_CSV || 'hungpro,vipro').split(',');
    const isAdminDB = ADMIN_USERS_LIST.includes(userFromDB.username) || userFromDB.role === 'admin' || userFromDB.house === 'admin';
    console.log(`[Verify] User: ${userFromDB.username}, DB isAdmin check: ${isAdminDB}, Role: ${userFromDB.role}, House: ${userFromDB.house}`);

    res.json({
      authenticated: true,
      userId: userFromDB._id,
      username: userFromDB.username,
      house: userFromDB.house,
      role: userFromDB.role,
      isAdmin: isAdminDB, // Use the freshly checked admin status from DB
      magicPoints: userFromDB.magicPoints !== undefined ? userFromDB.magicPoints : 100,
      // Add any other fields the frontend expects from verification
    });
  } catch (err) {
    console.error('Error verifying token:', err);
    res.status(500).json({ authenticated: false, message: 'Server error during token verification', error: err.message });
  }
});

module.exports = router;
