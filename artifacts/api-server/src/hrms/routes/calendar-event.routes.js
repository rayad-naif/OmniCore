const express = require('express');
const router = express.Router();
const { protect, hrAndAbove } = require('../middleware/auth.middleware');
const { asyncHandler, AppError } = require('../utils/errorUtils');
const CalendarEvent = require('../models/CalendarEvent.model');
const {
  createNotificationsForAllUsers,
} = require('../services/notification/notification.service');

// GET all events
router.get(
  '/',
  protect,
  asyncHandler(async (_req, res) => {
    const events = await CalendarEvent.find()
      .sort({ date: 1, createdAt: 1 })
      .populate('createdBy', 'firstName lastName');
    res.json({ success: true, data: events });
  }),
);

// POST create event
router.post(
  '/',
  protect,
  hrAndAbove,
  asyncHandler(async (req, res) => {
    const { title, date, endDate, type = 'other', description = '' } = req.body;
    if (!title || !date || !endDate)
      throw new AppError(
        'Event title, from date, and end date are required.',
        400,
      );
    const parsedDate = new Date(`${String(date).slice(0, 10)}T00:00:00.000Z`);
    const parsedEndDate = new Date(
      `${String(endDate).slice(0, 10)}T00:00:00.000Z`,
    );
    if (
      Number.isNaN(parsedDate.getTime()) ||
      Number.isNaN(parsedEndDate.getTime()) ||
      parsedEndDate < parsedDate
    ) {
      throw new AppError('Please provide a valid event date range.', 400);
    }
    const event = await CalendarEvent.create({
      title,
      date: parsedDate,
      endDate: parsedEndDate,
      type,
      description,
      createdBy: req.user._id,
    });
    await event.populate('createdBy', 'firstName lastName');

    const from = parsedDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const to = parsedEndDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const notifications = await createNotificationsForAllUsers({
      title: `New company event: ${event.title}`,
      message: `${event.type.replace(/_/g, ' ')} scheduled for ${from}${from !== to ? ` to ${to}` : ''}.`,
      type: 'calendar_event',
      link: '/dashboard/calender',
    });
    notifications.forEach((notification) => {
      req.io?.to(`user:${notification.user}`).emit('notification:new', {
        _id: notification._id,
        title: notification.title,
        message: notification.message,
        type: notification.type,
        link: notification.link,
        read: false,
        time: 'Just now',
        createdAt: notification.createdAt,
      });
    });
    res.status(201).json({
      success: true,
      data: event,
      message: 'Calendar event created successfully.',
    });
  }),
);

// PUT update event
router.put(
  '/:id',
  protect,
  hrAndAbove,
  asyncHandler(async (req, res) => {
    const { title, date, endDate, type, description } = req.body;

    const event = await CalendarEvent.findById(req.params.id);
    if (!event) throw new AppError('Event not found.', 404);

    if (title !== undefined) event.title = title;
    if (type !== undefined) event.type = type;
    if (description !== undefined) event.description = description;

    if (date !== undefined) {
      const parsedDate = new Date(`${String(date).slice(0, 10)}T00:00:00.000Z`);
      if (Number.isNaN(parsedDate.getTime()))
        throw new AppError('Invalid from date.', 400);
      event.date = parsedDate;
    }

    if (endDate !== undefined) {
      const parsedEndDate = new Date(
        `${String(endDate).slice(0, 10)}T00:00:00.000Z`,
      );
      if (Number.isNaN(parsedEndDate.getTime()))
        throw new AppError('Invalid end date.', 400);
      event.endDate = parsedEndDate;
    }

    if (event.endDate < event.date)
      throw new AppError('End date cannot be before the start date.', 400);

    await event.save();
    await event.populate('createdBy', 'firstName lastName');

    res.json({
      success: true,
      data: event,
      message: 'Calendar event updated successfully.',
    });
  }),
);

// DELETE event
router.delete(
  '/:id',
  protect,
  hrAndAbove,
  asyncHandler(async (req, res) => {
    const event = await CalendarEvent.findById(req.params.id);
    if (!event) throw new AppError('Event not found.', 404);

    await event.deleteOne();
    res.json({
      success: true,
      message: 'Calendar event deleted successfully.',
    });
  }),
);

module.exports = router;
