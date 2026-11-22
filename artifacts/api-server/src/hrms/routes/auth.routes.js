const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth.middleware');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate.middleware');
const { loginLimiter } = require('../core/rateLimit');

const loginValidation = [
  body('email').isEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password required'),
];

router.post('/login', loginLimiter, loginValidation, validate, authController.login);
router.post('/register', authController.register);
router.post('/sso', loginLimiter, authController.sso);
router.post('/refresh-token', authController.refreshToken);
router.post('/forgot-password', loginLimiter, authController.forgotPassword);
router.post('/reset-password', loginLimiter, authController.resetPassword);

// Protected routes
router.use(protect);
router.get('/me', authController.getMe);
router.post('/logout', authController.logout);
router.put('/change-password', authController.changePassword);

module.exports = router;
