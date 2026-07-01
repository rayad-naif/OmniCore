import { Link } from "wouter";
import { ChevronRight, ArrowLeft, Mail, CheckCircle } from "lucide-react";

export default function HelpMicrosoft365EmailSetup() {
  return (
    <div className="flex flex-col w-full min-h-screen bg-background pt-16">
      <section className="py-12 md:py-16 bg-muted/30 border-b">
        <div className="container mx-auto px-4 md:px-8 max-w-3xl">
          <Link href="/help" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Back to Help Center
          </Link>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-[#C9A450]/10 flex items-center justify-center">
              <Mail className="w-5 h-5 text-[#C9A450]" />
            </div>
            <span className="text-sm font-medium text-[#C9A450]">Email Setup</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-4 font-serif">
            Microsoft 365 Email Setup
          </h1>
          <p className="text-lg text-muted-foreground">
            Route email from your Microsoft 365 / Exchange Online mailbox into OmniCore using a
            mail flow rule so every inbound message is converted to a support conversation.
          </p>
        </div>
      </section>

      <article className="py-12 md:py-16">
        <div className="container mx-auto px-4 md:px-8 max-w-3xl">
          <div className="prose dark:prose-invert max-w-none">

            <h2>Prerequisites</h2>
            <ul>
              <li>Global Admin or Exchange Admin access in your Microsoft 365 tenant</li>
              <li>An active OmniCore workspace with at least one brand configured</li>
              <li>Your OmniCore inbound address (find it in <strong>Settings → Channels → Email</strong>)</li>
            </ul>

            <div className="not-prose bg-muted border rounded-xl p-4 my-6">
              <p className="text-sm font-medium mb-1">Your OmniCore inbound address</p>
              <code className="text-sm font-mono text-foreground">your-brand@inbound.atelieromnicore.com</code>
              <p className="text-xs text-muted-foreground mt-1">Replace <em>your-brand</em> with your brand's slug shown in the dashboard.</p>
            </div>

            <h2>Option A — Per-Mailbox Forwarding (Outlook on the web)</h2>
            <p>Best for forwarding a single mailbox without admin access to Exchange.</p>
            <ol>
              <li>Sign in to <strong>Outlook on the web</strong> (outlook.office.com) as the mailbox owner.</li>
              <li>Go to <strong>Settings → View all Outlook settings → Mail → Forwarding</strong>.</li>
              <li>Enable <strong>Enable forwarding</strong>, enter your OmniCore inbound address, and optionally tick <strong>Keep a copy of forwarded messages</strong>.</li>
              <li>Click <strong>Save</strong>.</li>
            </ol>

            <h2>Option B — Exchange Mail Flow Rule (Recommended for Teams)</h2>
            <p>
              A mail flow rule (transport rule) forwards a copy of every message sent to your support
              address without altering the original delivery.
            </p>
            <ol>
              <li>Open the <strong>Exchange Admin Center</strong> at <em>admin.exchange.microsoft.com</em>.</li>
              <li>Navigate to <strong>Mail flow → Rules</strong> and click <strong>+ Add a rule → Create a new rule</strong>.</li>
              <li>Give the rule a descriptive name, e.g., <em>Forward support mail to OmniCore</em>.</li>
              <li>
                Under <strong>Apply this rule if…</strong> choose <strong>The recipient is…</strong> and
                select your support mailbox (e.g., support@yourcompany.com).
              </li>
              <li>
                Under <strong>Do the following…</strong> choose{" "}
                <strong>Redirect the message to… → these recipients</strong> and enter your OmniCore
                inbound address.
              </li>
              <li>Set the rule <strong>Priority</strong> appropriately and click <strong>Save</strong>.</li>
            </ol>

            <div className="not-prose bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-4 my-6">
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-200 mb-1">Redirect vs. Forward</p>
              <p className="text-sm text-amber-800 dark:text-amber-300">
                Use <strong>Redirect</strong> (not <em>Forward</em>) in the rule. Redirect delivers the
                message as if it were sent directly to OmniCore, preserving the original sender headers.
                Forward wraps the message and can cause OmniCore to show the support mailbox as the sender.
              </p>
            </div>

            <h2>Step — Verify in OmniCore</h2>
            <p>
              Send a test email to your support address. Within seconds it should appear as a new
              conversation in your OmniCore dashboard under the correct brand.
            </p>

            <div className="not-prose grid gap-3 my-6">
              {[
                "New email arrives at support@yourcompany.com",
                "Exchange routes a copy to your-brand@inbound.atelieromnicore.com",
                "OmniCore creates a conversation and notifies your agents",
              ].map((text, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-border/50 bg-card">
                  <CheckCircle className="w-5 h-5 text-[#C9A450] mt-0.5 shrink-0" />
                  <span className="text-sm">{text}</span>
                </div>
              ))}
            </div>

            <h2>Troubleshooting</h2>
            <h3>Rule not triggering</h3>
            <p>
              Ensure the rule is <strong>Enabled</strong> (toggle on in the Rules list) and that your
              support address exactly matches the recipient condition. Rules are evaluated in priority order —
              a higher-priority rule could be stopping mail flow before your rule runs.
            </p>
            <h3>Emails arriving but conversations not created</h3>
            <p>
              Verify your OmniCore inbound address is spelled correctly, including the brand slug. You can
              also temporarily send a direct test email to the OmniCore inbound address to rule out the
              Exchange rule as the cause.
            </p>
            <h3>Shared mailboxes</h3>
            <p>
              Shared mailboxes in Microsoft 365 require Option B (mail flow rule) since they do not
              support per-mailbox forwarding settings in Outlook on the web.
            </p>
          </div>

          <div className="mt-12 pt-8 border-t flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <Link href="/help/ai-bot-setup" className="inline-flex items-center gap-1.5 text-sm font-medium text-[#C9A450] hover:underline">
              Next: AI Bot Setup <ChevronRight className="w-4 h-4" />
            </Link>
            <Link href="/help" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-4 h-4" />
              Back to Help Center
            </Link>
          </div>
        </div>
      </article>
    </div>
  );
}
