const Notification = require('../../models/Notification.model');
const User = require('../../models/User.model');

const createNotificationsForRoles = async ({
  roles,
  title,
  message,
  type,
  link,
}) => {
  const recipients = await User.find({ role: { $in: roles } }).select('_id');
  if (!recipients.length) return [];

  const notifications = recipients.map((recipient) => ({
    user: recipient._id,
    title,
    message,
    type,
    link,
  }));

  return Notification.insertMany(notifications);
};

const createNotificationsForAllUsers = async ({
  title,
  message,
  type,
  link,
}) => {
  const recipients = await User.find({
    isActive: true,
    deletedAt: null,
  }).select('_id');
  if (!recipients.length) return [];

  return Notification.insertMany(
    recipients.map((recipient) => ({
      user: recipient._id,
      title,
      message,
      type,
      link,
    })),
  );
};

const markNotificationRead = async (notificationId, userId) =>
  Notification.findOneAndUpdate(
    { _id: notificationId, user: userId },
    { read: true },
    { new: true },
  );

module.exports = {
  createNotificationsForRoles,
  createNotificationsForAllUsers,
  markNotificationRead,
};
