'use strict';
/* Twilio REST (2010-04-01) with the agency's own Account SID + Auth Token.
   Form-encoded requests, Basic auth, no SDK. */
const { createHttp } = require('./http');

function createTwilio(cfg, fetchImpl) {
  const http = createHttp('Twilio', fetchImpl);
  const base = cfg.twilio.apiBase + '/2010-04-01';

  function client(accountSid, authToken) {
    const auth =
      'Basic ' + Buffer.from(accountSid + ':' + authToken).toString('base64');
    const call = (method, path, params) => {
      const init = {
        method,
        headers: { Authorization: auth, Accept: 'application/json' },
      };
      let url = base + path;
      if (params && method === 'GET') {
        const q = new URLSearchParams(params).toString();
        if (q) url += '?' + q;
      } else if (params) {
        init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        init.body = new URLSearchParams(params).toString();
      }
      return http(url, init);
    };
    const acct = (sid) => '/Accounts/' + encodeURIComponent(sid || accountSid);

    return {
      accountSid,
      // Validate credentials and return the account (status, type, friendly name).
      getAccount: () => call('GET', acct() + '.json'),

      createSubaccount: (friendlyName) =>
        call('POST', '/Accounts.json', {
          FriendlyName: friendlyName.slice(0, 64),
        }),
      getSubaccount: (sid) => call('GET', acct(sid) + '.json'),
      // Close (permanently) or suspend a subaccount.
      setSubaccountStatus: (sid, status) =>
        call('POST', acct(sid) + '.json', { Status: status }),

      async searchLocalNumber(onAccount, { country, areaCode, contains }) {
        const q = { VoiceEnabled: 'true', PageSize: '5' };
        if (areaCode) q.AreaCode = String(areaCode);
        if (contains) q.Contains = String(contains);
        const r = await call(
          'GET',
          acct(onAccount) +
            '/AvailablePhoneNumbers/' +
            encodeURIComponent(country || 'US') +
            '/Local.json',
          q,
        );
        return (r && r.available_phone_numbers) || [];
      },
      buyNumber: (onAccount, phoneNumber, extra) =>
        call(
          'POST',
          acct(onAccount) + '/IncomingPhoneNumbers.json',
          Object.assign({ PhoneNumber: phoneNumber }, extra || {}),
        ),
      updateNumber: (onAccount, numberSid, params) =>
        call(
          'POST',
          acct(onAccount) +
            '/IncomingPhoneNumbers/' +
            encodeURIComponent(numberSid) +
            '.json',
          params,
        ),
      releaseNumber: (onAccount, numberSid) =>
        call(
          'DELETE',
          acct(onAccount) +
            '/IncomingPhoneNumbers/' +
            encodeURIComponent(numberSid) +
            '.json',
        ),
      listNumbers: async (onAccount) =>
        (
          (await call('GET', acct(onAccount) + '/IncomingPhoneNumbers.json', {
            PageSize: '100',
          })) || {}
        ).incoming_phone_numbers || [],

      // Browser calling (Command Deck takeover): API key + TwiML app on the main account.
      createApiKey: (friendlyName) =>
        call('POST', acct() + '/Keys.json', { FriendlyName: friendlyName }),
      deleteApiKey: (sid) =>
        call('DELETE', acct() + '/Keys/' + encodeURIComponent(sid) + '.json'),
      createTwimlApp: (friendlyName, voiceUrl) =>
        call('POST', acct() + '/Applications.json', {
          FriendlyName: friendlyName,
          VoiceUrl: voiceUrl,
          VoiceMethod: 'POST',
        }),
      updateTwimlApp: (sid, voiceUrl) =>
        call(
          'POST',
          acct() + '/Applications/' + encodeURIComponent(sid) + '.json',
          { VoiceUrl: voiceUrl, VoiceMethod: 'POST' },
        ),
    };
  }

  return { client };
}

// Minimal TwiML builder with XML escaping.
const esc = (s) =>
  String(s == null ? '' : s).replace(
    /[<>&'"]/g,
    (c) =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        "'": '&apos;',
        '"': '&quot;',
      })[c],
  );
const twiml = (inner) =>
  '<?xml version="1.0" encoding="UTF-8"?><Response>' + inner + '</Response>';
const say = (text) => '<Say>' + esc(text) + '</Say>';
function dialClient(identity, opts) {
  opts = opts || {};
  const attrs = [
    'answerOnBridge="true"',
    'timeout="' + (opts.timeout || 25) + '"',
  ];
  if (opts.callerId) attrs.push('callerId="' + esc(opts.callerId) + '"');
  if (opts.action) attrs.push('action="' + esc(opts.action) + '"');
  return (
    '<Dial ' +
    attrs.join(' ') +
    '><Client>' +
    esc(identity) +
    '</Client></Dial>'
  );
}
function dialNumber(number, opts) {
  opts = opts || {};
  const attrs = ['answerOnBridge="true"'];
  if (opts.callerId) attrs.push('callerId="' + esc(opts.callerId) + '"');
  return (
    '<Dial ' + attrs.join(' ') + '><Number>' + esc(number) + '</Number></Dial>'
  );
}

module.exports = { createTwilio, twiml, say, dialClient, dialNumber, esc };
