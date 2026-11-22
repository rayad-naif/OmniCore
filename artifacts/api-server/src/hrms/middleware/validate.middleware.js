const { validationResult } = require('express-validator');
const { AppError } = require('../utils/errorUtils');

exports.validate = (req, _res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const messages = errors.array().map((e) => e.msg).join(', ');
    return next(new AppError(messages, 400));
  }
  next();
};
