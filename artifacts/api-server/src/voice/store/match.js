'use strict';
/* In-memory implementation of the small Mongo filter subset the app uses. */
function getPath(doc, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), doc);
}
function setPath(doc, path, value) {
  const keys = path.split('.');
  let o = doc;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {};
    o = o[keys[i]];
  }
  if (value === undefined) delete o[keys[keys.length - 1]];
  else o[keys[keys.length - 1]] = value;
}
function cmp(a, b) {
  if (a instanceof Date) a = a.getTime();
  if (b instanceof Date) b = b.getTime();
  return a < b ? -1 : a > b ? 1 : 0;
}
function matchValue(v, cond) {
  if (
    cond &&
    typeof cond === 'object' &&
    !Array.isArray(cond) &&
    !(cond instanceof Date)
  ) {
    return Object.keys(cond).every((op) => {
      const c = cond[op];
      switch (op) {
        case '$in':
          return c.some((x) => x === v);
        case '$nin':
          return !c.some((x) => x === v);
        case '$ne':
          return v !== c;
        case '$gt':
          return v != null && cmp(v, c) > 0;
        case '$gte':
          return v != null && cmp(v, c) >= 0;
        case '$lt':
          return v != null && cmp(v, c) < 0;
        case '$lte':
          return v != null && cmp(v, c) <= 0;
        case '$exists':
          return c ? v !== undefined : v === undefined;
        default:
          throw new Error('Unsupported operator ' + op);
      }
    });
  }
  return v === cond;
}
function matches(doc, filter) {
  return Object.keys(filter || {}).every((k) =>
    matchValue(getPath(doc, k), filter[k]),
  );
}
function sortDocs(docs, sort) {
  if (!sort) return docs;
  const keys = Object.keys(sort);
  return docs.sort((a, b) => {
    for (const k of keys) {
      const r = cmp(getPath(a, k) ?? '', getPath(b, k) ?? '') * sort[k];
      if (r) return r;
    }
    return 0;
  });
}
module.exports = { getPath, setPath, matches, sortDocs };
