const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const { asyncHandler } = require('../utils/errorUtils');
const Notification = require('../models/Notification.model');

const formatTime = (date) =>
  date ? new Date(date).toLocaleString('en-US', { hour12: true }) : 'Just now';

router.get('/', protect, asyncHandler(async (req, res) => {
  const notifications = await Notification.find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .limit(50);

  const data = notifications.map((notification) => ({
    _id: notification._id,
    title: notification.title,
    message: notification.message,
    type: notification.type,
    link: notification.link,
    read: notification.read,
    time: formatTime(notification.createdAt),
    createdAt: notification.createdAt,
  }));

  res.json({ success: true, data, unreadCount: data.filter((item) => !item.read).length });
}));

router.patch('/:id/read', protect, asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    { read: true },
    { new: true }
  );

  if (!notification) {
    return res.status(404).json({ success: false, message: 'Notification not found.' });
  }

  res.json({ success: true, data: notification });
}));

module.exports = router;
