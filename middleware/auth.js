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
  // Debug admin auth checks
  console.log('[Auth] Admin check - User data:', JSON.stringify(req.user));
  
  // Verificar si el usuario existe en la solicitud (autenticado)
  if (!req.user) {
    console.log('[Auth] Admin check failed - No user object');
    return res.status(401).json({ message: 'Authentication required' });
  }
  
  // Get username from token or from user in request
  const username = req.user.username;
  
  // Check explicit admin users first (most reliable)
  const ADMIN_USERS = ['hungpro', 'vipro'];
  if (ADMIN_USERS.includes(username)) {
    console.log(`[Auth] Admin access granted to ${username} - Admin user`);
    next();
    return;
  }
  
  // Verificar si el usuario tiene el rol de administrador
  if (req.user.house === 'admin' || req.user.role === 'admin') {
    console.log(`[Auth] Admin access granted to ${username || req.user.id} - Admin role/house`);
    next();
    return;
  }
  
  // If none of the above checks passed, deny access
  console.log(`[Auth] Admin access denied to ${username || req.user.id} - Not an admin`);
  return res.status(403).json({ 
    message: 'Admin privileges required',
    userInfo: {
      hasUsername: !!username,
      hasHouse: !!req.user.house,
      hasRole: !!req.user.role
    }
  });
};
