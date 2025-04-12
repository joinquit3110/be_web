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
    next();
  } catch (err) {
    res.status(401).json({ message: 'Invalid token' });
  }
};

// Middleware para verificar privilegios de administrador
module.exports.requireAdmin = function(req, res, next) {
  // Verificar si el usuario existe en la solicitud (autenticado)
  if (!req.user) {
    return res.status(401).json({ message: 'Authentication required' });
  }
  
  // Verificar si el usuario tiene el rol de administrador
  // Podemos verificar por el campo "house" o "role" según cómo esté implementado
  if (req.user.house === 'admin' || req.user.role === 'admin' || 
      ['hungpro', 'vipro'].includes(req.user.username)) {
    next();
  } else {
    return res.status(403).json({ message: 'Admin privileges required' });
  }
};
