import { motion } from "framer-motion";
import { Link } from "wouter";
import { ShieldCheck } from "lucide-react";

const LAST_UPDATED = "June 29, 2026";
const COMPANY = "IR Atelier (Idylle Radieuse)";
const PRODUCT = "OmniCore";
const CONTACT_EMAIL = "privacy@iratelier.com";
const DPA_EMAIL = "dpa@iratelier.com";

export default function Privacy() {
  return (
    <div className="bg-[#F5EDE0] min-h-screen">
      <div className="container mx-auto px-4 md:px-8 py-16 max-w-4xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <div className="flex items-center gap-3 mb-3">
            <ShieldCheck className="text-[#C9A450]" size={22} />
            <span className="text-xs uppercase tracking-widest text-[#C9A450] font-semibold">Legal</span>
          </div>
          <h1 className="font-serif text-4xl md:text-5xl font-bold text-foreground mb-3">Privacy Policy</h1>
          <p className="text-sm text-muted-foreground mb-12">Last updated: {LAST_UPDATED}</p>

          <div className="prose prose-slate max-w-none space-y-10 text-[15px] leading-relaxed text-foreground/80">

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">1. Introduction</h2>
              <p>
                {COMPANY} ("we," "us," or "our") operates {PRODUCT}, a SaaS omnichannel helpdesk platform. This
                Privacy Policy explains how we collect, use, disclose, and protect information about you when you
                use our website and Service.
              </p>
              <p className="mt-3">
                We are committed to protecting your privacy and handling your data with transparency and integrity.
                This policy is designed to comply with applicable data protection laws, including the General Data
                Protection Regulation (GDPR) and Pakistan's Personal Data Protection principles.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">2. Who This Policy Applies To</h2>
              <p>This policy applies to:</p>
              <ul className="list-disc pl-5 space-y-2 mt-3">
                <li><strong>Account holders (Tenants):</strong> Businesses and individuals who register for an {PRODUCT} account.</li>
                <li><strong>Agents:</strong> Team members who access the Service on behalf of a Tenant.</li>
                <li><strong>End-users (Visitors):</strong> Individuals who interact with a Tenant's support widget or email channel.</li>
                <li><strong>Website visitors:</strong> Individuals who browse our marketing site.</li>
              </ul>
              <p className="mt-3">
                Where {PRODUCT} processes personal data on behalf of a Tenant's end-users, {COMPANY} acts as a
                <strong> data processor</strong> and the Tenant acts as the <strong>data controller</strong>.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">3. Information We Collect</h2>

              <h3 className="font-semibold text-foreground mt-5 mb-2">3.1 Information You Provide Directly</h3>
              <ul className="list-disc pl-5 space-y-2">
                <li><strong>Account information:</strong> Name, email address, company name, password (hashed), and billing details when you register.</li>
                <li><strong>Communication content:</strong> Messages, attachments, and metadata in conversations handled through the Service.</li>
                <li><strong>Support requests:</strong> Information you share when contacting our support team.</li>
                <li><strong>Payment information:</strong> Billing details are collected and processed by our payment provider. We do not store raw card numbers.</li>
              </ul>

              <h3 className="font-semibold text-foreground mt-5 mb-2">3.2 Information Collected Automatically</h3>
              <ul className="list-disc pl-5 space-y-2">
                <li><strong>Log data:</strong> IP addresses, browser type, pages visited, timestamps, and referring URLs when you access the Service.</li>
                <li><strong>Device information:</strong> Browser, operating system, and device identifiers.</li>
                <li><strong>Usage data:</strong> Features used, conversation counts, response times, and other product analytics.</li>
                <li><strong>Cookies &amp; similar technologies:</strong> Session cookies and local storage tokens for authentication. See Section 9 for details.</li>
              </ul>

              <h3 className="font-semibold text-foreground mt-5 mb-2">3.3 Information from Third Parties</h3>
              <ul className="list-disc pl-5 space-y-2">
                <li><strong>Email providers:</strong> When a Tenant's customer sends an inbound email, we receive message content, sender information, and any attachments.</li>
                <li><strong>Payment processors:</strong> Billing confirmation and subscription status from our payment partner.</li>
              </ul>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">4. How We Use Your Information</h2>
              <table className="w-full text-sm border border-[#C9A450]/20 rounded-lg overflow-hidden mt-3">
                <thead className="bg-[#C9A450]/10">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-foreground">Purpose</th>
                    <th className="text-left px-4 py-3 font-semibold text-foreground">Lawful Basis</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#C9A450]/10">
                  {[
                    ["Providing and maintaining the Service", "Performance of contract"],
                    ["Processing payments and managing subscriptions", "Performance of contract"],
                    ["Sending transactional emails (receipts, alerts)", "Performance of contract"],
                    ["Responding to support requests", "Legitimate interest"],
                    ["Improving and developing the Service", "Legitimate interest"],
                    ["Security monitoring and fraud prevention", "Legitimate interest / legal obligation"],
                    ["Sending product updates and marketing (with opt-out)", "Consent / Legitimate interest"],
                    ["Complying with legal obligations", "Legal obligation"],
                  ].map(([purpose, basis]) => (
                    <tr key={purpose}>
                      <td className="px-4 py-3">{purpose}</td>
                      <td className="px-4 py-3 text-muted-foreground">{basis}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">5. How We Share Your Information</h2>
              <p>We do not sell personal data. We may share data with:</p>
              <ul className="list-disc pl-5 space-y-2 mt-3">
                <li><strong>Service providers:</strong> Infrastructure, hosting (cloud), payment processors, email delivery services, and AI model providers — all under data processing agreements.</li>
                <li><strong>AI services:</strong> Message content may be sent to Google Gemini (AI provider) solely to generate automated support responses, subject to Google's data processing terms.</li>
                <li><strong>Cloud storage:</strong> File attachments may be stored in Cloudflare R2 object storage.</li>
                <li><strong>Legal authorities:</strong> Where required by law, court order, or to protect rights and safety.</li>
                <li><strong>Business transfers:</strong> In connection with a merger, acquisition, or sale of assets, with written notice to affected users.</li>
              </ul>
              <p className="mt-3">
                All third-party sub-processors are listed in our Sub-processor Register, available upon request at{" "}
                <a href={`mailto:${DPA_EMAIL}`} className="text-[#C9A450] hover:underline">{DPA_EMAIL}</a>.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">6. Data Retention</h2>
              <ul className="list-disc pl-5 space-y-2">
                <li><strong>Account data:</strong> Retained for the duration of your subscription and deleted within 90 days of account closure, unless required by law.</li>
                <li><strong>Conversation data:</strong> Retained for the subscription period plus 30 days post-cancellation for export.</li>
                <li><strong>Billing records:</strong> Retained for 7 years for tax and accounting compliance.</li>
                <li><strong>Log files:</strong> Retained for up to 90 days for security and debugging purposes.</li>
                <li><strong>Backups:</strong> Encrypted backups may be retained for up to 30 additional days on a rolling basis.</li>
              </ul>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">7. Data Security</h2>
              <p>We implement industry-standard security measures, including:</p>
              <ul className="list-disc pl-5 space-y-2 mt-3">
                <li>TLS encryption in transit for all data communications.</li>
                <li>Encrypted storage at rest for the database and file uploads.</li>
                <li>JWT-based authentication with short-lived access tokens and httpOnly refresh cookies.</li>
                <li>Role-based access controls limiting agent and admin permissions.</li>
                <li>Regular security reviews and dependency audits.</li>
              </ul>
              <p className="mt-3">
                Despite our efforts, no system is completely secure. We cannot guarantee absolute security and are
                not liable for unauthorised access beyond our reasonable control. We will notify affected users of
                any significant data breach in accordance with applicable law.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">8. Your Rights</h2>
              <p>Depending on your jurisdiction, you may have the following rights regarding your personal data:</p>
              <ul className="list-disc pl-5 space-y-2 mt-3">
                <li><strong>Access:</strong> Request a copy of the personal data we hold about you.</li>
                <li><strong>Rectification:</strong> Request correction of inaccurate or incomplete data.</li>
                <li><strong>Erasure ("right to be forgotten"):</strong> Request deletion of your personal data, subject to legal retention requirements.</li>
                <li><strong>Restriction:</strong> Request that we restrict processing of your data in certain circumstances.</li>
                <li><strong>Data portability:</strong> Receive your data in a machine-readable format.</li>
                <li><strong>Objection:</strong> Object to processing based on legitimate interests or for direct marketing.</li>
                <li><strong>Withdrawal of consent:</strong> Where processing is based on consent, withdraw it at any time without affecting prior processing.</li>
              </ul>
              <p className="mt-3">
                To exercise any of these rights, email us at{" "}
                <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#C9A450] hover:underline">{CONTACT_EMAIL}</a>.
                We will respond within 30 days (or within the timeframe required by applicable law).
              </p>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">9. Cookies &amp; Tracking</h2>
              <p>We use the following cookies:</p>
              <table className="w-full text-sm border border-[#C9A450]/20 rounded-lg overflow-hidden mt-3">
                <thead className="bg-[#C9A450]/10">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-foreground">Cookie</th>
                    <th className="text-left px-4 py-3 font-semibold text-foreground">Purpose</th>
                    <th className="text-left px-4 py-3 font-semibold text-foreground">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#C9A450]/10">
                  <tr>
                    <td className="px-4 py-3 font-mono text-xs">omnicore_rt</td>
                    <td className="px-4 py-3">Authentication refresh token (httpOnly)</td>
                    <td className="px-4 py-3">7 days</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-mono text-xs">omnicore_vid</td>
                    <td className="px-4 py-3">Visitor session identity for the chat widget</td>
                    <td className="px-4 py-3">30 days</td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-4">
                We do not use advertising or third-party tracking cookies. You can disable cookies in your browser
                settings, but this may impair the functionality of the Service.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">10. International Data Transfers</h2>
              <p>
                We are based in Pakistan. Our infrastructure and sub-processors may be located in other countries,
                including within the European Economic Area and the United States. When we transfer personal data
                internationally, we ensure appropriate safeguards are in place, such as Standard Contractual Clauses
                (SCCs) or equivalent mechanisms where required by applicable law.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">11. Children's Privacy</h2>
              <p>
                The Service is not directed to children under the age of 13. We do not knowingly collect personal
                data from children under 13. If you believe a child has provided us with personal data without
                parental consent, please contact us and we will delete it promptly.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">12. Changes to This Policy</h2>
              <p>
                We may update this Privacy Policy from time to time. We will notify you of material changes by
                posting the new policy on this page and, where appropriate, by email. Your continued use of the
                Service after changes constitutes your acceptance of the updated policy.
              </p>
            </section>

            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">13. Contact &amp; Data Protection</h2>
              <p>
                For privacy-related enquiries, data subject requests, or to contact our Data Protection team:
              </p>
              <div className="mt-3 p-4 bg-white/50 rounded-xl border border-[#C9A450]/20 space-y-1 text-sm">
                <p><strong>{COMPANY}</strong></p>
                <p>Privacy &amp; Data Protection</p>
                <p>
                  Email:{" "}
                  <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#C9A450] hover:underline">{CONTACT_EMAIL}</a>
                </p>
                <p>
                  DPA enquiries:{" "}
                  <a href={`mailto:${DPA_EMAIL}`} className="text-[#C9A450] hover:underline">{DPA_EMAIL}</a>
                </p>
              </div>
            </section>

          </div>

          <div className="mt-16 pt-8 border-t border-[#C9A450]/20 flex flex-col sm:flex-row gap-4 text-sm text-muted-foreground">
            <Link href="/terms" className="hover:text-[#C9A450] transition-colors">Terms of Service</Link>
            <Link href="/refunds" className="hover:text-[#C9A450] transition-colors">Refund Policy</Link>
            <Link href="/contact" className="hover:text-[#C9A450] transition-colors">Contact Us</Link>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
