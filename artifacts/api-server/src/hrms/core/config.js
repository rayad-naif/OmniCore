'use strict';

/** Public URL of the HR app (the /hrms/ single-page app). */
function hrmsAppUrl() {
  const base = String(process.env.PUBLIC_APP_URL || '').replace(/\/+$/, '');
  return `${base}/hrms`;
}

module.exports = { hrmsAppUrl };
