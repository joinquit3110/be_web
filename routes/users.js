const router = require('express').Router();
const User = require('../models/User');
const auth = require('../middleware/auth');

// Get all users - only for admins
router.get('/', auth, async (req, res) => {
  try {
    // In a real application, you'd implement admin authorization here
    const users = await User.find({}, '-password'); // Exclude password field
    res.json({ users });
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ message: err.message });
  }
});

// Get a specific user by ID
router.get('/:id', auth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id, '-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user);
  } catch (err) {
    console.error('Error fetching user:', err);
    res.status(500).json({ message: err.message });
  }
});

// Update user house assignment with improved socket notifications
router.patch('/:id', auth, async (req, res) => {
  try {
    const userId = req.params.id;
    const { house, magicPoints, needsSync } = req.body;
    const updateFields = {};
    
    // Track which fields are being updated for notifications
    const updatedFields = {};

    // Validate house value if provided
    if (house !== undefined) {
      // Validate house value
      const validHouses = ['gryffindor', 'slytherin', 'ravenclaw', 'hufflepuff', 'muggle', 'admin'];
      if (!validHouses.includes(house)) {
        return res.status(400).json({ message: 'Invalid house value' });
      }
      updateFields.house = house;
      updatedFields.house = house;
    }

    // Update magic points if provided
    if (magicPoints !== undefined) {
      updateFields.magicPoints = Math.max(0, magicPoints);
      updatedFields.magicPoints = Math.max(0, magicPoints);
    }
    
    // Update needsSync if provided
    if (needsSync !== undefined) {
      updateFields.needsSync = needsSync;
      if (needsSync) {
        updateFields.syncRequestedAt = new Date();
      }
    }
    
    // Make sure there's something to update
    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }
    
    // Update timestamp
    updateFields.updatedAt = new Date();
    
    // Find the user before update to get previous house info
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const oldHouse = user.house;
    
    // Update the user in the database
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateFields },
      { new: true, runValidators: true }
    );
    
    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Enhanced notification for house changes through Socket.io
    const io = req.app.get('io');
    const activeConnections = req.app.get('activeConnections');
    
    if (io) {
      // Get socket ID for this user if they're connected
      const socketId = activeConnections.get(userId);
      
      if (socketId) {
        console.log(`User ${userId} is online. Sending direct update via socket ${socketId}`);
        
        // If the house changed, handle room changes in socket.io
        if (house !== undefined && oldHouse !== house) {
          // Emit house change event to user
          io.to(socketId).emit('sync_update', {
            type: 'user_update',
            timestamp: new Date().toISOString(),
            message: `Your house has been updated to ${house}`,
            data: { 
              userId,
              updatedFields: { house }
            }
          });
          
          // Also send to admin room for monitoring
          io.to('admin').emit('admin_update', {
            type: 'user_house_changed',
            timestamp: new Date().toISOString(),
            data: { userId, oldHouse, newHouse: house, username: updatedUser.username }
          });
        }
        
        // If magic points changed, notify the user
        if (magicPoints !== undefined) {
          io.to(socketId).emit('sync_update', {
            type: 'user_update',
            timestamp: new Date().toISOString(),
            message: `Your magic points have been updated to ${magicPoints}`,
            data: { 
              userId,
              updatedFields: { magicPoints }
            }
          });
        }
      } else {
        console.log(`User ${userId} is offline. Marking for sync when they come back online.`);
        // Mark user for sync when they come back online
        await User.findByIdAndUpdate(userId, {
          $set: { 
            needsSync: true,
            syncRequestedAt: new Date() 
          }
        });
      }
      
      // For house changes, also notify everyone in the old and new houses
      if (house !== undefined && oldHouse !== house) {
        console.log(`Broadcasting house change: ${userId} moved from ${oldHouse || 'unassigned'} to ${house}`);
        
        // Notify old house if the user was previously in a house
        if (oldHouse) {
          io.to(oldHouse).emit('house_update', {
            type: 'member_left',
            timestamp: new Date().toISOString(),
            message: `A member has left ${oldHouse}`,
            data: { userId }
          });
        }
        
        // Notify new house if it's not null
        if (house) {
          io.to(house).emit('house_update', {
            type: 'member_joined',
            timestamp: new Date().toISOString(),
            message: `A new member has joined ${house}`,
            data: { userId }
          });
        }
        
        // Send global notification for significant house changes (like assigning admin)
        if (house === 'admin') {
          io.emit('global_update', {
            type: 'user_role_changed',
            timestamp: new Date().toISOString(),
            message: `A new administrator has been appointed`,
            data: { userId }
          });
        }
      }
    }

    res.json(updatedUser);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ message: error.message });
  }
});

// Bulk update for all users in a house (admin feature)
router.post('/bulk-update', auth, async (req, res) => {
  try {
    const { house, magicPointsChange, reason } = req.body;
    
    if (!house) {
      return res.status(400).json({ message: 'House parameter is required' });
    }

    if (magicPointsChange === undefined) {
      return res.status(400).json({ message: 'Magic points change parameter is required' });
    }

    // Find all users in the specified house
    const usersInHouse = await User.find({ house });
    
    if (usersInHouse.length === 0) {
      return res.status(404).json({ message: `No users found in ${house} house` });
    }

    // Update each user's points
    const updatePromises = usersInHouse.map(user => {
      const currentPoints = user.magicPoints || 0;
      const newPoints = Math.max(0, currentPoints + magicPointsChange);
      
      return User.findByIdAndUpdate(
        user._id,
        { 
          $set: { 
            magicPoints: newPoints,
            lastMagicPointsUpdate: new Date() 
          } 
        }
      );
    });
    
    await Promise.all(updatePromises);
    
    // Get Socket.IO instance
    const io = req.app.get('io');
    
    if (io) {
      // Broadcast to the house room
      io.to(house).emit('house_update', {
        type: 'house_points_changed',
        house: house,
        pointsChange: magicPointsChange,
        reason: reason || 'House points updated by admin',
        timestamp: new Date().toISOString()
      });
      
      // Also broadcast global notification
      io.emit('global_update', {
        type: 'house_points_bulk_update',
        house: house,
        pointsChange: magicPointsChange,
        message: `${house} has ${magicPointsChange >= 0 ? 'gained' : 'lost'} ${Math.abs(magicPointsChange)} points${reason ? ': ' + reason : ''}`,
        timestamp: new Date().toISOString()
      });
      
      console.log(`Broadcast bulk points update to ${house} house: ${magicPointsChange} points`);
    }
    
    res.json({ 
      success: true,
      message: `Updated ${usersInHouse.length} users in ${house}`,
      updatedUsers: usersInHouse.map(u => u._id)
    });
  } catch (err) {
    console.error('Error performing bulk update:', err);
    res.status(500).json({ message: err.message });
  }
});

// Force sync for users (admin feature)
router.post('/force-sync', auth, async (req, res) => {
  try {
    // Get the list of userIds to sync
    const { userIds } = req.body;
    
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ message: 'Valid userIds array is required' });
    }
    
    // Get Socket.IO instance
    const io = req.app.get('io');
    const activeConnections = req.app.get('activeConnections');
    
    if (!io) {
      return res.status(500).json({ message: 'Socket.IO is not available' });
    }
    
    // Track which users were successfully notified
    const notifiedUsers = [];
    const offlineUsers = [];
    
    // Send sync request to each connected user
    for (const userId of userIds) {
      const socketId = activeConnections.get(userId.toString());
      
      if (socketId) {
        // User is connected - send direct sync request
        io.to(socketId).emit('sync_update', {
          type: 'force_sync',
          timestamp: new Date().toISOString(),
          message: 'Admin requested sync'
        });
        console.log(`Sent force sync to user ${userId}, socket: ${socketId}`);
        notifiedUsers.push(userId);
      } else {
        // User is offline - mark for next login
        offlineUsers.push(userId);
        
        // Set a flag in the database that user needs to sync when they log back in
        await User.findByIdAndUpdate(
          userId,
          { $set: { needsSync: true, syncRequestedAt: new Date() } }
        );
        console.log(`User ${userId} is offline, marked for future sync`);
      }
    }
    
    res.json({
      success: true,
      message: `Force sync triggered for ${notifiedUsers.length} online users and ${offlineUsers.length} offline users`,
      notifiedUsers,
      offlineUsers
    });
  } catch (err) {
    console.error('Error forcing sync:', err);
    res.status(500).json({ message: err.message });
  }
});

// Add bulk sync endpoint for multiple users
router.post('/bulk-sync', auth, async (req, res) => {
  try {
    const { users, adminId } = req.body;
    
    if (!users || !Array.isArray(users) || users.length === 0) {
      return res.status(400).json({ message: 'Valid users array is required' });
    }
    
    // Validate if request is coming from an admin
    const adminUser = await User.findById(adminId || req.user.id);
    if (!adminUser || adminUser.house !== 'admin') {
      return res.status(403).json({ message: 'Admin privileges required for bulk operations' });
    }
    
    const results = [];
    const io = req.app.get('io');
    const activeConnections = req.app.get('activeConnections');
    
    // Process each user update
    for (const userUpdate of users) {
      try {
        const { userId, house, magicPoints, needsSync } = userUpdate;
        
        if (!userId) {
          results.push({ 
            userId: 'invalid', 
            success: false, 
            message: 'Missing userId' 
          });
          continue;
        }
        
        const updateFields = {};
        
        if (house !== undefined) {
          // Validate house value
          const validHouses = ['gryffindor', 'slytherin', 'ravenclaw', 'hufflepuff', 'muggle', 'admin'];
          if (!validHouses.includes(house)) {
            results.push({ 
              userId, 
              success: false, 
              message: 'Invalid house value' 
            });
            continue;
          }
          updateFields.house = house;
        }
        
        if (magicPoints !== undefined) {
          updateFields.magicPoints = Math.max(0, parseInt(magicPoints, 10));
          updateFields.lastMagicPointsUpdate = new Date();
        }
        
        if (needsSync !== undefined) {
          updateFields.needsSync = needsSync;
        }
        
        // Skip if no updates
        if (Object.keys(updateFields).length === 0) {
          results.push({ 
            userId, 
            success: false, 
            message: 'No valid update fields provided' 
          });
          continue;
        }
        
        // Update user in database
        const updatedUser = await User.findByIdAndUpdate(
          userId,
          { $set: updateFields },
          { new: true, select: '-password' }
        );
        
        if (!updatedUser) {
          results.push({ 
            userId, 
            success: false, 
            message: 'User not found' 
          });
          continue;
        }
        
        // Send real-time update if user is connected
        if (io) {
          const socketId = activeConnections.get(userId.toString());
          
          if (socketId) {
            // User is online - send direct update
            io.to(socketId).emit('sync_update', {
              type: 'user_update',
              data: {
                userId: updatedUser._id,
                updatedFields: updateFields
              }
            });
            
            // If house was updated, notify all users
            if (house !== undefined) {
              io.emit('global_update', {
                type: 'user_house_changed',
                userId: updatedUser._id.toString(),
                username: updatedUser.username,
                house,
                message: `${updatedUser.username} has been assigned to ${house}`
              });
            }
            
            // If points were updated, notify house members
            if (magicPoints !== undefined && updatedUser.house) {
              io.to(updatedUser.house).emit('house_update', {
                type: 'member_points_changed',
                userId: updatedUser._id,
                username: updatedUser.username,
                house: updatedUser.house,
                magicPoints: updatedUser.magicPoints,
                timestamp: new Date().toISOString()
              });
            }
          } else {
            // User is offline - mark for future sync
            await User.findByIdAndUpdate(
              userId,
              { 
                $set: { 
                  needsSync: true, 
                  syncRequestedAt: new Date() 
                } 
              }
            );
          }
        }
        
        results.push({ 
          userId: updatedUser._id.toString(), 
          success: true,
          user: {
            username: updatedUser.username,
            house: updatedUser.house,
            magicPoints: updatedUser.magicPoints
          }
        });
      } catch (userError) {
        console.error(`Error processing user update:`, userError);
        results.push({ 
          userId: userUpdate.userId || 'unknown', 
          success: false, 
          message: userError.message || 'Processing error'
        });
      }
    }
    
    res.json({
      success: true,
      results
    });
  } catch (err) {
    console.error('Error processing bulk update:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;