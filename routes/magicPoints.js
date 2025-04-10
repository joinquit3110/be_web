const router = require('express').Router();
const auth = require('../middleware/auth');
const User = require('../models/User');

// Get user's magic points
router.get('/', auth, async (req, res) => {
  try {
    console.log(`[BE] Fetching magic points for user: ${req.user.id}`);
    const user = await User.findById(req.user.id);
    if (!user) {
      console.log(`[BE] User not found: ${req.user.id}`);
      return res.status(404).json({ message: 'User not found' });
    }
    
    console.log(`[BE] Returning magic points for user ${req.user.id}: ${user.magicPoints || 100}`);
    res.json({ magicPoints: user.magicPoints || 100 });
  } catch (err) {
    console.error('[BE] Error fetching magic points:', err);
    res.status(500).json({ message: err.message });
  }
});

// Update user's magic points
router.post('/', auth, async (req, res) => {
  try {
    const { magicPoints, timestamp } = req.body;
    console.log(`[BE] Updating magic points for user ${req.user.id} to ${magicPoints}`);
    
    if (magicPoints === undefined) {
      console.log('[BE] Magic points value is missing in the request');
      return res.status(400).json({ message: 'Magic points value is required' });
    }
    
    // Ensure points can't go below 0
    const validatedPoints = Math.max(0, parseInt(magicPoints, 10));
    
    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { 
        $set: { 
          magicPoints: validatedPoints, 
          lastMagicPointsUpdate: timestamp || new Date() 
        } 
      },
      { new: true }
    );
    
    if (!updatedUser) {
      console.log(`[BE] User not found when updating points: ${req.user.id}`);
      return res.status(404).json({ message: 'User not found' });
    }
    
    console.log(`[BE] Successfully updated magic points for user ${req.user.id} to ${updatedUser.magicPoints}`);
    res.json({ 
      magicPoints: updatedUser.magicPoints,
      timestamp: updatedUser.lastMagicPointsUpdate
    });
  } catch (err) {
    console.error('[BE] Error updating magic points:', err);
    res.status(500).json({ message: err.message });
  }
});

// Sync magic points - handles offline mode sync
router.post('/sync', auth, async (req, res) => {
  try {
    const { operations } = req.body;
    console.log(`[BE] Syncing ${operations?.length || 0} magic point operations for user ${req.user.id}`);
    
    // More robust validation of the operations array
    if (!operations || !Array.isArray(operations) || operations.length === 0) {
      console.log('[BE] Invalid or empty operations array in sync request');
      return res.status(400).json({ message: 'Valid non-empty operations array is required' });
    }
    
    // Log the first few operations for debugging
    const sampleOps = operations.slice(0, 3);
    console.log(`[BE] Sample operations (showing ${sampleOps.length} of ${operations.length}):`, 
      JSON.stringify(sampleOps));
    
    // Enhanced validation with specific error messages
    const invalidOps = [];
    operations.forEach((op, index) => {
      if (!op.type || !['add', 'remove', 'set'].includes(op.type)) {
        invalidOps.push({ index, reason: 'Invalid operation type', operation: op });
      } else if (typeof op.amount !== 'number' || isNaN(op.amount)) {
        // Try to convert string amounts to numbers
        if (typeof op.amount === 'string') {
          try {
            operations[index].amount = parseFloat(op.amount);
          } catch (e) {
            invalidOps.push({ index, reason: 'Amount is not convertible to number', operation: op });
          }
        } else {
          invalidOps.push({ index, reason: 'Amount must be a number', operation: op });
        }
      }
    });
    
    if (invalidOps.length > 0) {
      console.log(`[BE] Found ${invalidOps.length} invalid operations`);
      return res.status(400).json({ 
        message: 'Invalid operations format',
        details: invalidOps.slice(0, 3) // Return a sample of invalid operations
      });
    }
    
    // Get user and current points
    const user = await User.findById(req.user.id);
    if (!user) {
      console.log(`[BE] User not found when syncing points: ${req.user.id}`);
      return res.status(404).json({ message: 'User not found' });
    }
    
    let currentPoints = user.magicPoints || 100;
    console.log(`[BE] Current points before sync: ${currentPoints}`);
    
    // Process operations in order
    operations.forEach(op => {
      console.log(`[BE] Processing operation: ${op.type}, amount: ${op.amount}, source: ${op.source || 'unknown'}`);
      
      // Convert amount to number if it's a string (additional safety)
      const amount = typeof op.amount === 'string' ? parseFloat(op.amount) : op.amount;
      
      if (op.type === 'add') {
        currentPoints += amount;
      } else if (op.type === 'remove') {
        currentPoints = Math.max(0, currentPoints - amount);
      } else if (op.type === 'set') {
        currentPoints = Math.max(0, amount);
      }
    });
    
    console.log(`[BE] Points after processing operations: ${currentPoints}`);
    
    // Ensure points is a valid number
    if (isNaN(currentPoints)) {
      console.log(`[BE] Points calculation resulted in NaN, resetting to 100`);
      currentPoints = 100;
    }
    
    // Cap points at a reasonable maximum to prevent exploitation
    const MAX_POINTS = 1000;
    if (currentPoints > MAX_POINTS) {
      console.log(`[BE] Points exceeded maximum (${currentPoints} > ${MAX_POINTS}), capping at ${MAX_POINTS}`);
      currentPoints = MAX_POINTS;
    }
    
    // Update user with final point value
    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { 
        $set: { 
          magicPoints: currentPoints, 
          lastMagicPointsUpdate: new Date() 
        } 
      },
      { new: true }
    );
    
    if (!updatedUser) {
      console.log(`[BE] Failed to update user after sync: ${req.user.id}`);
      return res.status(500).json({ message: 'Failed to update user after operations' });
    }
    
    console.log(`[BE] Successfully synced points for user ${req.user.id}, new value: ${updatedUser.magicPoints}`);
    res.json({ 
      magicPoints: updatedUser.magicPoints,
      timestamp: updatedUser.lastMagicPointsUpdate
    });
  } catch (err) {
    console.error('[BE] Error syncing magic points:', err);
    res.status(500).json({ 
      message: err.message || 'Internal server error during point sync',
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined 
    });
  }
});

module.exports = router;
