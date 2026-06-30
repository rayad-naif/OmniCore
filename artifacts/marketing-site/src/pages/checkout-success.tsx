import { motion } from "framer-motion";
import { Link } from "wouter";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function CheckoutSuccess() {
  return (
    <div className="min-h-screen bg-[#F5EDE0] flex items-center justify-center pt-16 pb-24 px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-lg w-full bg-white/70 backdrop-blur border border-[#C9A450]/20 rounded-3xl shadow-sm p-10 text-center"
      >
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-full bg-[#C9A450]/10 flex items-center justify-center">
            <CheckCircle2 className="w-9 h-9 text-[#C9A450]" />
          </div>
        </div>

        <h1 className="text-3xl font-bold font-serif mb-3">Your trial has started!</h1>
        <p className="text-muted-foreground mb-6">
          Your 14-day free trial of OmniCore is now active. Check your inbox — you'll receive
          a confirmation from Stripe and a setup email from us shortly.
        </p>

        <div className="bg-[#C9A450]/8 border border-[#C9A450]/20 rounded-2xl p-4 text-sm text-left space-y-2 mb-8">
          <p className="font-semibold text-foreground">What's next?</p>
          <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
            <li>Check your email for a workspace setup link.</li>
            <li>Log in to your new OmniCore dashboard.</li>
            <li>Add your team, configure your brand, and go live.</li>
            <li>After 14 days, billing starts automatically at your plan rate.</li>
          </ol>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <a href="/dashboard">
            <Button className="rounded-full px-8 bg-[#C9A450] hover:bg-[#B8963E] text-white font-semibold w-full sm:w-auto">
              Go to Dashboard
            </Button>
          </a>
          <Link href="/help">
            <Button variant="outline" className="rounded-full px-8 border-[#C9A450]/40 text-[#C9A450] hover:bg-[#C9A450]/10 w-full sm:w-auto">
              Read Help Docs
            </Button>
          </Link>
        </div>

        <p className="text-xs text-muted-foreground mt-8">
          Questions? Email us at{" "}
          <a href="mailto:atelier@irofficial.com" className="text-[#C9A450] hover:underline">
            atelier@irofficial.com
          </a>
        </p>
      </motion.div>
    </div>
  );
}
