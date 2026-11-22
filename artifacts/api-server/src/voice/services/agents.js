'use strict';
/* The three pre-configured agents (Receptionist, Sales Closer, Support) and
   the Vapi Squad that routes between them. Everything is generated from a
   deployment's `agent` settings so redeploying updates every assistant. */

const VOICES = [
  'Elliot',
  'Kylie',
  'Rohan',
  'Lily',
  'Savannah',
  'Hana',
  'Neha',
  'Cole',
  'Harry',
  'Paige',
  'Spencer',
];
const ROLES = ['receptionist', 'sales', 'support']; // inbound squad members
const ALL_ROLES = ROLES.concat('outbound'); // + speed-to-lead caller
const ROLE_LABEL = {
  receptionist: 'Receptionist',
  sales: 'Sales',
  support: 'Support',
  outbound: 'Outbound',
};

/* Languages. Vapi's built-in voices are English; Spanish and multilingual use
   Azure neural voices (included in Vapi, no extra key). */
const LANGUAGES = {
  en: {
    label: 'English',
    transcriber: { provider: 'deepgram', model: 'nova-2', language: 'en' },
  },
  es: {
    label: 'Spanish',
    transcriber: { provider: 'deepgram', model: 'nova-2', language: 'es' },
    voice: { provider: 'azure', voiceId: 'es-US-PalomaNeural' },
    prompt: 'Always speak Spanish.',
  },
  multi: {
    label: 'English + Spanish (auto)',
    transcriber: { provider: 'deepgram', model: 'nova-3', language: 'multi' },
    voice: { provider: 'azure', voiceId: 'en-US-AvaMultilingualNeural' },
    prompt:
      'Reply in the language the caller speaks (English or Spanish), and switch if they switch.',
  },
};

const DEFAULT_AGENT = {
  businessName: '',
  industry: 'home services',
  services: '',
  serviceArea: '',
  hours: 'Monday to Friday, 8am to 6pm',
  timezone: 'America/New_York',
  faq: '',
  pricing: '',
  tone: 'warm, concise and professional',
  voiceId: 'Elliot',
  language: 'en',
  transferNumber: '',
  calendarId: '',
  appointmentMinutes: 60,
  greeting: '',
  extra: { receptionist: '', sales: '', support: '', outbound: '' },
  recordCalls: true,
  avgJobValue: 0,
};

function normalizeAgent(input, base) {
  const a = Object.assign({}, DEFAULT_AGENT, base || {});
  const str = (v, max) => String(v == null ? '' : v).slice(0, max);
  [
    'businessName',
    'industry',
    'serviceArea',
    'hours',
    'timezone',
    'tone',
    'greeting',
    'calendarId',
  ].forEach((k) => {
    if (input[k] !== undefined) a[k] = str(input[k], 300).trim();
  });
  ['services', 'faq', 'pricing'].forEach((k) => {
    if (input[k] !== undefined) a[k] = str(input[k], 8000);
  });
  if (input.voiceId !== undefined)
    a.voiceId = VOICES.includes(input.voiceId)
      ? input.voiceId
      : DEFAULT_AGENT.voiceId;
  if (input.transferNumber !== undefined) {
    const n = String(input.transferNumber).replace(/[^\d+]/g, '');
    a.transferNumber = /^\+\d{8,15}$/.test(n) ? n : '';
  }
  if (input.appointmentMinutes !== undefined)
    a.appointmentMinutes = Math.min(
      480,
      Math.max(15, Number(input.appointmentMinutes) || 60),
    );
  if (input.recordCalls !== undefined) a.recordCalls = !!input.recordCalls;
  if (input.language !== undefined)
    a.language = LANGUAGES[input.language] ? input.language : 'en';
  if (input.avgJobValue !== undefined)
    a.avgJobValue = Math.max(
      0,
      Math.min(1e6, Math.round(Number(input.avgJobValue) || 0)),
    );
  if (input.extra && typeof input.extra === 'object') {
    a.extra = Object.assign({}, DEFAULT_AGENT.extra, a.extra || {});
    ALL_ROLES.forEach((r) => {
      if (input.extra[r] !== undefined) a.extra[r] = str(input.extra[r], 6000);
    });
  }
  return a;
}

function sharedContext(a) {
  return [
    'You work on the phone for ' +
      (a.businessName || 'the business') +
      ', a ' +
      (a.industry || 'local') +
      ' company.',
    a.services ? 'Services offered:\n' + a.services : '',
    a.serviceArea ? 'Service area: ' + a.serviceArea + '.' : '',
    a.hours ? 'Business hours: ' + a.hours + ' (' + a.timezone + ').' : '',
    a.pricing
      ? 'Pricing guidance (only share what is written here):\n' + a.pricing
      : '',
    'Voice style: ' +
      a.tone +
      '. This is a phone call: keep every reply to one or two short sentences, ask one question at a time, never read out lists, URLs or markdown.',
    'Never invent prices, availability, policies or promises. If you do not know, say a team member will follow up.',
    'If the caller asks for a human, is upset, or it is an emergency' +
      (a.transferNumber
        ? ', use the transferCall tool.'
        : ', take a message and promise a fast callback.'),
    (LANGUAGES[a.language] || {}).prompt || '',
    'Today is {{"now" | date: "%A, %B %d, %Y %I:%M %p", "' +
      a.timezone +
      '"}}.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

const ROLE_PROMPT = {
  receptionist: (_a) =>
    [
      '# Role: Receptionist and switchboard',
      'You answer every inbound call. Greet the caller, get their name, and find out why they are calling.',
      'Route quickly:',
      '- New work, a quote, an estimate, pricing or booking -> hand off to Sales.',
      '- An existing job, scheduling changes, billing, invoices, complaints or warranty -> hand off to Support.',
      '- Anything quick you can answer from the information above, answer it yourself.',
      'Before a handoff, tell the caller in a few words who will help them. Do not ask the same question the next agent will ask.',
    ].join('\n'),
  sales: (a) =>
    [
      '# Role: Sales closer',
      'The caller wants new work. Qualify briefly: what they need, where (address or area), how urgent, and their best callback number and email.',
      'Your goal is a booked appointment. Use check_availability to find real open times, offer two options, then book with book_appointment.',
      'Confirm the date and time back to the caller after booking. If nothing fits, offer to have someone call them back.',
      a.calendarId
        ? ''
        : 'Note: no booking calendar is connected, so do not promise a time. Collect their preferred times and say the office will confirm.',
    ]
      .filter(Boolean)
      .join('\n'),
  support: (a) =>
    [
      '# Role: Customer support and billing',
      'The caller is an existing customer. Use lookup_customer to find their record by phone number.',
      'Answer from the FAQ below. For anything you cannot resolve (refunds, disputes, specific invoices, damage), use create_support_ticket so the team follows up, and tell the caller when to expect a callback.',
      a.faq
        ? 'FAQ:\n' + a.faq
        : 'There is no FAQ yet: take detailed notes and create a support ticket.',
    ].join('\n'),
  outbound: (a) =>
    [
      '# Role: Speed-to-lead outbound caller',
      'You are calling {{name}} back within minutes of them reaching out to ' +
        (a.businessName || 'the business') +
        (a.industry ? '' : '') +
        '. They asked about: {{interest}}.',
      'Open by confirming you are speaking with {{name}} and that now is a good time. If not, ask when to call back and end politely.',
      'If you reach voicemail, leave a short message with the business name and that you are returning their request, then end the call.',
      'Qualify briefly (what they need, where, how urgent), then use check_availability and book_appointment to book a visit or consultation.',
      'If they ask to stop being called, apologize, confirm they will not be called again, and end the call.',
      a.calendarId
        ? ''
        : 'No booking calendar is connected: collect preferred times and say the office will confirm.',
    ]
      .filter(Boolean)
      .join('\n'),
};

function systemPrompt(role, a) {
  return [
    ROLE_PROMPT[role](a),
    sharedContext(a),
    a.extra && a.extra[role]
      ? 'Additional instructions:\n' + a.extra[role]
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function firstMessage(role, a) {
  if (role === 'receptionist')
    return (
      a.greeting ||
      'Thanks for calling ' +
        (a.businessName || 'us') +
        ', this is the virtual assistant. Who do I have the pleasure of speaking with?'
    );
  if (role === 'outbound')
    return (
      'Hi, is this {{name}}? This is the virtual assistant from ' +
      (a.businessName || 'our office') +
      ', returning your request from a few minutes ago.'
    );
  return ''; // handoff members continue the conversation
}

// Vapi assistant names are limited to 40 characters and must be unique within a squad.
function memberName(role, a) {
  const label = ROLE_LABEL[role];
  const biz = (a.businessName || 'Client')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40 - label.length - 3);
  return biz + ' - ' + label;
}

function functionTool(name, description, properties, required, server) {
  return {
    type: 'function',
    async: false,
    function: {
      name,
      description,
      parameters: { type: 'object', properties, required: required || [] },
    },
    server,
  };
}

function toolsFor(role, a, server) {
  const tools = [];
  if (role === 'sales' || role === 'outbound') {
    tools.push(
      functionTool(
        'check_availability',
        'Find open appointment times. Call before offering any time to the caller.',
        {
          from_date: {
            type: 'string',
            description: 'First day to search, YYYY-MM-DD. Defaults to today.',
          },
          days: {
            type: 'number',
            description: 'How many days to search (1-14). Defaults to 5.',
          },
        },
        [],
        server,
      ),
    );
    tools.push(
      functionTool(
        'book_appointment',
        'Book an appointment in an open slot returned by check_availability.',
        {
          start_time: {
            type: 'string',
            description:
              'Exact slot start time, ISO 8601 with offset, copied from check_availability.',
          },
          name: { type: 'string', description: 'Caller full name' },
          email: { type: 'string', description: 'Caller email if given' },
          address: { type: 'string', description: 'Service address if given' },
          notes: {
            type: 'string',
            description: 'Short description of the job',
          },
        },
        ['start_time', 'name'],
        server,
      ),
    );
  }
  if (role === 'support') {
    tools.push(
      functionTool(
        'lookup_customer',
        'Look up the caller in the CRM by phone number.',
        {
          phone: {
            type: 'string',
            description:
              'Phone number in E.164. Leave empty to use the caller ID.',
          },
        },
        [],
        server,
      ),
    );
    tools.push(
      functionTool(
        'create_support_ticket',
        'Log an issue so the team follows up.',
        {
          issue: {
            type: 'string',
            description:
              'What the caller needs, with any job or invoice details',
          },
          urgency: {
            type: 'string',
            enum: ['low', 'normal', 'high', 'emergency'],
          },
        },
        ['issue'],
        server,
      ),
    );
  }
  if (role === 'outbound') {
    tools.push(
      functionTool(
        'mark_do_not_call',
        'The person asked not to be called again. Call this, confirm, then end the call.',
        {},
        [],
        server,
      ),
    );
  }
  if (a.transferNumber) {
    tools.push({
      type: 'transferCall',
      destinations: [
        {
          type: 'number',
          number: a.transferNumber,
          message: 'Please hold while I connect you with a team member.',
          description: 'A human on the team',
        },
      ],
    });
  }
  return tools;
}

function serverMessages() {
  const env = process.env.VAPI_SERVER_MESSAGES;
  return env
    ? env
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [
        'status-update',
        'transcript',
        'conversation-update',
        'end-of-call-report',
        'tool-calls',
        'hang',
      ];
}

function buildAssistant(role, a, opts) {
  const server = {
    url: opts.serverUrl,
    secret: opts.serverSecret,
    timeoutSeconds: 20,
  };
  const assistant = {
    name: memberName(role, a),
    firstMessage: firstMessage(role, a),
    firstMessageMode:
      role === 'receptionist' || role === 'outbound'
        ? 'assistant-speaks-first'
        : 'assistant-speaks-first-with-model-generated-message',
    model: {
      provider: 'openai',
      model: opts.model,
      temperature: 0.4,
      messages: [{ role: 'system', content: systemPrompt(role, a) }],
      tools: toolsFor(role, a, server),
    },
    voice: (LANGUAGES[a.language] || LANGUAGES.en).voice || {
      provider: 'vapi',
      voiceId: a.voiceId || 'Elliot',
    },
    transcriber: (LANGUAGES[a.language] || LANGUAGES.en).transcriber,
    server,
    serverMessages: serverMessages(),
    monitorPlan: { listenEnabled: true, controlEnabled: true },
    artifactPlan: { recordingEnabled: a.recordCalls !== false },
    endCallFunctionEnabled: true,
    metadata: {
      acc: '1',
      role,
      locationId: opts.locationId,
      companyId: opts.companyId,
    },
  };
  if (!assistant.firstMessage) delete assistant.firstMessage;
  return assistant;
}

const ROUTES = {
  receptionist: [
    [
      'sales',
      'New work, quotes, estimates, pricing or booking an appointment.',
    ],
    [
      'support',
      'Existing customers: job status, rescheduling, billing, invoices, complaints.',
    ],
  ],
  sales: [
    [
      'support',
      'The caller turns out to be an existing customer with a support or billing issue.',
    ],
  ],
  support: [['sales', 'The caller wants to book new work or get a new quote.']],
};

function buildSquad(a, assistantIds) {
  return {
    name: ((a.businessName || 'Client') + ' Call Center').slice(0, 40),
    members: ROLES.map((role) => ({
      assistantId: assistantIds[role],
      assistantDestinations: ROUTES[role].map(([to, description]) => ({
        type: 'assistant',
        assistantName: memberName(to, a),
        message: '',
        description,
      })),
    })),
  };
}

module.exports = {
  VOICES,
  ROLES,
  ALL_ROLES,
  LANGUAGES,
  ROLE_LABEL,
  DEFAULT_AGENT,
  normalizeAgent,
  systemPrompt,
  buildAssistant,
  buildSquad,
  memberName,
  toolsFor,
};
