'use strict';
/* Vapi REST with the agency's own private key, plus the per-call Live Call
   Control endpoint (call.monitor.controlUrl). */
const { createHttp } = require('./http');

function createVapi(cfg, fetchImpl) {
  const http = createHttp('Vapi', fetchImpl);
  const base = cfg.vapi.apiBase;

  function client(apiKey) {
    const call = (method, path, body) =>
      http(base + path, {
        method,
        headers: Object.assign(
          { Authorization: 'Bearer ' + apiKey, Accept: 'application/json' },
          body ? { 'Content-Type': 'application/json' } : {},
        ),
        body: body ? JSON.stringify(body) : undefined,
      });
    return {
      // Cheap call to validate the key.
      listAssistants: (limit) =>
        call('GET', '/assistant?limit=' + (limit || 1)),
      createAssistant: (a) => call('POST', '/assistant', a),
      updateAssistant: (id, a) =>
        call('PATCH', '/assistant/' + encodeURIComponent(id), a),
      deleteAssistant: (id) =>
        call('DELETE', '/assistant/' + encodeURIComponent(id)),
      createSquad: (s) => call('POST', '/squad', s),
      updateSquad: (id, s) =>
        call('PATCH', '/squad/' + encodeURIComponent(id), s),
      deleteSquad: (id) => call('DELETE', '/squad/' + encodeURIComponent(id)),
      importTwilioNumber: (p) =>
        call('POST', '/phone-number', Object.assign({ provider: 'twilio' }, p)),
      updatePhoneNumber: (id, p) =>
        call('PATCH', '/phone-number/' + encodeURIComponent(id), p),
      deletePhoneNumber: (id) =>
        call('DELETE', '/phone-number/' + encodeURIComponent(id)),
      // BYOK: Vapi bills the LLM to the agency's own OpenAI key.
      createCredential: (c) => call('POST', '/credential', c),
      listCredentials: () => call('GET', '/credential'),
      getCall: (id) => call('GET', '/call/' + encodeURIComponent(id)),
      listCalls: (q) =>
        call('GET', '/call?' + new URLSearchParams(q || {}).toString()),
      // Outbound call (e.g. "call this lead back") through the client's number + squad.
      createCall: (p) => call('POST', '/call', p),
    };
  }

  /* Live Call Control. The controlUrl is unique per call and is itself the
     credential, so it is only ever used server-side. */
  async function control(controlUrl, payload) {
    if (!/^https:\/\//.test(controlUrl || ''))
      throw new Error('This call has no live control URL');
    return http(controlUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeoutMs: 8000,
    });
  }
  const controls = {
    whisper: (url, text) =>
      control(url, {
        type: 'add-message',
        message: {
          role: 'system',
          content:
            'Live instruction from a human supervisor (do not mention the supervisor; work it into your next reply naturally): ' +
            text,
        },
        triggerResponseEnabled: false,
      }),
    say: (url, text) =>
      control(url, { type: 'say', content: text, endCallAfterSpoken: false }),
    mute: (url) => control(url, { type: 'control', control: 'mute-assistant' }),
    unmute: (url) =>
      control(url, { type: 'control', control: 'unmute-assistant' }),
    end: (url) => control(url, { type: 'end-call' }),
    transfer: (url, number, message) =>
      control(url, {
        type: 'transfer',
        destination: { type: 'number', number },
        content:
          message ||
          'One moment, I am connecting you with a member of our team.',
      }),
  };

  return { client, control, controls };
}

module.exports = { createVapi };
