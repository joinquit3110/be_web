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

// Socket.IO setup with improved connection tracking and performance
const socketIO = require('socket.io');
const server = require('http').createServer(app);
const io = socketIO(server, {
  cors: {
    origin: '*', // Allow all origins in development
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingTimeout: 20000,               // Giảm thời gian timeout từ 30000ms xuống 20000ms
  pingInterval: 5000,               // Giảm khoảng thời gian ping từ 10000ms xuống 5000ms
  transports: ['websocket', 'polling'], // Ưu tiên websocket để giảm độ trễ
  allowEIO3: true,                  // Hỗ trợ Socket.IO phiên bản 3
  maxHttpBufferSize: 1e7,           // 10MB - tăng giới hạn buffer
  connectTimeout: 15000,            // 15 giây timeout kết nối
  perMessageDeflate: {
    threshold: 1024                 // Nén dữ liệu khi kích thước lớn hơn 1KB
  }
});

// Admin users constant for filtering notifications
const ADMIN_USERS = ['hungpro', 'vipro'];

// Store active connections with improved handling
const activeConnections = new Map();
// Track user online status with timestamps
const userStatus = new Map(); // userId -> { online: boolean, lastSeen: Date }

// Track recent house point updates to prevent duplicates
const recentHousePointsUpdates = new Map();

// Cache key-value store cho dữ liệu tạm thời
const runtimeCache = new Map();

// Socket.IO connection handling with optimized performance
io.on('connection', (socket) => {
  console.log('New client connected', socket.id);
  let authenticatedUserId = null;
  
  // Handle user authentication with improved performance
  socket.on('authenticate', (userData) => {
    if (userData && userData.userId) {
      authenticatedUserId = userData.userId.toString();
      // Store user connection for targeted updates
      activeConnections.set(authenticatedUserId, socket.id);
      
      // Update online status
      userStatus.set(authenticatedUserId, { 
        online: true, 
        lastSeen: new Date(),
        house: userData.house || null,
        username: userData.username || null,
        connectionTime: Date.now()
      });
      
      // Join user to their house room if available
      if (userData.house) {
        socket.join(userData.house);
        console.log(`User ${userData.userId} joined house ${userData.house}`);
        
        // Also join a role-based room
        const role = (userData.isAdmin || ADMIN_USERS.includes(userData.username)) ? 'admin' : 'student';
        socket.join(role);
      }
      
      // Join admin broadcast channel for system-wide announcements
      socket.join('system-updates');
      
      // Emit connection status immediately
      socket.emit('connection_status', { 
        connected: true, 
        timestamp: new Date().toISOString(),
        message: 'Successfully connected to real-time updates',
        quality: 'good'
      });
      
      // Send pending notifications if any (consider last login time)
      setTimeout(() => {
        if (userData.lastLogin && socket.connected) {
          // Logic to send pending notifications since last login time
          console.log(`Checking for pending notifications for user ${userData.userId}`);
        }
      }, 500); // Small delay to ensure other setup completes
    }
  });
  
  // Handle ping request for latency measurement
  socket.on('ping_server', (data, callback) => {
    // Phản hồi ngay lập tức với timestamp hiện tại
    if (typeof callback === 'function') {
      callback(Date.now() - (data?.timestamp || Date.now()));
    }
  });
  
  // Handle heartbeat with optimized logic
  socket.on('heartbeat', (data, callback) => {
    if (authenticatedUserId) {
      const status = userStatus.get(authenticatedUserId);
      if (status) {
        const now = new Date();
        status.lastSeen = now;
        status.lastActivity = Date.now();
        userStatus.set(authenticatedUserId, status);
      }
      
      // Gọi callback nếu có để client tính được độ trễ
      if (typeof callback === 'function') {
        callback();
      }
    }
  });
  
  // Handle house change with improved performance
  socket.on('change_house', async ({ userId, oldHouse, newHouse, timestamp }) => {
    // Bỏ qua các event cũ dựa trên timestamp
    const lastHouseChangeTime = runtimeCache.get(`last_house_change_${userId}`) || 0;
    if (timestamp && lastHouseChangeTime > timestamp) {
      return; // Bỏ qua vì đây là event cũ
    }
    
    // Cập nhật thời gian thay đổi house gần nhất
    runtimeCache.set(`last_house_change_${userId}`, timestamp || Date.now());
    
    if (oldHouse) {
      socket.leave(oldHouse);
    }
    
    if (newHouse) {
      socket.join(newHouse);
      
      // Update user status with new house
      if (userId && userStatus.has(userId.toString())) {
        const status = userStatus.get(userId.toString());
        status.house = newHouse;
        userStatus.set(userId.toString(), status);
        
        // Phản hồi nhanh với priority cao
        socket.emit('sync_update', {
          type: 'user_update',
          timestamp: new Date().toISOString(),
          priority: 'high',
          data: {
            updatedFields: {
              house: newHouse
            }
          }
        });
      }
    }
  });
  
  // Handle force sync request from client with priority support
  socket.on('request_sync', (options = {}) => {
    if (authenticatedUserId) {
      // Ghi nhận thời điểm yêu cầu sync gần đây nhất
      const lastSyncRequest = runtimeCache.get(`last_sync_request_${authenticatedUserId}`) || 0;
      const now = Date.now();
      
      // Giới hạn tần suất yêu cầu sync (ngoại trừ với priority cao)
      if (options.priority === 'high' || (now - lastSyncRequest >= 2000)) {
        runtimeCache.set(`last_sync_request_${authenticatedUserId}`, now);
        
        socket.emit('sync_update', {
          type: 'force_sync',
          timestamp: new Date().toISOString(),
          priority: options.priority || 'medium',
          message: options.message || 'Sync requested by client'
        });
      }
    }
  });
  
  // Xử lý disconnect hiệu quả hơn
  socket.on('disconnect', (reason) => {
    if (authenticatedUserId) {
      // Không xóa ngay connection, đợi một khoảng thời gian ngắn để tránh mất kết nối khi refresh
      setTimeout(() => {
        // Kiểm tra xem user có kết nối lại không
        const currentSocketId = activeConnections.get(authenticatedUserId);
        if (currentSocketId === socket.id) { // Chỉ xóa nếu socket id vẫn khớp
          activeConnections.delete(authenticatedUserId);
          
          // Cập nhật trạng thái online
          if (userStatus.has(authenticatedUserId)) {
            const status = userStatus.get(authenticatedUserId);
            status.online = false;
            status.lastSeen = new Date();
            status.disconnectReason = reason;
            userStatus.set(authenticatedUserId, status);
          }
        }
      }, 5000); // Đợi 5 giây
    }
  });
  
  // Handle direct messaging between users
  socket.on('direct_message', ({ targetUserId, message }) => {
    if (!authenticatedUserId) return;
    
    const targetSocketId = activeConnections.get(targetUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('direct_message', {
        from: authenticatedUserId,
        message,
        timestamp: Date.now()
      });
    }
  });
  
  // Các socket handlers khác giữ nguyên
  // ...existing socket handlers...
});

// Add periodic cleanup of stale connections with improved efficiency
setInterval(() => {
  const now = new Date();
  let cleanedCount = 0;
  
  // Thực hiện xử lý theo batch để giảm tải CPU
  const batchSize = 100;
  const userIds = [...userStatus.keys()];
  
  for (let i = 0; i < Math.min(batchSize, userIds.length); i++) {
    const userId = userIds[i];
    const status = userStatus.get(userId);
    
    // Nếu được đánh dấu là online nhưng không có hoạt động trong 2 phút
    if (status && status.online && (now - status.lastSeen > 2 * 60 * 1000)) {
      status.online = false;
      userStatus.set(userId, status);
      
      // Cũng xóa khỏi activeConnections nếu có
      if (activeConnections.has(userId)) {
        activeConnections.delete(userId);
        cleanedCount++;
      }
    }
  }
  
  // Xóa các mục trong cache cũ hơn 15 phút
  const cacheExpiry = 15 * 60 * 1000; // 15 phút
  for (const [key, timestamp] of runtimeCache.entries()) {
    if (typeof timestamp === 'number' && (Date.now() - timestamp > cacheExpiry)) {
      runtimeCache.delete(key);
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`Cleaned up ${cleanedCount} stale connections`);
  }
}, 30000); // Chạy mỗi 30 giây thay vì 60 giây

// Make io accessible in routes
app.set('io', io);
app.set('activeConnections', activeConnections);
app.set('userStatus', userStatus);
app.set('runtimeCache', runtimeCache); // Làm cho cache có thể truy cập từ các routes

// Cải thiện hàm helper sendRealTimeNotification cho hiệu suất tốt hơn
app.locals.sendRealTimeNotification = (options) => {
  const { userId, house, message, type, title, skipAdmin, priority = 'medium' } = options;
  
  try {
    // Gửi đến một user cụ thể
    if (userId && activeConnections.has(userId)) {
      // Kiểm tra xem user có phải admin không
      if (skipAdmin === "true" || skipAdmin === true) {
        const user = userStatus.get(userId);
        if (user && ADMIN_USERS.includes(user.username)) {
          return false;
        }
      }
      
      // Gửi với payload nhỏ gọn hơn
      const socketId = activeConnections.get(userId);
      io.to(socketId).emit('admin_notification', {
        message,
        notificationType: type || 'info',
        title,
        timestamp: Date.now(),
        skipAdmin,
        priority
      });
      return true;
    }
    
    // Gửi đến một house
    if (house) {
      // Nếu skipAdmin, lọc các admin
      if (skipAdmin === "true" || skipAdmin === true) {
        // Gửi đến những user không phải admin trong house
        const socketsInHouse = [];
        const now = Date.now();
        
        // Mỗi lần gửi thông báo, chỉ lọc một lần
        const nonAdminSockets = new Set();
        
        for (const [userId, socketId] of activeConnections.entries()) {
          const user = userStatus.get(userId);
          if (user && user.house === house && !ADMIN_USERS.includes(user.username)) {
            nonAdminSockets.add(socketId);
          }
        }
        
        // Dùng broadcast để gửi nhanh hơn
        const notification = {
          message,
          notificationType: type || 'info',
          title,
          timestamp: now,
          skipAdmin,
          priority
        };
        
        // Nếu có quá nhiều socket, gửi theo room sẽ hiệu quả hơn
        if (nonAdminSockets.size > 20) {
          // Tạo room tạm thời
          const tempRoomId = `temp_notification_${now}`;
          
          // Thêm các socket vào room tạm
          const socketsToAdd = [...nonAdminSockets];
          for (const socketId of socketsToAdd) {
            const socketInstance = io.sockets.sockets.get(socketId);
            if (socketInstance) {
              socketInstance.join(tempRoomId);
            }
          }
          
          // Broadcast đến room tạm
          io.to(tempRoomId).emit('admin_notification', notification);
          
          // Dọn dẹp room sau một khoảng thời gian ngắn
          setTimeout(() => {
            for (const socketId of socketsToAdd) {
              const socketInstance = io.sockets.sockets.get(socketId);
              if (socketInstance) {
                socketInstance.leave(tempRoomId);
              }
            }
          }, 5000);
        } else {
          // Gửi riêng lẻ nếu số lượng nhỏ
          for (const socketId of nonAdminSockets) {
            io.to(socketId).emit('admin_notification', notification);
          }
        }
      } else {
        // Gửi cho tất cả trong house
        io.to(house).emit('admin_notification', {
          message,
          notificationType: type || 'info',
          title,
          timestamp: Date.now(),
          skipAdmin,
          priority
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

// Cải thiện hàm helper broadcastHousePointsUpdate để giảm độ trễ
app.locals.broadcastHousePointsUpdate = (house, pointChange, newTotal, reason, skipAdmin) => {
  try {
    if (!house) return false;
    
    // Tạo key duy nhất cho update này
    const updateKey = `${house}:${pointChange}:${reason?.substring(0, 20) || 'AdminAction'}`;
    
    // Kiểm tra có bị trùng lặp không (trong vòng 5 giây)
    if (recentHousePointsUpdates.has(updateKey)) {
      const lastUpdate = recentHousePointsUpdates.get(updateKey);
      if (Date.now() - lastUpdate < 5000) { // Giảm xuống 5 giây thay vì 10 giây
        return true;
      }
    }
    
    // Ghi nhận update này
    recentHousePointsUpdates.set(updateKey, Date.now());
    
    // Xử lý dọn dẹp tách biệt để không làm chậm luồng chính
    setTimeout(() => {
      // Dọn dẹp các entry cũ
      const now = Date.now();
      for (const [key, timestamp] of recentHousePointsUpdates.entries()) {
        if (now - timestamp > 30000) {
          recentHousePointsUpdates.delete(key);
        }
      }
    }, 0);
    
    // Trích xuất criteria và level từ reason
    let criteria = null;
    let level = null;
    
    if (reason) {
      // Dùng regex đã được tối ưu hóa
      const criteriaMatch = reason.match(/[Cc]riteria:?\s*([^.]*?)(?=\.|$|\s*Level:|\s*Reason:)/);
      if (criteriaMatch) {
        criteria = criteriaMatch[1].trim();
      }
      
      const levelMatch = reason.match(/[Ll]evel:?\s*([^.]*?)(?=\.|$|\s*Criteria:|\s*Reason:)/);
      if (levelMatch) {
        level = levelMatch[1].trim();
      }
    }
    
    // Tạo timestamp thống nhất
    const timestamp = Date.now();
    
    // Dữ liệu thông báo
    const notificationData = {
      house,
      points: pointChange,
      newTotal,
      reason: reason || 'Admin action',
      criteria, 
      level,
      timestamp,
      uniqueId: `house_points_${house}_${pointChange}_${timestamp}`
    };
    
    // Tạo hàm emit để đảm bảo format dữ liệu thống nhất
    const emitNotification = (socketId) => {
      io.to(socketId).emit('house_points_update', {
        ...notificationData,
        skipAdmin: skipAdmin === "true" || skipAdmin === true,
        priority: 'high' // Luôn đặt ưu tiên cao cho thay đổi điểm
      });
    };
    
    if (skipAdmin === "true" || skipAdmin === true) {
      // Sử dụng phương pháp tương tự như sendRealTimeNotification để tối ưu hiệu suất
      const nonAdminSockets = new Set();
      
      for (const [userId, socketId] of activeConnections.entries()) {
        const user = userStatus.get(userId);
        if (user && user.house === house && !ADMIN_USERS.includes(user.username)) {
          nonAdminSockets.add(socketId);
        }
      }
      
      if (nonAdminSockets.size > 20) {
        // Tạo room tạm thời cho broadcast
        const tempRoomId = `temp_points_${timestamp}`;
        
        // Thêm các socket vào room tạm
        const socketsToAdd = [...nonAdminSockets];
        for (const socketId of socketsToAdd) {
          const socketInstance = io.sockets.sockets.get(socketId);
          if (socketInstance) {
            socketInstance.join(tempRoomId);
          }
        }
        
        // Broadcast đến room tạm
        io.to(tempRoomId).emit('house_points_update', {
          ...notificationData,
          skipAdmin: true,
          priority: 'high'
        });
        
        // Dọn dẹp room sau đó
        setTimeout(() => {
          for (const socketId of socketsToAdd) {
            const socketInstance = io.sockets.sockets.get(socketId);
            if (socketInstance) {
              socketInstance.leave(tempRoomId);
            }
          }
        }, 5000);
      } else {
        // Gửi riêng lẻ nếu số lượng nhỏ
        for (const socketId of nonAdminSockets) {
          io.to(socketId).emit('house_points_update', {
            ...notificationData,
            skipAdmin: true,
            priority: 'high'
          });
        }
      }
      
      return nonAdminSockets.size > 0;
    } else {
      // Sử dụng room thông thường nếu không skip admin
      io.to(house).emit('house_points_update', {
        ...notificationData,
        priority: 'high'
      });
      
      return true;
    }
  } catch (error) {
    console.error('Error broadcasting house points update:', error);
    return false;
  }
};

// Cải thiện hàm helper updateUserInRealTime cho hiệu năng cao hơn
app.locals.updateUserInRealTime = (userId, updatedFields) => {
  try {
    if (!userId || !activeConnections.has(userId)) return false;
    
    const socketId = activeConnections.get(userId);
    
    // Loại bỏ các trường null hoặc undefined để giảm kích thước payload
    const cleanFields = {};
    for (const [key, value] of Object.entries(updatedFields)) {
      if (value !== null && value !== undefined) {
        cleanFields[key] = value;
      }
    }
    
    // Thêm high priority cho các cập nhật quan trọng
    const isPriorityUpdate = cleanFields.hasOwnProperty('house') || 
                             cleanFields.hasOwnProperty('magicPoints') ||
                             cleanFields.hasOwnProperty('needsSync');
    
    io.to(socketId).emit('sync_update', {
      type: 'user_update',
      timestamp: Date.now(),
      priority: isPriorityUpdate ? 'high' : 'medium',
      data: {
        updatedFields: cleanFields
      }
    });
    
    return true;
  } catch (error) {
    console.error('Error updating user in real-time:', error);
    return false;
  }
};

// Thêm các helper functions mới cho hiệu suất tốt hơn

// Hàm broadcast tới tất cả clients với hiệu suất tối ưu
app.locals.broadcastToAll = (eventName, data) => {
  try {
    // Sử dụng volatile để bỏ qua tin nhắn nếu client không kết nối
    // Hữu ích cho các cập nhật không quan trọng
    if (data.priority === 'low') {
      io.volatile.emit(eventName, {
        ...data,
        timestamp: data.timestamp || Date.now()
      });
    } else {
      io.emit(eventName, {
        ...data,
        timestamp: data.timestamp || Date.now()
      });
    }
    return true;
  } catch (error) {
    console.error(`Error broadcasting to all clients: ${error.message}`);
    return false;
  }
};

// Hàm broadcast tới tất cả admins
app.locals.notifyAdmins = (message, data = {}) => {
  try {
    // Broadcast tới room admin
    io.to('admin').emit('admin_update', {
      message,
      timestamp: Date.now(),
      ...data
    });
    return true;
  } catch (error) {
    console.error(`Error notifying admins: ${error.message}`);
    return false;
  }
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

// Thêm một route ping mới để đo độ trễ
app.get('/api/ping', (req, res) => {
  res.json({ timestamp: Date.now() });
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
