import { motion } from "framer-motion";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Check, X, Info } from "lucide-react";

const TRIAL_DAYS = 14;

const plans = [
  {
    slug: "starter",
    name: "Starter",
    tagline: "OmniCore Starter",
    description: "Perfect for small teams getting started with modern support.",
    monthlyUsd: 29,
    billing: "per workspace / month, billed monthly",
    trialNote: `${TRIAL_DAYS}-day free trial, then $29/month. Cancel anytime.`,
    features: [
      "Up to 3 agents",
      "1 brand / inbox",
      "Live Chat Widget",
      "Email Integration (1 inbox)",
      "Basic Reporting",
      "7-day conversation history",
      "500 conversations / month",
    ],
    missing: [
      "AI Bot Deflection",
      "Multi-brand Workspace",
      "Custom Branding",
      "API Access",
      "SMTP / Custom Email Domain",
    ],
    cta: `Start ${TRIAL_DAYS}-Day Free Trial`,
    popular: false,
  },
  {
    slug: "growth",
    name: "Growth",
    tagline: "OmniCore Growth",
    description: "For scaling teams that need AI and powerful automations.",
    monthlyUsd: 79,
    billing: "per workspace / month, billed monthly",
    trialNote: `${TRIAL_DAYS}-day free trial, then $79/month. Cancel anytime.`,
    features: [
      "Unlimited agents",
      "Up to 10 brands",
      "Live Chat Widget",
      "Email Integration (Unlimited)",
      "AI Bot Deflection (10k msgs/mo)",
      "Advanced Reporting",
      "Unlimited conversation history",
      "10,000 conversations / month",
      "Custom Branding",
      "SMTP / Custom Email Domain",
    ],
    missing: [
      "Multi-tenant Workspace",
      "Dedicated Success Manager",
    ],
    cta: `Start ${TRIAL_DAYS}-Day Free Trial`,
    popular: true,
  },
  {
    slug: "enterprise",
    name: "Enterprise",
    tagline: "OmniCore Enterprise",
    description: "Multi-tenant architecture and robust controls for large orgs.",
    monthlyUsd: null,
    billing: "custom contract, billed annually",
    trialNote: null,
    features: [
      "Everything in Growth",
      "Multi-tenant Workspace",
      "Unlimited AI Bot limits",
      "API Access & Webhooks",
      "SSO & Advanced RBAC",
      "Dedicated Success Manager",
      "Custom Contract & SLA",
    ],
    missing: [],
    cta: "Contact Sales",
    popular: false,
  },
];

export default function Pricing() {
  return (
    <div className="flex flex-col w-full min-h-screen bg-background pt-16">

      {/* Hero */}
      <section className="py-20 md:py-28 bg-muted/30">
        <div className="container mx-auto px-4 md:px-8">
          <div className="text-center max-w-3xl mx-auto mb-4">
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-sm font-semibold uppercase tracking-widest text-[#C9A450] mb-4"
            >
              Atelier OmniCore Pricing
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-4xl md:text-6xl font-bold tracking-tight mb-6 font-serif"
            >
              Simple, transparent pricing.
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-lg md:text-xl text-muted-foreground"
            >
              No hidden fees. No surprise charges. All prices are in USD.
              Each plan includes a {TRIAL_DAYS}-day free trial — your card is charged only
              after the trial ends at the full monthly rate shown below.
            </motion.p>
          </div>

          {/* Tax notice */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15 }}
            className="flex items-start gap-2 max-w-xl mx-auto mb-14 text-sm text-muted-foreground bg-[#C9A450]/5 border border-[#C9A450]/20 rounded-xl px-4 py-3"
          >
            <Info className="w-4 h-4 text-[#C9A450] flex-shrink-0 mt-0.5" />
            <span>
              Taxes may apply and will be calculated at checkout based on your billing address.
            </span>
          </motion.div>

          {/* Plan cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {plans.map((plan, i) => (
              <motion.div
                key={plan.slug}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.1 }}
                className={`relative p-8 rounded-3xl border bg-card flex flex-col h-full ${
                  plan.popular
                    ? "border-[#C9A450] shadow-xl scale-100 md:scale-105 z-10"
                    : "border-border/50 shadow-sm"
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-[#C9A450] text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                    Most Popular
                  </div>
                )}

                <div className="mb-2">
                  <p className="text-xs text-[#C9A450] font-semibold uppercase tracking-wider mb-1">
                    {plan.tagline}
                  </p>
                  <h3 className="text-2xl font-bold mb-2 font-serif">{plan.name}</h3>
                  <p className="text-muted-foreground text-sm h-10">{plan.description}</p>
                </div>

                <div className="mb-6 mt-4">
                  {plan.monthlyUsd !== null ? (
                    <>
                      <div className="flex items-baseline gap-1 text-[#C9A450]">
                        <span className="text-4xl font-extrabold">${plan.monthlyUsd}</span>
                        <span className="text-[#C9A450]/80">/mo</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">{plan.billing}</div>
                      {plan.trialNote && (
                        <div className="text-xs text-muted-foreground mt-1 italic">
                          {plan.trialNote}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="text-4xl font-extrabold text-[#C9A450]">Custom</div>
                      <div className="text-xs text-muted-foreground mt-1">{plan.billing}</div>
                    </>
                  )}
                </div>

                <div className="flex-1">
                  <ul className="space-y-3 mb-8">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-3">
                        <div className="flex-shrink-0 w-5 h-5 rounded-full bg-[#C9A450]/10 flex items-center justify-center text-[#C9A450] mt-0.5">
                          <Check className="w-3 h-3" />
                        </div>
                        <span className="text-sm">{feature}</span>
                      </li>
                    ))}
                    {plan.missing.map((feature) => (
                      <li key={feature} className="flex items-start gap-3 opacity-40">
                        <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center mt-0.5">
                          <X className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <span className="text-sm">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {plan.slug !== "enterprise" ? (
                  <Link href={`/checkout?plan=${plan.slug}`}>
                    <Button
                      size="lg"
                      className={`w-full rounded-full ${
                        plan.popular
                          ? "bg-[#C9A450] hover:bg-[#B8963E] text-white shadow-md shadow-[#C9A450]/20"
                          : "bg-transparent border-[#C9A450]/50 text-[#C9A450] hover:bg-[#C9A450]/10 border"
                      }`}
                    >
                      {plan.cta}
                    </Button>
                  </Link>
                ) : (
                  <Link href="/contact">
                    <Button
                      size="lg"
                      className="w-full rounded-full bg-transparent border-[#C9A450]/50 text-[#C9A450] hover:bg-[#C9A450]/10 border"
                    >
                      {plan.cta}
                    </Button>
                  </Link>
                )}
              </motion.div>
            ))}
          </div>

          {/* Compliance footer */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="text-center text-xs text-muted-foreground mt-12 max-w-2xl mx-auto"
          >
            All plans automatically renew monthly at the rate shown above until cancelled.
            You may cancel at any time before the trial ends and will not be charged.
            Taxes may apply and will be calculated at checkout.
            By subscribing you agree to our{" "}
            <Link href="/terms" className="underline hover:text-[#C9A450]">Terms of Service</Link>,{" "}
            <Link href="/privacy" className="underline hover:text-[#C9A450]">Privacy Policy</Link>, and{" "}
            <Link href="/refunds" className="underline hover:text-[#C9A450]">Refund Policy</Link>.
          </motion.p>
        </div>
      </section>

      {/* FAQ / reassurance strip */}
      <section className="py-16 bg-background border-t">
        <div className="container mx-auto px-4 md:px-8 max-w-4xl">
          <h2 className="text-2xl font-bold text-center mb-10 font-serif">Common questions</h2>
          <div className="grid md:grid-cols-2 gap-8 text-sm">
            {[
              {
                q: "What happens after the 14-day trial?",
                a: "Your card is charged the full monthly rate for your chosen plan on day 15. You can cancel before then with no charge.",
              },
              {
                q: "Can I switch plans?",
                a: "Yes — upgrade or downgrade at any time from the Billing section of your dashboard. Changes take effect at the next billing cycle.",
              },
              {
                q: "Are there any setup fees?",
                a: "No setup fees, no hidden fees. You pay only the monthly rate shown on this page.",
              },
              {
                q: "What currencies do you accept?",
                a: "All prices are in USD. Your bank or card provider may apply conversion fees if your account is in a different currency.",
              },
              {
                q: "Do you offer refunds?",
                a: "Yes — new subscribers can request a full refund within 30 days. See our Refund Policy for full details.",
              },
              {
                q: "How do taxes work?",
                a: "Applicable taxes are calculated based on your billing address and shown clearly before you confirm payment at checkout.",
              },
            ].map(({ q, a }) => (
              <div key={q}>
                <p className="font-semibold text-foreground mb-1">{q}</p>
                <p className="text-muted-foreground">{a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Enterprise CTA */}
      <section className="py-20 bg-muted/30 border-t">
        <div className="container mx-auto px-4 md:px-8 text-center max-w-2xl">
          <h2 className="text-3xl font-bold mb-4 font-serif">Need a custom setup?</h2>
          <p className="text-muted-foreground mb-8">
            Our Enterprise plan is tailored for large organisations with complex multi-tenant
            requirements. Custom pricing, custom SLA, dedicated support.
          </p>
          <Link href="/contact">
            <Button size="lg" className="rounded-full px-8 bg-[#C9A450] hover:bg-[#B8963E] text-white">
              Talk to Sales
            </Button>
          </Link>
        </div>
      </section>

    </div>
  );
}
