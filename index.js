require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const { MongoClient, ServerApiVersion } = require('mongodb');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const exerciseRoutes = require('./routes/exercises');
const scoreRoutes = require('./routes/scores');
const magicPointsRoutes = require('./routes/magicPoints');
const userRoutes = require('./routes/users');
const notificationsRoutes = require('./routes/notifications');
const path = require('path');

const app = express();

// Enhanced CORS configuration for better offline/online synchronization
app.use(cors({
  origin: [
    'https://fe-web-lilac.vercel.app',  // Vercel frontend
    'http://localhost:3000',            // Local development
    'https://inequality-web.vercel.app', // Alternative frontend URL
    'https://mw15w-5173.csb.app',       // CodeSandbox URL
    'capacitor://localhost',            // Mobile app via Capacitor
    'http://localhost',                 // Alternative local development
    'http://localhost:8080',            // Another common local port
    'http://localhost:8100',            // Ionic default port
    '*'                                 // Allow all origins in development (remove in production)
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true, // Allow cookies
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

// Set additional headers for better CORS handling
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,PATCH,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin,X-Requested-With,Content-Type,Accept,Authorization');
  next();
});

// Increase payload size limit for sync operations with many items
app.use(express.json({ limit: '5mb' }));

// Connect to MongoDB with updated configuration
console.log('Attempting to connect to MongoDB...');
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('MongoDB URI is missing. Make sure MONGODB_URI is set in .env file');
  process.exit(1);
}

// Log a masked version of the connection string for debugging (hide password)
const maskedURI = MONGODB_URI.replace(/:([^:@]+)@/, ':******@');
console.log(`Connecting to MongoDB: ${maskedURI}`);

mongoose.connect(MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 30000, // Server selection timeout is 30 seconds
  socketTimeoutMS: 45000, // Socket timeout is 45 seconds
})
.then(() => console.log("Successfully connected to MongoDB Atlas!"))
.catch(err => {
  console.error('MongoDB connection error:', err);
  
  // More detailed error logging
  if (err.name === 'MongoParseError') {
    console.error('Invalid MongoDB connection string. Please check your MONGODB_URI in .env');
  } else if (err.name === 'MongoServerSelectionError') {
    console.error('Cannot connect to MongoDB server. Please check your network or MongoDB Atlas status');
  } else if (err.message && err.message.includes('Authentication failed')) {
    console.error('MongoDB authentication failed. Please check your username and password');
  }
  
  process.exit(1); // Stop the program if connection fails
});

// Socket.IO setup with improved connection tracking
const socketIO = require('socket.io');
const server = require('http').createServer(app);
const io = socketIO(server, {
  cors: {
    origin: '*', // Allow all origins in development
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingTimeout: 30000, // How long to wait before considering a client disconnected
  pingInterval: 10000, // How often to ping clients to check connection
});

// Admin users constant for filtering notifications
const ADMIN_USERS = ['hungpro', 'vipro'];

// Store active connections with improved handling
const activeConnections = new Map();
// Track user online status with timestamps
const userStatus = new Map(); // userId -> { online: boolean, lastSeen: Date }

// Track recent house point updates to prevent duplicates
const recentHousePointsUpdates = new Map();

// Add notification batching and caching
const notificationCache = new Map();
const notificationBatch = new Map();
const BATCH_TIMEOUT = 100; // ms
const MAX_BATCH_SIZE = 10;

// Helper to process notification batch
const processNotificationBatch = (room) => {
  const batch = notificationBatch.get(room);
  if (!batch || batch.length === 0) return;
  
  try {
    // Sort by priority and timestamp
    batch.sort((a, b) => {
      const priorityA = getNotificationPriority(a);
      const priorityB = getNotificationPriority(b);
      if (priorityA !== priorityB) return priorityB - priorityA;
      return new Date(b.timestamp) - new Date(a.timestamp);
    });
    
    // Take only the most important notifications
    const notificationsToSend = batch.slice(0, MAX_BATCH_SIZE);
    
    // Send batch to room
    io.to(room).emit('notification_batch', {
      notifications: notificationsToSend,
      timestamp: new Date().toISOString()
    });
    
    // Clear batch
    notificationBatch.set(room, []);
    
    // Update cache
    notificationsToSend.forEach(notification => {
      const cacheKey = `${room}:${notification.id}`;
      notificationCache.set(cacheKey, {
        notification,
        timestamp: Date.now()
      });
    });
    
  } catch (error) {
    console.error('Error processing notification batch:', error);
  }
};

// Helper to determine notification priority
const getNotificationPriority = (notification) => {
  if (notification.type === 'error') return 4;
  if (notification.type === 'warning') return 3;
  if (notification.type === 'success') return 2;
  if (notification.type === 'announcement') return 1;
  return 0;
};

// Optimize notification sending
const sendNotification = (room, notification) => {
  try {
    // Check cache for duplicate
    const cacheKey = `${room}:${notification.id}`;
    const cached = notificationCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < 5000) {
      return false; // Skip if recently sent
    }
    
    // Add to batch
    if (!notificationBatch.has(room)) {
      notificationBatch.set(room, []);
    }
    
    const batch = notificationBatch.get(room);
    batch.push(notification);
    
    // Process batch if it's full
    if (batch.length >= MAX_BATCH_SIZE) {
      processNotificationBatch(room);
    } else {
      // Schedule batch processing
      setTimeout(() => processNotificationBatch(room), BATCH_TIMEOUT);
    }
    
    return true;
  } catch (error) {
    console.error('Error sending notification:', error);
    return false;
  }
};

// Cleanup old cache entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of notificationCache.entries()) {
    if (now - value.timestamp > 60000) { // 1 minute
      notificationCache.delete(key);
    }
  }
}, 30000); // Run every 30 seconds

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('New client connected', socket.id);
  let authenticatedUserId = null;
  
  // Handle user authentication
  socket.on('authenticate', (userData) => {
    if (userData && userData.userId) {
      // Ensure userId is always a string for consistent comparison
      authenticatedUserId = userData.userId.toString();
      
      // Store user connection for targeted updates
      activeConnections.set(authenticatedUserId, socket.id);
      
      // Update online status
      userStatus.set(authenticatedUserId, { 
        online: true, 
        lastSeen: new Date(),
        house: userData.house || null,
        username: userData.username || null
      });
      
      // Join user to their house room if available
      if (userData.house) {
        socket.join(userData.house);
        console.log(`User ${authenticatedUserId} joined house ${userData.house}`);
        
        // Also join a role-based room
        const role = userData.isAdmin ? 'admin' : 'student';
        socket.join(role);
      }
      
      // Join admin broadcast channel for system-wide announcements
      socket.join('system-updates');
      
      console.log(`User ${authenticatedUserId} authenticated, socket ID: ${socket.id}`);
      console.log(`Active connections: ${activeConnections.size}`);
      
      // Notify user they are connected
      socket.emit('connection_status', { 
        connected: true, 
        timestamp: new Date().toISOString(),
        message: 'Successfully connected to real-time updates'
      });
    }
  });
  
  // Handle heartbeat to keep track of active users
  socket.on('heartbeat', () => {
    if (authenticatedUserId) {
      const status = userStatus.get(authenticatedUserId);
      if (status) {
        status.lastSeen = new Date();
        userStatus.set(authenticatedUserId, status);
      }
    }
  });
  
  // Handle house change
  socket.on('change_house', async ({ userId, oldHouse, newHouse }) => {
    if (oldHouse) {
      socket.leave(oldHouse);
      console.log(`User ${userId} left house ${oldHouse}`);
    }
    
    if (newHouse) {
      socket.join(newHouse);
      console.log(`User ${userId} joined house ${newHouse}`);
      
      // Update user status with new house
      if (userId && userStatus.has(userId.toString())) {
        const status = userStatus.get(userId.toString());
        status.house = newHouse;
        userStatus.set(userId.toString(), status);
        
        // Send notification to the user about house change
        socket.emit('sync_update', {
          type: 'user_update',
          timestamp: new Date().toISOString(),
          data: {
            updatedFields: {
              house: newHouse
            }
          }
        });
      }
    }
  });
  
  // NEW: Handle admin house points update
  socket.on('admin_house_points', ({ house, points, reason, criteria, level }) => {
    if (!house || !points) return;
    
    console.log(`Admin updating ${house} points by ${points}. Reason: ${reason}`);
    
    const notification = {
      id: `house_points_${house}_${points}_${Date.now()}`,
      type: points > 0 ? 'success' : 'warning',
      title: points > 0 ? 'POINTS AWARDED!' : 'POINTS DEDUCTED!',
      message: formatHousePointsMessage(house, points, reason, criteria, level),
      timestamp: new Date().toISOString(),
      points,
      reason,
      criteria,
      level
    };
    
    sendNotification(house, notification);
  });
  
  // NEW: Handle admin targeted notification
  socket.on('admin_notification', ({ targetUser, targetHouse, message, notificationType }) => {
    const notification = {
      id: `admin_${Date.now()}`,
      type: notificationType || 'info',
      message,
      timestamp: new Date().toISOString()
    };
    
    if (targetUser && activeConnections.has(targetUser)) {
      const socketId = activeConnections.get(targetUser);
      const user = userStatus.get(targetUser);
      if (user) {
        sendNotification(user.house, notification);
      }
    }
    
    if (targetHouse) {
      sendNotification(targetHouse, notification);
    }
  });
  
  // NEW: Handle global announcement from admin
  socket.on('global_announcement', ({ message }) => {
    const notification = {
      id: `announcement_${Date.now()}`,
      type: 'announcement',
      message: `ANNOUNCEMENT: ${message}`,
      timestamp: new Date().toISOString()
    };
    
    // Send to all rooms
    for (const [room] of notificationBatch) {
      sendNotification(room, notification);
    }
  });
  
  // Handle client-sent house point notifications (direct from frontend)
  socket.on('client_house_notification', (data) => {
    try {
      const { house, points, reason, criteria, level, newTotal } = data;
      
      console.log('[SOCKET] Received client_house_notification:', JSON.stringify(data));
      console.log('[SOCKET] Notification details:', {
        house, 
        points, 
        reason: reason || 'No reason provided', 
        criteria: criteria || 'No criteria provided', 
        level: level || 'No level provided'
      });
      
      if (!house || points === undefined) {
        console.log('[SOCKET] Ignoring invalid client_house_notification:', data);
        return;
      }
      
      // Enhanced logging
      console.log(`[SOCKET] Processing client house notification: ${house} ${points} points, reason: ${reason || 'None'}`);
      console.log(`[SOCKET] Criteria: ${criteria || 'None'}, Level: ${level || 'None'}`);
      console.log(`[SOCKET] Auth user ID: ${authenticatedUserId || 'Not authenticated'}`);
      
      // Get user info to determine if they're an admin
      if (authenticatedUserId) {
        // Check user info with consistent string ID
        const userInfo = userStatus.get(authenticatedUserId);
        
        console.log(`[SOCKET] User info for ${authenticatedUserId}:`, userInfo ? 
          JSON.stringify({
            house: userInfo.house,
            username: userInfo.username,
            isAdmin: ADMIN_USERS.includes(userInfo.username)
          }) : 'Not found');
        
        const isAdmin = userInfo && (userInfo.house === 'admin' || ADMIN_USERS.includes(userInfo.username));
        
        if (isAdmin) {
          // Use the same function that server-side updates use
          console.log(`[SOCKET] User ${authenticatedUserId} is admin, broadcasting house points update`);
          console.log(`[SOCKET] Passing reason "${reason}", criteria "${criteria}", level "${level}"`);
          
          const result = app.locals.broadcastHousePointsUpdate(
            house, 
            points, 
            newTotal || null, 
            reason || 'Admin action', 
            false, // Don't skip admin
            criteria, 
            level
          );
          
          console.log(`[SOCKET] broadcastHousePointsUpdate result: ${result ? 'Success' : 'Failed'}`);
        } else {
          console.log(`[SOCKET] Rejected house notification from non-admin user: ${authenticatedUserId}`);
          // Send a notice back to the user that they lack permission
          socket.emit('error_notification', {
            message: 'You do not have permission to update house points',
            timestamp: new Date().toISOString()
          });
        }
      } else {
        console.log('[SOCKET] Rejected unauthenticated house notification');
        socket.emit('error_notification', {
          message: 'Authentication required to update house points',
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('[SOCKET] Error processing client_house_notification:', error);
      socket.emit('error_notification', {
        message: 'Server error processing your request',
        timestamp: new Date().toISOString()
      });
    }
  });
  
  // Handle force sync request from client
  socket.on('request_sync', () => {
    if (authenticatedUserId) {
      console.log(`User ${authenticatedUserId} requested data sync`);
      socket.emit('sync_update', {
        type: 'force_sync',
        timestamp: new Date().toISOString(),
        message: 'Sync requested by client'
      });
    }
  });
  
  // NEW: Handle user real-time status request
  socket.on('get_online_users', ({ house }, callback) => {
    // Get all online users, optionally filtering by house
    const onlineUsers = [];
    
    for (const [userId, status] of userStatus.entries()) {
      if (status.online && (!house || status.house === house)) {
        onlineUsers.push({
          userId,
          username: status.username,
          house: status.house,
          lastSeen: status.lastSeen
        });
      }
    }
    
    // If this has a callback, call it with the results
    if (typeof callback === 'function') {
      callback(onlineUsers);
    } else {
      // Otherwise, emit an event back
      socket.emit('online_users', { users: onlineUsers });
    }
  });
  
  // Handle disconnect
  socket.on('disconnect', () => {
    // Remove user from activeConnections
    if (authenticatedUserId) {
      activeConnections.delete(authenticatedUserId);
      
      // Update online status
      if (userStatus.has(authenticatedUserId)) {
        const status = userStatus.get(authenticatedUserId);
        status.online = false;
        status.lastSeen = new Date();
        userStatus.set(authenticatedUserId, status);
      }
      
      console.log(`User ${authenticatedUserId} disconnected`);
    }
    
    console.log(`Client disconnected ${socket.id}, remaining connections: ${activeConnections.size}`);
  });
});

// Add periodic cleanup of stale connections
setInterval(() => {
  const now = new Date();
  let cleanedCount = 0;
  
  // Check for stale entries in userStatus
  for (const [userId, status] of userStatus.entries()) {
    // If marked as online but hasn't been seen in 2 minutes
    if (status.online && (now - status.lastSeen > 2 * 60 * 1000)) {
      status.online = false;
      userStatus.set(userId, status);
      
      // Also remove from activeConnections if present
      if (activeConnections.has(userId)) {
        activeConnections.delete(userId);
        cleanedCount++;
      }
    }
    
    // Remove very old offline entries (more than 24 hours)
    if (!status.online && (now - status.lastSeen > 24 * 60 * 60 * 1000)) {
      userStatus.delete(userId);
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`Cleaned up ${cleanedCount} stale connections`);
  }
}, 60000); // Run every minute

// Make io accessible in routes
app.set('io', io);
app.set('activeConnections', activeConnections);
app.set('userStatus', userStatus); // Add userStatus to app for route usage

// NEW: Helper function to send real-time notifications to users
app.locals.sendRealTimeNotification = (options) => {
  const { userId, house, message, type, title, skipAdmin, reason, criteria, level } = options;
  
  try {
    // Option 1: Send to specific user
    if (userId) {
      // Ensure userId is always a string
      const userIdStr = userId.toString();
      
      // Add detailed logging to track the issue
      console.log(`[NOTIFICATION] Attempting to send to user: ${userIdStr}`);
      console.log(`[NOTIFICATION] User online status: ${activeConnections.has(userIdStr) ? 'ONLINE' : 'OFFLINE'}`);
      
      if (activeConnections.has(userIdStr)) {
        // Check if user is an admin and we should skip admins
        if (skipAdmin === "true" || skipAdmin === true) {
          const user = userStatus.get(userIdStr);
          if (user && ADMIN_USERS.includes(user.username)) {
            console.log(`[NOTIFICATION] Skipping admin user: ${userIdStr}`);
            return false; // Skip sending to admin
          }
        }
        
        const socketId = activeConnections.get(userIdStr);
        console.log(`[NOTIFICATION] Sending to socket: ${socketId}`);
        
        io.to(socketId).emit('admin_notification', {
          message,
          notificationType: type || 'info',
          title,
          timestamp: new Date().toISOString(),
          skipAdmin,
          reason,
          criteria,
          level
        });
        return true;
      } else {
        console.log(`[NOTIFICATION] User ${userIdStr} appears to be offline.`);
      }
    }
    
    // Option 2: Send to an entire house
    if (house) {
      // If skipAdmin is true, we need to filter out admin sockets from the house room
      if (skipAdmin === "true" || skipAdmin === true) {
        // Get all sockets in the house room
        const socketsInHouse = [];
        for (const [userId, socketId] of activeConnections.entries()) {
          const user = userStatus.get(userId);
          if (user && user.house === house && !ADMIN_USERS.includes(user.username)) {
            socketsInHouse.push(socketId);
          }
        }
        
        // Send individually to non-admin sockets
        for (const socketId of socketsInHouse) {
          io.to(socketId).emit('admin_notification', {
            message,
            notificationType: type || 'info',
            title,
            timestamp: new Date().toISOString(),
            skipAdmin,
            reason,
            criteria,
            level
          });
        }
      } else {
        // Send to all in the house if not skipping admins
        io.to(house).emit('admin_notification', {
          message,
          notificationType: type || 'info',
          title,
          timestamp: new Date().toISOString(),
          skipAdmin,
          reason,
          criteria,
          level
        });
      }
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('Error sending real-time notification:', error);
    return false;
  }
};

// NEW: Helper function to broadcast house point changes
app.locals.broadcastHousePointsUpdate = (house, pointChange, newTotal, reason, skipAdmin, criteria, level) => {
  try {
    if (!house) return false;
    
    // Create a unique key for this update
    const updateKey = `${house}:${pointChange}:${reason || 'AdminAction'}`;
    
    // Debug logging
    console.log(`[HOUSE_POINTS] Broadcasting update to ${house}: ${pointChange} points`);
    console.log(`[HOUSE_POINTS] Detailed parameters:`, {
      house,
      pointChange,
      newTotal,
      reason: reason || 'No reason provided',
      skipAdmin: skipAdmin === true || skipAdmin === "true",
      criteria: criteria || 'No criteria',
      level: level || 'No level'
    });
    console.log(`[HOUSE_POINTS] Active connections: ${activeConnections.size}`);

    // Log all users in this house
    const usersInHouse = [];
    for (const [userId, status] of userStatus.entries()) {
      if (status.house === house) {
        usersInHouse.push({
          userId,
          online: status.online,
          username: status.username,
          socketId: activeConnections.get(userId)
        });
      }
    }
    console.log(`[HOUSE_POINTS] Users in ${house}: ${JSON.stringify(usersInHouse)}`);
    
    // Check if we've broadcasted this same update recently (within 10 seconds)
    if (recentHousePointsUpdates.has(updateKey)) {
      const lastUpdate = recentHousePointsUpdates.get(updateKey);
      if (Date.now() - lastUpdate < 10000) { // 10 seconds
        console.log(`Skipping duplicate house points update for ${house} (${pointChange} points)`);
        return true; // Pretend we sent it
      }
    }
    
    // Record this update to prevent duplicates
    recentHousePointsUpdates.set(updateKey, Date.now());
    
    // Clean up old entries in the recentHousePointsUpdates map
    const now = Date.now();
    for (const [key, timestamp] of recentHousePointsUpdates.entries()) {
      if (now - timestamp > 30000) { // 30 seconds
        recentHousePointsUpdates.delete(key);
      }
    }
    
    // Extract criteria and level from arguments or reason if available
    let _criteria = criteria;
    let _level = level;
    
    console.log('[HOUSE_POINTS] Input criteria and level:', { criteria, level });
    
    if (!_criteria || !_level) {
      if (reason) {
        const criteriaMatch = reason.match(/[Cc]riteria:?:?\s*(.+?)(?=\.|$|\s*Level:|\s*Reason:)/);
        if (criteriaMatch) _criteria = criteriaMatch[1].trim();
        const levelMatch = reason.match(/[Ll]evel:?:?\s*(.+?)(?=\.|$|\s*Criteria:|\s*Reason:)/);
        if (levelMatch) _level = levelMatch[1].trim();
      }
    }
    
    console.log('[HOUSE_POINTS] Parsed criteria and level:', { _criteria, _level });
    
    // Create a consistent timestamp for all notifications
    const timestamp = new Date().toISOString();
    
    // Common notification data
    const notificationData = {
      house,
      points: pointChange,
      newTotal,
      reason: reason || 'Admin action',
      criteria: _criteria,
      level: _level,
      timestamp,
      uniqueId: `house_points_${house}_${pointChange}_${Date.now()}`
    };
    
    console.log('[HOUSE_POINTS] Notification data being sent:', notificationData);
    
    // Create a broadcast function to ensure consistent data format
    const emitNotification = (socketId) => {
      io.to(socketId).emit('house_points_update', {
        ...notificationData,
        skipAdmin: skipAdmin === "true" || skipAdmin === true
      });
    };
    
    if (skipAdmin === "true" || skipAdmin === true) {
      // Send individually to non-admin users in the house
      const sentTo = new Set(); // Track who we've sent to
      
      for (const [userId, socketId] of activeConnections.entries()) {
        // Always ensure we're comparing strings
        const userIdStr = userId.toString();
        
        // Get the user status
        const user = userStatus.get(userIdStr);
        
        // Log detailed user info for debugging
        console.log(`[HOUSE_POINTS] Checking user ${userIdStr}: House=${user?.house}, IsAdmin=${ADMIN_USERS.includes(user?.username)}, SocketId=${socketId}, Online=${user?.online}`);
        
        if (user && user.house === house && !ADMIN_USERS.includes(user.username) && !sentTo.has(userIdStr)) {
          sentTo.add(userIdStr); // Mark as sent to prevent duplicates
          
          // Use the emitNotification function with consistent data
          emitNotification(socketId);
          
          console.log(`[HOUSE_POINTS] Sent house points update to ${userIdStr} in ${house}`);
        }
      }
      
      return sentTo.size > 0; // Return true if we sent to at least one user
    } else {
      // Send to all in the house - use a room message
      io.to(house).emit('house_points_update', {
        ...notificationData
      });
      
      return true;
    }
  } catch (error) {
    console.error('Error broadcasting house points update:', error);
    return false;
  }
};

// NEW: Helper function to update user fields in real-time
app.locals.updateUserInRealTime = (userId, updatedFields) => {
  try {
    if (!userId) return false;
    
    // Ensure consistent string format for user ID
    const userIdStr = userId.toString();
    
    console.log(`[UPDATE_USER] Attempting to update user ${userIdStr} with fields:`, updatedFields);
    console.log(`[UPDATE_USER] User online status: ${activeConnections.has(userIdStr) ? 'ONLINE' : 'OFFLINE'}`);
    
    if (activeConnections.has(userIdStr)) {
      const socketId = activeConnections.get(userIdStr);
      console.log(`[UPDATE_USER] Sending to socket: ${socketId}`);
      
      io.to(socketId).emit('sync_update', {
        type: 'user_update',
        timestamp: new Date().toISOString(),
        data: {
          updatedFields
        }
      });
      
      return true;
    } else {
      console.log(`[UPDATE_USER] User ${userIdStr} appears to be offline.`);
      return false;
    }
  } catch (error) {
    console.error('Error updating user in real-time:', error);
    return false;
  }
};

// Helper to format house points message
const formatHousePointsMessage = (house, points, reason, criteria, level) => {
  // Start with base message
  let message = `House ${house} has ${points > 0 ? 'gained' : 'lost'} ${Math.abs(points)} points!`;
  
  // Add details in a consistent format
  const details = [];
  
  if (reason && reason !== 'Admin action' && reason.trim() !== '') {
    details.push(`Reason: ${reason}`);
  }
  
  if (criteria && criteria !== null && criteria.trim() !== '') {
    details.push(`Criteria: ${criteria}`);
  }
  
  if (level && level !== null && level.trim() !== '') {
    details.push(`Level: ${level}`);
  }
  
  // Join all details with periods
  if (details.length > 0) {
    message += `. ${details.join('. ')}`;
  }
  
  return message;
};

// Add version prefix to all routes
const API_PREFIX = '/api';

// Serve static files from uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Routes with prefix
app.use(`${API_PREFIX}/auth`, authRoutes);
app.use(`${API_PREFIX}/exercises`, exerciseRoutes);
app.use(`${API_PREFIX}/user/scores`, scoreRoutes);
app.use(`${API_PREFIX}/user/magic-points`, magicPointsRoutes);
app.use(`${API_PREFIX}/users`, userRoutes);
app.use(`${API_PREFIX}/notifications`, notificationsRoutes);

// Catch-all route for SPA - send index.html for any unknown routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Add health check route
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Update error handling
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    message: err.message || 'Internal server error',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// Update server listening
const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Access URLs:');
  console.log(`- Local: http://localhost:${PORT}`);
  console.log(`- Network: http://192.168.1.53:${PORT}`);
  console.log(`- API: http://192.168.1.53:${PORT}/api`);
});
