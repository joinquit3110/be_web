const jwt = require('jsonwebtoken');

// Middleware para autenticación general
module.exports = function(req, res, next) {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ message: 'Access denied' });
  }

  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.user = verified;
    
    // Lookup the full user info from the database if needed
    if (!req.user.username) {
      // Find user info from the database later if needed
      console.log('[Auth] JWT payload missing username, only has id:', req.user.id);
    }
    
    next();
  } catch (err) {
    console.error('[Auth] Token verification error:', err.message);
    res.status(401).json({ message: 'Invalid token' });
  }
};

// Middleware para verificar privilegios de administrador
module.exports.requireAdmin = function(req, res, next) {
  console.log('[Auth] requireAdmin: Entry'); // New log
  // Debug admin auth checks
  console.log('[Auth] requireAdmin: User data from req.user:', JSON.stringify(req.user)); // Changed log message for clarity

  if (!req.user) {
    console.log('[Auth] requireAdmin: Failed - No user object in req');
    return res.status(401).json({ message: 'Authentication required' });
  }

  const username = req.user.username;
  console.log('[Auth] requireAdmin: Username from token:', username); // New log

  const ADMIN_USERS = ['hungpro', 'vipro'];
  if (ADMIN_USERS.includes(username)) {
    console.log(`[Auth] requireAdmin: Access granted to ${username} - Matched ADMIN_USERS list.`);
    next();
    return;
  }
  console.log(`[Auth] requireAdmin: User ${username} not in ADMIN_USERS list. Checking house/role.`); // New log

  if (req.user.house === 'admin') {
    console.log(`[Auth] requireAdmin: Access granted to ${username || req.user.id} - Matched house 'admin'.`);
    next();
    return;
  }
  console.log(`[Auth] requireAdmin: User ${username || req.user.id} house is not 'admin' (it is ${req.user.house}). Checking role.`); // New log

  if (req.user.role === 'admin') {
    console.log(`[Auth] requireAdmin: Access granted to ${username || req.user.id} - Matched role 'admin'.`);
    next();
    return;
  }
  
  // Check the explicit isAdmin flag in the token
  if (req.user.isAdmin === true) {
    console.log(`[Auth] requireAdmin: Access granted to ${username || req.user.id} - Found isAdmin flag in token.`);
    next();
    return;
  }
  
  console.log(`[Auth] requireAdmin: User ${username || req.user.id} role is not 'admin' (it is ${req.user.role}) and isAdmin flag is ${req.user.isAdmin}. Denying access.`);
  
  // If none of the above checks passed, deny access
  return res.status(403).json({ 
    message: 'Admin privileges required',
    userInfo: {
      username: username, // Use variable that might be undefined
      house: req.user.house,
      role: req.user.role,
      isUsernameInAdminList: ADMIN_USERS.includes(username), // Re-check for reporting
      isHouseAdmin: req.user.house === 'admin',
      isRoleAdmin: req.user.role === 'admin'
    }
  });
};
