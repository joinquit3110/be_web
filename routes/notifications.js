const router = require('express').Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const mongoose = require('mongoose');

// In-memory storage for active notifications (in a real app, use a database or message queue)
const activeNotifications = [];

// Create a notification
router.post('/', auth, async (req, res) => {
  try {
    const { type, title, message, targetUsers, housesAffected } = req.body;
    
    if (!type || !message) {
      return res.status(400).json({ message: 'Type and message are required fields' });
    }
    
    // Create a new notification
    const notification = {
      id: mongoose.Types.ObjectId().toString(),
      type, // success, warning, error, info
      title: title || (type === 'success' ? 'Success' : 'Notification'),
      message,
      timestamp: new Date().toISOString(),
      targetUsers: targetUsers || [], // If empty, notify all users
      housesAffected: housesAffected || [], // If specified, notify all users in these houses
      expiresAt: new Date(Date.now() + 30000) // Expires in 30 seconds
    };
    
    // Add to active notifications
    activeNotifications.push(notification);
    
    // Clean up old notifications
    const now = new Date();
    const activeNotificationsFiltered = activeNotifications.filter(
      n => new Date(n.expiresAt) > now
    );
    activeNotifications.length = 0;
    activeNotifications.push(...activeNotificationsFiltered);
    
    res.status(201).json(notification);
  } catch (err) {
    console.error('Error creating notification:', err);
    res.status(500).json({ message: err.message });
  }
});

// Get all active notifications for the current user
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Filter notifications that target this user
    const now = new Date();
    const userNotifications = activeNotifications.filter(notification => {
      // Check if notification is still active
      if (new Date(notification.expiresAt) <= now) {
        return false;
      }
      
      // Include if targetUsers is empty (all users) or contains this user's ID
      const isTargetUser = notification.targetUsers.length === 0 || 
                           notification.targetUsers.includes(userId);
      
      // Include if user's house is in housesAffected
      const isHouseAffected = notification.housesAffected.length === 0 || 
                             (user.house && notification.housesAffected.includes(user.house));
      
      return isTargetUser || isHouseAffected;
    });
    
    res.json(userNotifications);
  } catch (err) {
    console.error('Error fetching notifications:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 