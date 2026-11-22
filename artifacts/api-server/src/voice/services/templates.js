'use strict';
/* Industry starter templates. Picking one fills the deploy form so an agency
   can launch a niche client in minutes and then fine-tune. */

const T = (id, label, a) => ({ id, label, agent: a });

const TEMPLATES = [
  T('hvac', 'HVAC', {
    industry: 'heating and air conditioning',
    services:
      'AC repair\nFurnace repair\nNew system installation\nMaintenance plans / tune-ups\nIndoor air quality\nEmergency no-heat / no-cool service',
    faq: 'Q: Do you offer emergency service? A: Yes, for no heat or no cooling we prioritize same-day visits.\nQ: Do you offer financing? A: Yes, financing is available on new systems; the technician can go over options.\nQ: What brands do you service? A: All major brands.',
    pricing:
      'Diagnostic visit fee is credited toward the repair if the customer goes ahead.',
    avgJobValue: 450,
    extra: {
      sales:
        'Always ask the age of the current system and whether it is blowing warm/cold air. No heat in winter or no AC above 90°F is high priority.',
    },
  }),
  T('plumbing', 'Plumbing', {
    industry: 'plumbing',
    services:
      'Leak repair\nDrain cleaning\nWater heater repair and replacement\nToilet and faucet repair\nSewer line inspection\nEmergency plumbing',
    faq: 'Q: Are you available for emergencies? A: Yes, for active leaks and backups we send someone as fast as possible.\nQ: Are you licensed and insured? A: Yes.\nQ: Do you give free estimates? A: Estimates are given on site by the plumber.',
    pricing: '',
    avgJobValue: 350,
    extra: {
      receptionist:
        'If water is actively leaking, tell the caller to shut off the main water valve if they can, then route to Sales as urgent.',
    },
  }),
  T('roofing', 'Roofing', {
    industry: 'roofing',
    services:
      'Roof inspection\nRoof repair\nFull roof replacement\nStorm and hail damage\nInsurance claim help\nGutters',
    faq: 'Q: Do you work with insurance? A: Yes, we help homeowners through storm-damage claims.\nQ: Are inspections free? A: Yes, roof inspections are free.\nQ: How long does a replacement take? A: Most homes are done in one to two days.',
    pricing: 'Inspections are free.',
    avgJobValue: 9000,
    extra: {
      sales:
        'Ask if the damage is from a recent storm and whether they have filed an insurance claim. Book a free inspection.',
    },
  }),
  T('dental', 'Dental practice', {
    industry: 'dental practice',
    services:
      'Cleanings and checkups\nFillings\nCrowns\nWhitening\nInvisalign\nImplants\nEmergency dental visits',
    faq: 'Q: Do you take my insurance? A: We accept most PPO plans; the front desk will verify your coverage before the visit.\nQ: Do you see new patients? A: Yes, we are welcoming new patients.\nQ: I have tooth pain, can I be seen today? A: We keep time for dental emergencies; let me check the schedule.',
    pricing:
      'New patient special pricing is available; the office will confirm details.',
    avgJobValue: 600,
    extra: {
      receptionist:
        'Never give medical advice. For severe swelling, trouble breathing or uncontrolled bleeding, tell the caller to go to the emergency room or call 911.',
      support:
        'Do not discuss treatment details or records; take a message for the office.',
    },
  }),
  T('medspa', 'Med spa', {
    industry: 'medical spa',
    services:
      'Botox and fillers\nLaser hair removal\nFacials and peels\nBody contouring\nIV therapy\nFree consultations',
    faq: 'Q: Is the consultation free? A: Yes, consultations are complimentary.\nQ: Who performs treatments? A: Licensed providers.\nQ: Do you have memberships? A: Yes, ask about our membership plans at your consultation.',
    pricing: '',
    avgJobValue: 700,
    extra: {
      sales:
        'Book a free consultation. Ask which treatment they are interested in and whether they have had it before. Never give medical advice.',
    },
  }),
  T('legal', 'Law firm (intake)', {
    industry: 'law firm',
    services:
      'Free case evaluations\nPersonal injury\nFamily law\nCriminal defense\nEstate planning',
    faq: 'Q: Is the consultation free? A: Yes, the first case evaluation is free.\nQ: How much does it cost? A: Many cases are on contingency; an attorney will explain fees at the evaluation.',
    pricing: '',
    avgJobValue: 3000,
    extra: {
      receptionist:
        'You are an intake assistant, not a lawyer: never give legal advice or predict outcomes. Collect name, contact details, type of case and a short description, then book a case evaluation.',
      sales:
        'Ask when the incident happened and whether they already have an attorney. Never give legal advice.',
    },
  }),
  T('realestate', 'Real estate', {
    industry: 'real estate brokerage',
    services:
      'Buying a home\nSelling a home / free home valuation\nRentals\nShowings',
    faq: 'Q: What is my home worth? A: We offer a free valuation; an agent will prepare one for you.\nQ: Can I see a listing? A: Yes, I can book a showing with an agent.',
    pricing: '',
    avgJobValue: 8000,
    extra: {
      sales:
        'Find out if they are buying, selling or both, their timeline, price range, area and whether they are pre-approved. Book a call or showing with an agent.',
    },
  }),
  T('solar', 'Solar', {
    industry: 'solar installation',
    services:
      'Solar panel installation\nBattery storage\nFree solar assessment\nFinancing and incentives',
    faq: 'Q: How much can I save? A: It depends on your roof and usage; the free assessment gives exact numbers.\nQ: Is there financing? A: Yes, including zero-down options for qualified homeowners.',
    pricing: '',
    avgJobValue: 25000,
    extra: {
      sales:
        'Qualify: homeowner or renter, average monthly electric bill, roof age and shade. Only homeowners qualify. Book a free assessment.',
    },
  }),
];

module.exports = {
  TEMPLATES,
  byId: (id) => TEMPLATES.find((t) => t.id === id) || null,
};
