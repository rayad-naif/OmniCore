'use strict';
/* White-label guard. Agencies resell this under their own brand, often on top
   of a rebranded HighLevel, so their clients (sub-account users, client
   logins, custom portal domains) must never see the names of the platforms
   underneath: HighLevel, Vapi, Twilio or OpenAI, or the word "agency". */

const SWAPS = [
  [/\b(Go ?High ?Level|High ?Level|LeadConnector|GHL)\b/gi, 'the CRM'],
  [/\bVapi\b/gi, 'the voice service'],
  [/\bTwilio\b/gi, 'the phone carrier'],
  [/\bOpenAI\b/gi, 'the AI service'],
  [/\bagencies\b/g, 'companies'],
  [/\bAgencies\b/g, 'Companies'],
  [/\bagency\b/g, 'company'],
  [/\bAgency\b/g, 'Company'],
  [/\bsub-?accounts\b/gi, 'accounts'],
  [/\bsub-?account\b/gi, 'account'],
];

function neutral(text) {
  let s = String(text == null ? '' : text);
  // "Vapi: message" style provider prefixes from the API clients.
  s = s.replace(/^(CRM|HighLevel|Vapi|Twilio|OpenAI): /, '');
  SWAPS.forEach(([re, to]) => {
    s = s.replace(re, to);
  });
  return s.replace(/\b(the) the\b/gi, '$1');
}

// True when the viewer is a client of an agency, not the agency itself.
function isClientView(req) {
  return !!(
    req.brandCompanyId ||
    (req.session && req.session.kind === 'client')
  );
}

module.exports = { neutral, isClientView };
