import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Check, X } from "lucide-react";

const plans = [
  {
    name: "Starter",
    description: "Perfect for small teams getting started with modern support.",
    price: "$29",
    billing: "per agent/month",
    features: [
      "Up to 3 agents",
      "Live Chat Widget",
      "Email Integration (1 inbox)",
      "Basic Reporting",
      "7-day history",
    ],
    missing: [
      "AI Bot Deflection",
      "Multi-tenant Workspace",
      "Custom Branding",
      "API Access",
    ],
    cta: "Start Free Trial",
    popular: false,
  },
  {
    name: "Growth",
    description: "For scaling teams that need AI and powerful automations.",
    price: "$79",
    billing: "per agent/month",
    features: [
      "Unlimited agents",
      "Live Chat Widget",
      "Email Integration (Unlimited)",
      "AI Bot Deflection (10k msgs/mo)",
      "Advanced Reporting",
      "Unlimited history",
      "Custom Branding",
    ],
    missing: [
      "Multi-tenant Workspace",
      "Dedicated Success Manager",
    ],
    cta: "Start Free Trial",
    popular: true,
  },
  {
    name: "Enterprise",
    description: "Multi-tenant architecture and robust controls for large orgs.",
    price: "Custom",
    billing: "billed annually",
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
  }
];

export default function Pricing() {
  return (
    <div className="flex flex-col w-full min-h-screen bg-background pt-16">
      <section className="py-20 md:py-32 bg-muted/30">
        <div className="container mx-auto px-4 md:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <motion.h1 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-4xl md:text-6xl font-bold tracking-tight mb-6"
            >
              Simple, transparent pricing.
            </motion.h1>
            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-lg md:text-xl text-muted-foreground"
            >
              No hidden fees. No surprise charges. Choose the plan that fits your team's needs and scale as you grow.
            </motion.p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {plans.map((plan, i) => (
              <motion.div
                key={plan.name}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + (i * 0.1) }}
                className={`relative p-8 rounded-3xl border bg-card flex flex-col h-full ${
                  plan.popular ? 'border-primary shadow-xl scale-100 md:scale-105 z-10' : 'border-border/50 shadow-sm'
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                    Most Popular
                  </div>
                )}
                
                <div className="mb-6">
                  <h3 className="text-2xl font-bold mb-2">{plan.name}</h3>
                  <p className="text-muted-foreground text-sm h-10">{plan.description}</p>
                </div>
                
                <div className="mb-8">
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-extrabold">{plan.price}</span>
                    {plan.price !== "Custom" && <span className="text-muted-foreground">/mo</span>}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">{plan.billing}</div>
                </div>
                
                <div className="flex-1">
                  <ul className="space-y-4 mb-8">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-3">
                        <div className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-primary mt-0.5">
                          <Check className="w-3 h-3" />
                        </div>
                        <span className="text-sm">{feature}</span>
                      </li>
                    ))}
                    {plan.missing.map((feature) => (
                      <li key={feature} className="flex items-start gap-3 opacity-50">
                        <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-muted-foreground mt-0.5">
                          <X className="w-4 h-4" />
                        </div>
                        <span className="text-sm">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                
                <Button 
                  size="lg" 
                  variant={plan.popular ? "default" : "outline"}
                  className={`w-full rounded-full ${plan.popular ? 'shadow-md shadow-primary/20' : ''}`}
                >
                  {plan.cta}
                </Button>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
      
      <section className="py-24 bg-background">
        <div className="container mx-auto px-4 md:px-8 text-center max-w-2xl">
          <h2 className="text-3xl font-bold mb-6">Need a custom setup?</h2>
          <p className="text-muted-foreground mb-8">
            Our Enterprise plan is tailored for large organizations with complex multi-tenant requirements. We'll work with you to ensure a smooth transition.
          </p>
          <a href="/contact">
            <Button size="lg" className="rounded-full px-8">Talk to Sales</Button>
          </a>
        </div>
      </section>
    </div>
  );
}
