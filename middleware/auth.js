const jwt = require('jsonwebtoken');

// Middleware para autenticación general
module.exports = function(req, res, next) {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // req.user will contain { id, username, house, role, isAdmin }
    next();
  } catch (err) {
    console.error('Token verification failed:', err.message);
    res.status(401).json({ message: 'Token is not valid' });
  }
};

// Middleware para verificar privilegios de administrador
module.exports.requireAdmin = function(req, res, next) {
  console.log('[Auth] requireAdmin: Entry');
  
  if (!req.user) {
    console.error('[Auth] requireAdmin: No user object found in request. This should be set by the general auth middleware.');
    return res.status(401).json({ message: 'Authentication required. No user data.' });
  }

  console.log('[Auth] requireAdmin: User data from req.user:', JSON.stringify(req.user));

  // Special handling for admin tokens from frontend debug components
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (token && token.startsWith('admin-token-')) {
    console.warn(`[Auth] requireAdmin: Detected fake admin token. This will not work with the server's JWT verification.`);
  }
  
  const { username, house, role, isAdmin } = req.user; // Destructure for easier access
  
  // For debugging the token structure and isAdmin flag type
  console.log(`[Auth] requireAdmin: isAdmin type: ${typeof isAdmin}, value: ${isAdmin}`);

  // 1. Check explicit isAdmin flag from token (should be the most reliable if set correctly during login)
  if (isAdmin === true) {
    console.log(`[Auth] requireAdmin: User ${username || req.user.id} authorized based on isAdmin flag in token.`);
    return next();
  } else if (isAdmin === 'true' || isAdmin === 1) {
    // Handle string 'true' or numeric 1 for isAdmin flag (common source of bugs)
    console.log(`[Auth] requireAdmin: User ${username || req.user.id} authorized based on isAdmin flag (non-boolean true value).`);
    return next();
  }
  
  console.log(`[Auth] requireAdmin: isAdmin flag is not true (value: ${isAdmin}). Proceeding with other checks.`);

  // 2. Check against ADMIN_USERS_LIST from environment variable
  const adminUsersEnv = process.env.ADMIN_USERS_CSV || 'hungpro,vipro';  // Default admin users
  // Ensure ADMIN_USERS_LIST is an array of strings, even if env var is empty or undefined
  const ADMIN_USERS_LIST = adminUsersEnv ? adminUsersEnv.split(',').map(u => u.trim()).filter(u => u) : [];
  
  console.log(`[Auth] requireAdmin: Admin users list: ${ADMIN_USERS_LIST.join(', ')}`);

  if (username && ADMIN_USERS_LIST.length > 0 && ADMIN_USERS_LIST.includes(username)) {
    console.log(`[Auth] requireAdmin: User ${username} authorized as admin from ADMIN_USERS_LIST.`);
    return next();
  }
  if (username) {
    console.log(`[Auth] requireAdmin: User ${username} not in ADMIN_USERS_LIST (List: ${ADMIN_USERS_LIST.join(', ')}). Checking house/role.`);
  } else {
    console.log(`[Auth] requireAdmin: Username not present in token. Checking house/role.`);
  }
  

  // 3. Check house (less common, but for completeness)
  if (house === 'admin') {
    console.log(`[Auth] requireAdmin: User ${username || req.user.id} authorized based on house 'admin'.`);
    return next();
  }
  console.log(`[Auth] requireAdmin: User ${username || req.user.id} house is not 'admin' (it is ${house}). Checking role.`);

  // 4. Check role
  if (role === 'admin') {
    console.log(`[Auth] requireAdmin: User ${username || req.user.id} authorized based on role 'admin'.`);
    return next();
  }
  console.log(`[Auth] requireAdmin: User ${username || req.user.id} role is not 'admin' (it is ${role}).`);
  
  // If none of the above checks passed, deny access
  console.log(`[Auth] requireAdmin: Access denied for user ${username || req.user.id}. No admin criteria met.`);
  return res.status(403).json({ 
    message: 'Admin privileges required. Access denied.',
    details: {
      username: username,
      house: house,
      role: role,
      isAdminFlagInToken: isAdmin, // This is the isAdmin from the token
      isUsernameInAdminList: username ? ADMIN_USERS_LIST.includes(username) : false,
      isHouseAdmin: house === 'admin',
      isRoleAdmin: role === 'admin',
      adminListSource: ADMIN_USERS_LIST.length > 0 ? `Env (ADMIN_USERS_CSV=${adminUsersEnv})` : 'Not configured or empty'
    }
  });
};
