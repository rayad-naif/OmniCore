import { motion } from "framer-motion";
import { Link } from "wouter";
import { FileText } from "lucide-react";

const LAST_UPDATED = "June 29, 2026";
const COMPANY = "IR Atelier (Idylle Radieuse)";
const PRODUCT = "OmniCore";
const OWNER = "Rayad Haider Farooqi";
const CONTACT_EMAIL = "atelier@irofficial.com";
const CONTACT_PHONE = "+923294816780";

export default function Terms() {
  return (
    <div className="bg-[#F5EDE0] min-h-screen">
      <div className="container mx-auto px-4 md:px-8 py-16 max-w-4xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <div className="flex items-center gap-3 mb-3">
            <FileText className="text-[#C9A450]" size={22} />
            <span className="text-xs uppercase tracking-widest text-[#C9A450] font-semibold">Legal</span>
          </div>
          <h1 className="font-serif text-4xl md:text-5xl font-bold text-foreground mb-3">Terms of Service</h1>
          <p className="text-sm text-muted-foreground mb-12">Last updated: {LAST_UPDATED}</p>

          <div className="prose prose-slate max-w-none space-y-10 text-[15px] leading-relaxed text-foreground/80">

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">1. Agreement to Terms</h2>
              <p>
                By accessing or using {PRODUCT} ("the Service"), a SaaS omnichannel helpdesk platform operated by {COMPANY}
                ("we," "us," or "our"), you agree to be bound by these Terms of Service ("Terms"). If you are using the Service
                on behalf of an organisation, you represent that you have authority to bind that organisation to these Terms.
              </p>
              <p className="mt-3">
                If you do not agree to these Terms, you must not access or use the Service. We reserve the right to update
                these Terms at any time. Continued use of the Service after any change constitutes acceptance of the revised Terms.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">2. Description of Service</h2>
              <p>
                {PRODUCT} is a multi-tenant, AI-powered omnichannel customer support platform that allows businesses
                ("Tenants") to manage customer conversations across email, live chat, and other channels through a
                centralised agent dashboard and embeddable widget.
              </p>
              <p className="mt-3">
                We reserve the right to modify, suspend, or discontinue any aspect of the Service at any time with
                reasonable prior notice where practicable.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">3. Account Registration &amp; Security</h2>
              <ul className="list-disc pl-5 space-y-2">
                <li>You must provide accurate, current, and complete information when creating an account.</li>
                <li>You are solely responsible for maintaining the confidentiality of your login credentials.</li>
                <li>You must immediately notify us of any unauthorised use of your account.</li>
                <li>One person or legal entity may not maintain more than one free-tier account.</li>
                <li>Accounts may not be shared or used by multiple individuals without a multi-seat plan.</li>
              </ul>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">4. Acceptable Use</h2>
              <p>You agree not to use the Service to:</p>
              <ul className="list-disc pl-5 space-y-2 mt-3">
                <li>Violate any applicable law, regulation, or third-party rights.</li>
                <li>Send unsolicited commercial messages (spam) to end-users.</li>
                <li>Transmit malware, viruses, or any code intended to damage or interfere with systems.</li>
                <li>Harvest or scrape data from the Service without authorisation.</li>
                <li>Circumvent, disable, or interfere with security features.</li>
                <li>Reverse-engineer, decompile, or disassemble any portion of the Service.</li>
                <li>Resell or sublicense access to the Service without our written consent.</li>
                <li>Process data of minors under 13 years of age without verifiable parental consent.</li>
              </ul>
              <p className="mt-3">
                We reserve the right to suspend or terminate accounts that violate this acceptable use policy without
                prior notice.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">5. Subscriptions &amp; Billing</h2>
              <p>
                {PRODUCT} is offered on a subscription basis. By subscribing to a paid plan, you authorise us (or our
                billing partner) to charge your payment method on a recurring basis at the applicable plan rate.
              </p>
              <ul className="list-disc pl-5 space-y-2 mt-3">
                <li><strong>Billing cycle:</strong> Subscriptions are billed monthly or annually in advance depending on your selected plan.</li>
                <li><strong>Price changes:</strong> We will provide at least 30 days' written notice before increasing the price of your current plan.</li>
                <li><strong>Taxes:</strong> Prices are exclusive of applicable taxes unless otherwise stated. You are responsible for any taxes applicable to your jurisdiction.</li>
                <li><strong>Cancellation:</strong> You may cancel at any time. Cancellation takes effect at the end of the current billing period. See our Refund Policy for details.</li>
                <li><strong>Failed payments:</strong> If a payment fails, we will attempt to retry the charge. Persistent non-payment may result in service suspension.</li>
              </ul>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">6. Free Trials</h2>
              <p>
                We may offer a free trial period. At the end of the trial, you will be charged at the applicable plan
                rate unless you cancel before the trial ends. We reserve the right to modify or discontinue free trial
                offers at any time without notice.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">7. Intellectual Property</h2>
              <p>
                The Service, including its software, design, text, graphics, logos, and all other content, is owned
                by or licensed to {COMPANY} and is protected by applicable intellectual property laws.
              </p>
              <p className="mt-3">
                You retain all rights to data and content you upload or create using the Service ("Customer Data").
                You grant us a limited, worldwide, royalty-free licence to host, copy, transmit, and display Customer
                Data solely as necessary to provide the Service. We will never use Customer Data for advertising or
                share it with third parties except as required to operate the Service.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">8. Data Processing</h2>
              <p>
                Where you process personal data of your end-users (customers, visitors) through the Service, you act
                as the data controller and we act as the data processor. Our processing activities are governed by our
                Privacy Policy and any applicable Data Processing Agreement.
              </p>
              <p className="mt-3">
                You are responsible for ensuring you have a lawful basis to collect and process the personal data of
                your end-users, and for providing appropriate privacy notices to them.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">9. Uptime &amp; Support</h2>
              <p>
                We aim to maintain a Service uptime of 99.5% per calendar month, excluding planned maintenance windows
                (notified at least 24 hours in advance). Uptime guarantees and support response times vary by plan and
                are detailed on our Pricing page. We do not guarantee uninterrupted or error-free operation of the Service.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">10. Confidentiality</h2>
              <p>
                Each party agrees to keep confidential any non-public information received from the other party that
                is designated as confidential or that reasonably should be understood to be confidential. This obligation
                does not apply to information that is publicly available, independently developed, or disclosed with the
                disclosing party's consent.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">11. Disclaimer of Warranties</h2>
              <p>
                THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR
                IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE,
                NON-INFRINGEMENT, OR UNINTERRUPTED ACCESS. WE DO NOT WARRANT THAT THE SERVICE WILL BE FREE OF ERRORS,
                VIRUSES, OR OTHER HARMFUL COMPONENTS.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">12. Limitation of Liability</h2>
              <p>
                TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, {COMPANY.toUpperCase()} SHALL NOT BE LIABLE FOR ANY
                INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOSS OF PROFITS, DATA,
                BUSINESS GOODWILL, OR OTHER INTANGIBLE LOSSES, ARISING OUT OF OR IN CONNECTION WITH YOUR USE OF OR
                INABILITY TO USE THE SERVICE.
              </p>
              <p className="mt-3">
                OUR TOTAL CUMULATIVE LIABILITY ARISING OUT OF THESE TERMS SHALL NOT EXCEED THE GREATER OF (A) THE AMOUNTS
                PAID BY YOU TO US IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM, OR (B) ONE HUNDRED US DOLLARS (USD 100).
              </p>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">13. Indemnification</h2>
              <p>
                You agree to defend, indemnify, and hold harmless {COMPANY}, its officers, directors, employees, and
                agents from and against any claims, damages, obligations, losses, liabilities, costs, or expenses
                (including legal fees) arising from: (a) your use of the Service; (b) Customer Data; (c) your violation
                of these Terms; or (d) your violation of any third-party right.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">14. Termination</h2>
              <p>
                Either party may terminate the agreement upon written notice if the other party materially breaches
                these Terms and fails to cure such breach within 30 days of written notice.
              </p>
              <p className="mt-3">
                We may suspend or terminate your access immediately for violations of the Acceptable Use policy,
                non-payment, or where required by law.
              </p>
              <p className="mt-3">
                Upon termination, your right to use the Service ceases. We will retain Customer Data for 30 days
                post-termination to allow export, after which it will be deleted in accordance with our data
                retention policy.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">15. Governing Law &amp; Dispute Resolution</h2>
              <p>
                These Terms are governed by the laws of Pakistan, without regard to conflict-of-law principles.
                Any disputes arising under these Terms shall first be subject to good-faith negotiation between the
                parties. If unresolved after 30 days, disputes shall be submitted to binding arbitration in Karachi,
                Pakistan, under applicable arbitration rules. Notwithstanding the foregoing, either party may seek
                injunctive relief in any court of competent jurisdiction.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">16. Miscellaneous</h2>
              <ul className="list-disc pl-5 space-y-2">
                <li><strong>Entire Agreement:</strong> These Terms, together with the Privacy Policy and Refund Policy, constitute the entire agreement between you and {COMPANY} regarding the Service.</li>
                <li><strong>Severability:</strong> If any provision is found unenforceable, the remaining provisions remain in full force.</li>
                <li><strong>Waiver:</strong> Failure to enforce any right does not constitute a waiver of that right.</li>
                <li><strong>Assignment:</strong> You may not assign these Terms without our prior written consent. We may assign them in connection with a merger, acquisition, or sale of assets.</li>
                <li><strong>Force Majeure:</strong> Neither party is liable for delays caused by circumstances beyond reasonable control.</li>
              </ul>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">17. Contact</h2>
              <div className="mt-3 p-4 bg-white/50 rounded-xl border border-[#C9A450]/20 space-y-1 text-sm">
                <p><strong>{OWNER}</strong></p>
                <p>{COMPANY}</p>
                <p>Multan, Punjab, Pakistan</p>
                <p>Email: <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#C9A450] hover:underline">{CONTACT_EMAIL}</a></p>
                <p>Phone: <a href={`tel:${CONTACT_PHONE}`} className="text-[#C9A450] hover:underline">{CONTACT_PHONE}</a></p>
              </div>
            </section>

          </div>

          <div className="mt-16 pt-8 border-t border-[#C9A450]/20 flex flex-col sm:flex-row gap-4 text-sm text-muted-foreground">
            <Link href="/privacy" className="hover:text-[#C9A450] transition-colors">Privacy Policy</Link>
            <Link href="/refunds" className="hover:text-[#C9A450] transition-colors">Refund Policy</Link>
            <Link href="/contact" className="hover:text-[#C9A450] transition-colors">Contact Us</Link>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
