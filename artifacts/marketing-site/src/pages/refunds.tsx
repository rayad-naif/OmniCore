import { motion } from "framer-motion";
import { Link } from "wouter";
import { RefreshCw } from "lucide-react";

const LAST_UPDATED = "June 29, 2026";
const COMPANY = "IR Atelier (Idylle Radieuse)";
const PRODUCT = "OmniCore";
const CONTACT_EMAIL = "billing@iratelier.com";

export default function Refunds() {
  return (
    <div className="bg-[#F5EDE0] min-h-screen">
      <div className="container mx-auto px-4 md:px-8 py-16 max-w-4xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <div className="flex items-center gap-3 mb-3">
            <RefreshCw className="text-[#C9A450]" size={22} />
            <span className="text-xs uppercase tracking-widest text-[#C9A450] font-semibold">Legal</span>
          </div>
          <h1 className="font-serif text-4xl md:text-5xl font-bold text-foreground mb-3">Refund Policy</h1>
          <p className="text-sm text-muted-foreground mb-12">Last updated: {LAST_UPDATED}</p>

          <div className="prose prose-slate max-w-none space-y-10 text-[15px] leading-relaxed text-foreground/80">

            <section className="p-6 bg-white/50 rounded-2xl border border-[#C9A450]/30">
              <p className="text-base font-medium text-foreground">
                We want you to be confident in your subscription. Our refund policy is designed to be straightforward,
                fair, and transparent. If you are unsatisfied for any reason, we encourage you to contact us — we will
                do our best to make it right.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">1. Free Trial</h2>
              <p>
                {PRODUCT} offers a free trial period on eligible plans. During the free trial, you will not be charged.
                You may cancel at any time before the trial ends without incurring any charges. No credit card is required
                unless explicitly stated at sign-up.
              </p>
              <p className="mt-3">
                If you do not cancel before the trial period expires, your selected subscription plan will begin and your
                payment method will be charged at the applicable rate.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">2. Monthly Subscriptions</h2>
              <p>
                Monthly subscriptions are billed in advance at the start of each billing cycle. The following terms apply:
              </p>
              <ul className="list-disc pl-5 space-y-3 mt-3">
                <li>
                  <strong>30-day money-back guarantee (new subscribers only):</strong> If you are a first-time subscriber
                  and are unsatisfied within the first 30 days of your paid subscription (excluding free trial periods),
                  you may request a full refund of your first payment. This guarantee applies once per account and is not
                  available on renewal payments.
                </li>
                <li>
                  <strong>After 30 days:</strong> Monthly subscription fees are non-refundable after the 30-day window.
                  You may cancel at any time, and your access will continue until the end of the current billing period.
                  No partial-period refunds are issued.
                </li>
                <li>
                  <strong>Cancellation:</strong> You may cancel your subscription from the Billing section of your
                  dashboard or by contacting us. Cancellation stops future charges; it does not generate a refund for
                  any already-paid period.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">3. Annual Subscriptions</h2>
              <ul className="list-disc pl-5 space-y-3">
                <li>
                  <strong>30-day money-back guarantee:</strong> Annual subscribers may request a full refund within 30 days
                  of the initial annual payment. This applies to first-time annual purchases only.
                </li>
                <li>
                  <strong>After 30 days — pro-rated refund:</strong> If you cancel an annual subscription after the 30-day
                  window, we will issue a pro-rated refund for the remaining complete months unused, minus any applicable
                  processing fees (up to 5%). For example, if you cancel after 4 months of a 12-month plan, you may be
                  eligible for a refund for the remaining 8 months.
                </li>
                <li>
                  <strong>Discount-adjusted refunds:</strong> If your annual subscription was purchased at a discounted
                  rate, any pro-rated refund will be calculated based on the effective monthly rate you paid, not on the
                  standard monthly list price.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">4. Plan Downgrades &amp; Upgrades</h2>
              <ul className="list-disc pl-5 space-y-3">
                <li>
                  <strong>Upgrades:</strong> When you upgrade your plan mid-cycle, you will be charged a pro-rated
                  amount for the remainder of the current billing period at the higher plan rate. Your billing cycle
                  date does not change.
                </li>
                <li>
                  <strong>Downgrades:</strong> When you downgrade, the change takes effect at the start of the next
                  billing cycle. No refund is issued for the difference in the current billing period.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">5. Service Credits</h2>
              <p>
                In the event of a verified service outage or failure to meet our stated uptime commitment, affected
                Tenants may be eligible for service credits applied to their next billing cycle. Credits are calculated
                as follows:
              </p>
              <table className="w-full text-sm border border-[#C9A450]/20 rounded-lg overflow-hidden mt-4">
                <thead className="bg-[#C9A450]/10">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-foreground">Monthly Uptime</th>
                    <th className="text-left px-4 py-3 font-semibold text-foreground">Credit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#C9A450]/10">
                  {[
                    ["≥ 99.5% (SLA met)", "No credit"],
                    ["99.0% – 99.49%", "5% of monthly fee"],
                    ["98.0% – 98.99%", "10% of monthly fee"],
                    ["95.0% – 97.99%", "20% of monthly fee"],
                    ["< 95.0%", "30% of monthly fee"],
                  ].map(([uptime, credit]) => (
                    <tr key={uptime}>
                      <td className="px-4 py-3">{uptime}</td>
                      <td className="px-4 py-3 text-muted-foreground">{credit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-4 text-sm text-muted-foreground">
                Credits must be requested within 30 days of the outage by contacting{" "}
                <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#C9A450] hover:underline">{CONTACT_EMAIL}</a>.
                Credits are non-transferable and have no cash value.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">6. Non-Refundable Items</h2>
              <p>The following are non-refundable under any circumstances:</p>
              <ul className="list-disc pl-5 space-y-2 mt-3">
                <li>Setup fees, onboarding fees, or professional services fees.</li>
                <li>Add-on purchases (e.g., additional seats or storage purchased separately).</li>
                <li>Fees for accounts suspended or terminated due to violation of our Terms of Service or Acceptable Use Policy.</li>
                <li>Payments made more than 90 days prior to the refund request.</li>
                <li>Any amounts that have already been credited or partially refunded.</li>
              </ul>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">7. Chargebacks</h2>
              <p>
                We strongly encourage you to contact us before initiating a chargeback with your bank or payment
                provider. Chargebacks incur significant fees and administrative burden. If we determine that a
                chargeback was initiated without a good-faith attempt to resolve the issue directly with us, we
                reserve the right to permanently suspend the associated account and contest the chargeback.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">8. How to Request a Refund</h2>
              <ol className="list-decimal pl-5 space-y-3">
                <li>
                  Email <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#C9A450] hover:underline">{CONTACT_EMAIL}</a>{" "}
                  with the subject line <strong>"Refund Request — [Your Account Email]"</strong>.
                </li>
                <li>Include your account email, the plan you subscribed to, the payment date, and a brief reason for the request.</li>
                <li>We will review your request and respond within <strong>3 business days</strong>.</li>
                <li>
                  Approved refunds are processed within <strong>5–10 business days</strong> and returned to the original
                  payment method. Bank processing times may add additional days depending on your financial institution.
                </li>
              </ol>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">9. Currency &amp; Exchange Rates</h2>
              <p>
                All charges are made in the currency displayed at checkout (typically USD). Refunds are issued in the
                same currency as the original charge. {COMPANY} is not responsible for any currency conversion fees or
                exchange rate differences applied by your bank or card provider.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">10. Changes to This Policy</h2>
              <p>
                We reserve the right to amend this Refund Policy at any time. Material changes will be communicated
                via email or in-app notification at least 14 days before they take effect. The policy in effect at the
                time of your purchase governs refund eligibility for that purchase.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">11. Contact</h2>
              <p>
                For any billing or refund questions, our team is happy to help:
              </p>
              <div className="mt-3 p-4 bg-white/50 rounded-xl border border-[#C9A450]/20 space-y-1 text-sm">
                <p><strong>{COMPANY} — Billing Support</strong></p>
                <p>
                  Email:{" "}
                  <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#C9A450] hover:underline">{CONTACT_EMAIL}</a>
                </p>
                <p>Response time: Within 3 business days</p>
              </div>
            </section>

          </div>

          <div className="mt-16 pt-8 border-t border-[#C9A450]/20 flex flex-col sm:flex-row gap-4 text-sm text-muted-foreground">
            <Link href="/terms" className="hover:text-[#C9A450] transition-colors">Terms of Service</Link>
            <Link href="/privacy" className="hover:text-[#C9A450] transition-colors">Privacy Policy</Link>
            <Link href="/contact" className="hover:text-[#C9A450] transition-colors">Contact Us</Link>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
