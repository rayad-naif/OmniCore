import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Check, Lock, ArrowLeft, Info } from "lucide-react";

const TRIAL_DAYS = 14;

const PLAN_META: Record<string, {
  name: string;
  tagline: string;
  monthlyUsd: number;
  features: string[];
}> = {
  starter: {
    name: "Starter",
    tagline: "OmniCore Starter",
    monthlyUsd: 29,
    features: [
      "Up to 3 agents",
      "1 brand / inbox",
      "Live Chat Widget",
      "Email Integration (1 inbox)",
      "Basic Reporting",
      "500 conversations / month",
    ],
  },
  growth: {
    name: "Growth",
    tagline: "OmniCore Growth",
    monthlyUsd: 79,
    features: [
      "Unlimited agents",
      "Up to 10 brands",
      "AI Bot Deflection (10k msgs/mo)",
      "Advanced Reporting",
      "SMTP / Custom Email Domain",
      "10,000 conversations / month",
    ],
  },
};

export default function Checkout() {
  const [location] = useLocation();
  const params = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : ""
  );
  const planSlug = (params.get("plan") || "growth").toLowerCase();
  const plan = PLAN_META[planSlug];

  const [email, setEmail] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [userName, setUserName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Redirect unknown plan slugs back to pricing
  useEffect(() => {
    if (!plan) {
      window.location.href = "/pricing";
    }
  }, [plan]);

  if (!plan) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!businessName.trim()) { setError("Please enter your business name."); return; }
    if (!userName.trim()) { setError("Please enter your name."); return; }
    if (!email.trim()) { setError("Please enter your work email address."); return; }

    setLoading(true);
    try {
      const res = await fetch("/api/billing/checkout/public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          plan: planSlug,
          businessName: businessName.trim(),
          userName: userName.trim(),
        }),
      });
      const data = await res.json() as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error || "Unable to start checkout. Please try again.");
      }
      window.location.href = data.url;
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F5EDE0] pt-20 pb-16">
      <div className="container mx-auto px-4 max-w-5xl">

        <Link href="/pricing">
          <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-[#C9A450] transition-colors mb-8">
            <ArrowLeft className="w-4 h-4" /> Back to Pricing
          </button>
        </Link>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid md:grid-cols-2 gap-10 items-start"
        >
          {/* Left: plan summary */}
          <div className="bg-white/60 backdrop-blur rounded-3xl border border-[#C9A450]/20 p-8 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#C9A450] mb-1">
              {plan.tagline}
            </p>
            <h2 className="text-2xl font-bold font-serif mb-1">{plan.name} Plan</h2>

            <div className="flex items-baseline gap-1 text-[#C9A450] mt-4 mb-1">
              <span className="text-4xl font-extrabold">${plan.monthlyUsd}</span>
              <span className="text-[#C9A450]/70">/month</span>
            </div>
            <p className="text-xs text-muted-foreground">per workspace, billed monthly in USD</p>

            {/* Trial callout */}
            <div className="mt-5 bg-[#C9A450]/8 border border-[#C9A450]/25 rounded-xl p-3 text-sm">
              <p className="font-semibold text-foreground">
                {TRIAL_DAYS}-day free trial included
              </p>
              <p className="text-muted-foreground text-xs mt-0.5">
                Your card will not be charged until day {TRIAL_DAYS + 1}.
                After the trial, you'll be billed ${plan.monthlyUsd}/month automatically.
                Cancel any time before then at no cost.
              </p>
            </div>

            {/* What's included */}
            <ul className="mt-6 space-y-2.5">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-sm">
                  <div className="flex-shrink-0 w-5 h-5 rounded-full bg-[#C9A450]/10 flex items-center justify-center text-[#C9A450] mt-0.5">
                    <Check className="w-3 h-3" />
                  </div>
                  {f}
                </li>
              ))}
            </ul>

            {/* Tax note */}
            <div className="mt-6 flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-[#C9A450]" />
              <span>Taxes may apply and will be calculated at checkout based on your billing address.</span>
            </div>

            {/* Legal links */}
            <p className="mt-4 text-xs text-muted-foreground">
              By subscribing you agree to our{" "}
              <Link href="/terms" className="underline hover:text-[#C9A450]">Terms of Service</Link>,{" "}
              <Link href="/privacy" className="underline hover:text-[#C9A450]">Privacy Policy</Link>, and{" "}
              <Link href="/refunds" className="underline hover:text-[#C9A450]">Refund Policy</Link>.
            </p>
          </div>

          {/* Right: email form */}
          <div className="bg-white/60 backdrop-blur rounded-3xl border border-[#C9A450]/20 p-8 shadow-sm">
            <h3 className="text-xl font-bold font-serif mb-2">Start your free trial</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Enter your work email to continue to our secure checkout. Your card won't
              be charged until after the {TRIAL_DAYS}-day trial.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="businessName" className="block text-sm font-medium mb-1.5">
                  Business name
                </label>
                <input
                  id="businessName"
                  type="text"
                  required
                  autoFocus
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="Acme Corp"
                  className="w-full px-4 py-2.5 rounded-xl border border-[#C9A450]/30 bg-white/70 text-sm outline-none focus:ring-2 focus:ring-[#C9A450]/40 focus:border-[#C9A450] transition"
                />
              </div>
              <div>
                <label htmlFor="userName" className="block text-sm font-medium mb-1.5">
                  Your name
                </label>
                <input
                  id="userName"
                  type="text"
                  required
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="Jane Smith"
                  className="w-full px-4 py-2.5 rounded-xl border border-[#C9A450]/30 bg-white/70 text-sm outline-none focus:ring-2 focus:ring-[#C9A450]/40 focus:border-[#C9A450] transition"
                />
              </div>
              <div>
                <label htmlFor="email" className="block text-sm font-medium mb-1.5">
                  Work email
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full px-4 py-2.5 rounded-xl border border-[#C9A450]/30 bg-white/70 text-sm outline-none focus:ring-2 focus:ring-[#C9A450]/40 focus:border-[#C9A450] transition"
                />
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                disabled={loading}
                size="lg"
                className="w-full rounded-full bg-[#C9A450] hover:bg-[#B8963E] text-white font-semibold disabled:opacity-60"
              >
                {loading ? "Redirecting to checkout…" : `Start ${TRIAL_DAYS}-Day Free Trial →`}
              </Button>

              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-1">
                <Lock className="w-3 h-3" />
                Secure checkout. We never store your card details.
              </div>
            </form>

            <div className="mt-8 pt-6 border-t text-sm text-muted-foreground space-y-2">
              <p className="font-medium text-foreground">What happens next?</p>
              <ol className="list-decimal list-inside space-y-1 text-xs">
                <li>Our secure checkout page collects your payment details.</li>
                <li>Your {TRIAL_DAYS}-day trial starts immediately — no charge yet.</li>
                <li>You'll receive an email to set up your OmniCore workspace.</li>
                <li>On day {TRIAL_DAYS + 1}, ${plan.monthlyUsd} is charged unless you cancel.</li>
              </ol>
            </div>
          </div>
        </motion.div>

        {/* Wrong plan? */}
        <p className="text-center text-sm text-muted-foreground mt-10">
          Looking for a different plan?{" "}
          <Link href="/pricing" className="text-[#C9A450] hover:underline font-medium">
            See all plans
          </Link>
        </p>
      </div>
    </div>
  );
}
