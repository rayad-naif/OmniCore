const { AppError } = require('../utils/errorUtils');

module.exports = (req, _res, next) => {
  next(new AppError(`Route ${req.originalUrl} not found`, 404));
};
