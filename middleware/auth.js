const jwt = require('jsonwebtoken');
const User = require('../models/User');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'auth.log' })
  ]
});

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      logger.warn('Authentication failed: No token provided', { ip: req.ip });
      return res.status(401).json({ message: 'Authentication required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');

    if (!user) {
      logger.warn('Authentication failed: User not found', { userId: decoded.userId });
      return res.status(401).json({ message: 'User not found' });
    }

    // Update last login
    await user.updateLastLogin();

    req.user = user;
    req.token = token;
    
    logger.info('Authentication successful', { userId: user._id, ip: req.ip });
    next();
  } catch (error) {
    logger.error('Authentication error', { error: error.message, ip: req.ip });
    res.status(401).json({ message: 'Invalid token' });
  }
};

module.exports = auth;
