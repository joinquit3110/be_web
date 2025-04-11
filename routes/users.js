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

// Update user house assignment
router.patch('/:id', auth, async (req, res) => {
  try {
    const { house } = req.body;
    
    // Validate house value
    const validHouses = ['gryffindor', 'slytherin', 'ravenclaw', 'hufflepuff'];
    if (house && !validHouses.includes(house)) {
      return res.status(400).json({ message: 'Invalid house value' });
    }
    
    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      { $set: { house } },
      { new: true, select: '-password' }
    );
    
    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json(updatedUser);
  } catch (err) {
    console.error('Error updating user house:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 