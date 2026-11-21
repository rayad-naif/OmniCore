'use strict';
/* HighLevel API v2. The marketplace app installs at agency (Company) level;
   location-scoped calls use a location token minted from the agency token
   (POST /oauth/locationToken), so the agency never pastes a GHL API key. */
const crypto = require('crypto');
const { createHttp, ApiError } = require('./http');

function createGhl(cfg, fetchImpl) {
  const g = cfg.ghl;
  const http = createHttp('CRM', fetchImpl);

  // Which Marketplace app (cfg.apps): 'standard' (sub-account) or 'agency'.
  const appOf = (key) =>
    (cfg.apps && cfg.apps[key]) ||
    (cfg.apps && cfg.apps.standard) || {
      clientId: g.clientId,
      clientSecret: g.clientSecret,
      scopes: g.scopes,
      redirectUri: cfg.redirectUri,
    };

  function authorizeUrl(state, appKey) {
    const a = appOf(appKey);
    const u = new URL(g.authUrl);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('redirect_uri', a.redirectUri);
    u.searchParams.set('client_id', a.clientId);
    u.searchParams.set('scope', a.scopes);
    if (state) u.searchParams.set('state', state);
    return u.toString();
  }

  const tokenRequest = (params, appKey) => {
    const a = appOf(appKey);
    return http(g.apiBase + '/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams(
        Object.assign(
          {
            client_id: a.clientId,
            client_secret: a.clientSecret,
            user_type: 'Company',
          },
          params,
        ),
      ).toString(),
    });
  };

  /* Returns the token as-is. userType is "Company" for an agency install and
     "Location" when the app is installed into a single sub-account. */
  async function exchangeCode(code, appKey) {
    const t = await tokenRequest(
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: appOf(appKey).redirectUri,
      },
      appKey,
    );
    if (
      !t ||
      !t.access_token ||
      !t.companyId ||
      !/^(Company|Location)$/.test(t.userType || '')
    ) {
      throw new ApiError(
        'CRM',
        'Unexpected install token (' + ((t && t.userType) || 'unknown') + ').',
        400,
        t,
      );
    }
    return t;
  }
  // userType: 'Company' (company / bulk install) or 'Location' (single account install).
  const refresh = (refreshToken, userType, appKey) =>
    tokenRequest(
      {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        user_type: userType || 'Company',
      },
      appKey,
    );

  // Which of our apps a webhook's appId belongs to (null = neither).
  function appKeyForId(appId) {
    if (!appId) return null;
    const hit = Object.values(cfg.apps || {}).find(
      (a) => a.clientId && (a.appId === appId || a.clientId.startsWith(appId)),
    );
    return hit ? hit.key : null;
  }

  // Location token from an agency token (needs oauth.write).
  const locationToken = (agencyToken, companyId, locationId) =>
    http(g.apiBase + '/oauth/locationToken', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + agencyToken,
        Version: g.apiVersion,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({ companyId, locationId }).toString(),
    });

  function api(token) {
    const call = (method, path, body, query) => {
      let url = g.apiBase + path;
      if (query) {
        const q = new URLSearchParams(
          Object.entries(query).filter(
            ([, v]) => v !== undefined && v !== null && v !== '',
          ),
        ).toString();
        if (q) url += '?' + q;
      }
      return http(url, {
        method,
        headers: Object.assign(
          {
            Authorization: 'Bearer ' + token,
            Version: g.apiVersion,
            Accept: 'application/json',
          },
          body ? { 'Content-Type': 'application/json' } : {},
        ),
        body: body ? JSON.stringify(body) : undefined,
      });
    };
    return {
      raw: call,
      // Agency token
      getCompany: async (companyId) => {
        const j = await call(
          'GET',
          '/companies/' + encodeURIComponent(companyId),
        );
        return (j && j.company) || j;
      },
      searchLocations: async (companyId, skip) =>
        (
          (await call('GET', '/locations/search', null, {
            companyId,
            limit: 100,
            skip: skip || 0,
          })) || {}
        ).locations || [],
      // Sub-accounts where this app is installed (agency token, oauth.readonly).
      installedLocations: async (companyId, appId) => {
        const out = [];
        for (let skip = 0; skip < 5000; skip += 100) {
          const j = await call('GET', '/oauth/installedLocations', null, {
            companyId,
            appId,
            isInstalled: true,
            limit: 100,
            skip,
          });
          const page = (j && j.locations) || [];
          out.push(...page);
          if (page.length < 100) break;
        }
        return out;
      },
      getLocation: async (locationId) => {
        const j = await call(
          'GET',
          '/locations/' + encodeURIComponent(locationId),
        );
        return (j && j.location) || j;
      },
      // Location token
      listCustomFields: async (locationId) =>
        (
          (await call(
            'GET',
            '/locations/' + encodeURIComponent(locationId) + '/customFields',
            null,
            { model: 'contact' },
          )) || {}
        ).customFields || [],
      createCustomField: async (locationId, f) => {
        const j = await call(
          'POST',
          '/locations/' + encodeURIComponent(locationId) + '/customFields',
          f,
        );
        return (j && j.customField) || j;
      },
      listPipelines: async (locationId) =>
        (
          (await call('GET', '/opportunities/pipelines', null, {
            locationId,
          })) || {}
        ).pipelines || [],
      listCalendars: async (locationId) =>
        ((await call('GET', '/calendars/', null, { locationId })) || {})
          .calendars || [],
      freeSlots: (calendarId, startMs, endMs, timezone) =>
        call(
          'GET',
          '/calendars/' + encodeURIComponent(calendarId) + '/free-slots',
          null,
          { startDate: startMs, endDate: endMs, timezone },
        ),
      bookAppointment: (a) => call('POST', '/calendars/events/appointments', a),
      upsertContact: async (c) => {
        const j = await call('POST', '/contacts/upsert', c);
        return (j && j.contact) || j;
      },
      getContact: async (id) => {
        const j = await call('GET', '/contacts/' + encodeURIComponent(id));
        return (j && j.contact) || j;
      },
      updateContact: (id, c) =>
        call('PUT', '/contacts/' + encodeURIComponent(id), c),
      addTags: (id, tags) =>
        call('POST', '/contacts/' + encodeURIComponent(id) + '/tags', { tags }),
      addNote: (id, body) =>
        call('POST', '/contacts/' + encodeURIComponent(id) + '/notes', {
          body,
        }),
      upsertOpportunity: (o) => call('POST', '/opportunities/upsert', o),
      // Text through the sub-account's own HighLevel phone (LC Phone / Twilio).
      sendSms: (contactId, message) =>
        call('POST', '/conversations/messages', {
          type: 'SMS',
          contactId,
          message,
        }),
      setDnd: (id) =>
        call('PUT', '/contacts/' + encodeURIComponent(id), { dnd: true }),
    };
  }

  /* Webhook signatures. true = valid, false = invalid, null = no keys configured. */
  function verifyWebhook(rawBody, headers) {
    const ed = headers['x-ghl-signature'];
    const rsa = headers['x-wh-signature'];
    if (!g.webhookEd25519Key && !g.webhookRsaKey) return null;
    try {
      if (ed && g.webhookEd25519Key)
        return crypto.verify(
          null,
          rawBody,
          g.webhookEd25519Key,
          Buffer.from(ed, 'base64'),
        );
      if (rsa && g.webhookRsaKey)
        return crypto.verify(
          'sha256',
          rawBody,
          g.webhookRsaKey,
          Buffer.from(rsa, 'base64'),
        );
    } catch {
      return false;
    }
    return false;
  }

  return {
    authorizeUrl,
    exchangeCode,
    refresh,
    locationToken,
    api,
    verifyWebhook,
    appKeyForId,
  };
}

module.exports = { createGhl };
