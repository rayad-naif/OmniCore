'use strict';

// HRMS logs go through OmniCore's pino logger (winston API shape kept:
// logger.info('message', { meta })).
const base = require('../../utils/logger').child({ module: 'hrms' });

const wrap = (level) => (msg, meta) => {
  if (typeof msg === 'string') {
    if (meta && typeof meta === 'object') base[level](meta, msg);
    else base[level](msg);
  } else {
    base[level](msg, typeof meta === 'string' ? meta : undefined);
  }
};

module.exports = {
  info: wrap('info'),
  warn: wrap('warn'),
  error: wrap('error'),
  debug: wrap('debug'),
  http: wrap('debug'),
  verbose: wrap('debug'),
};
