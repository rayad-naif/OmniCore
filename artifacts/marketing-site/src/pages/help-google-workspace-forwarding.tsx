import { Link } from "wouter";
import { ChevronRight, ArrowLeft, Mail, CheckCircle } from "lucide-react";

export default function HelpGoogleWorkspaceForwarding() {
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
            Google Workspace Email Forwarding
          </h1>
          <p className="text-lg text-muted-foreground">
            Forward emails from your Google Workspace (G Suite) mailbox to OmniCore so every
            inbound message becomes a support conversation automatically.
          </p>
        </div>
      </section>

      <article className="py-12 md:py-16">
        <div className="container mx-auto px-4 md:px-8 max-w-3xl">
          <div className="prose dark:prose-invert max-w-none">

            <h2>Prerequisites</h2>
            <ul>
              <li>Admin access to your Google Workspace account</li>
              <li>An active OmniCore workspace with at least one brand configured</li>
              <li>Your OmniCore inbound address (find it in <strong>Settings → Channels → Email</strong>)</li>
            </ul>

            <div className="not-prose bg-muted border rounded-xl p-4 my-6">
              <p className="text-sm font-medium mb-1">Your OmniCore inbound address</p>
              <code className="text-sm font-mono text-foreground">your-brand@inbound.atelieromnicore.com</code>
              <p className="text-xs text-muted-foreground mt-1">Replace <em>your-brand</em> with your brand's slug shown in the dashboard.</p>
            </div>

            <h2>Step 1 — Open Gmail Forwarding Settings</h2>
            <ol>
              <li>Sign in to the Google Workspace mailbox you want to connect (e.g., support@yourcompany.com).</li>
              <li>Click the <strong>Settings</strong> gear icon in the top-right corner, then select <strong>See all settings</strong>.</li>
              <li>Navigate to the <strong>Forwarding and POP/IMAP</strong> tab.</li>
            </ol>

            <h2>Step 2 — Add a Forwarding Address</h2>
            <ol>
              <li>Under <strong>Forwarding</strong>, click <strong>Add a forwarding address</strong>.</li>
              <li>Enter your OmniCore inbound address and click <strong>Next</strong>.</li>
              <li>Google will send a confirmation email to your OmniCore inbox. Open <strong>OmniCore → Conversations</strong> and find the confirmation message from Google.</li>
              <li>Click the confirmation link in that message to verify the address.</li>
            </ol>

            <h2>Step 3 — Enable Forwarding</h2>
            <ol>
              <li>Return to <strong>Gmail Settings → Forwarding and POP/IMAP</strong>.</li>
              <li>Select <strong>Forward a copy of incoming mail to</strong> and choose your OmniCore address from the dropdown.</li>
              <li>
                Choose what Gmail should do with the original message. We recommend{" "}
                <strong>Keep Gmail's copy in the Inbox</strong> so your team retains a backup.
              </li>
              <li>Click <strong>Save Changes</strong>.</li>
            </ol>

            <h2>Step 4 — Verify in OmniCore</h2>
            <p>
              Send a test email to your support address. Within a few seconds it should appear as a new
              conversation in your OmniCore dashboard under the brand you configured.
            </p>

            <div className="not-prose grid gap-3 my-6">
              {[
                "New email arrives at support@yourcompany.com",
                "Gmail forwards a copy to your-brand@inbound.atelieromnicore.com",
                "OmniCore creates a conversation and notifies your agents",
              ].map((text, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-border/50 bg-card">
                  <CheckCircle className="w-5 h-5 text-[#C9A450] mt-0.5 shrink-0" />
                  <span className="text-sm">{text}</span>
                </div>
              ))}
            </div>

            <h2>Troubleshooting</h2>
            <h3>Confirmation email never arrived</h3>
            <p>
              Check your OmniCore <strong>All Conversations</strong> view and ensure you are looking at
              the correct brand. The confirmation comes from <em>forwarding-noreply@google.com</em>.
            </p>
            <h3>Emails forwarding but no conversations appearing</h3>
            <p>
              Confirm the brand slug in your inbound address exactly matches the slug shown in{" "}
              <strong>OmniCore → Settings → Channels → Email</strong>. Slugs are case-sensitive.
            </p>
            <h3>Using Google Admin routing instead of per-mailbox forwarding</h3>
            <p>
              Enterprise admins can configure domain-wide routing rules in{" "}
              <strong>Google Admin → Apps → Google Workspace → Gmail → Routing</strong> to forward all
              mail for a specific address to OmniCore without per-user setup.
            </p>
          </div>

          <div className="mt-12 pt-8 border-t flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <Link href="/help/microsoft-365-email-setup" className="inline-flex items-center gap-1.5 text-sm font-medium text-[#C9A450] hover:underline">
              Next: Microsoft 365 Email Setup <ChevronRight className="w-4 h-4" />
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
