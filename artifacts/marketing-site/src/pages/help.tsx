import { Link } from "wouter";
import { motion } from "framer-motion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BookOpen, Settings, Mail, Bot, ChevronRight } from "lucide-react";

export default function Help() {
  return (
    <div className="flex flex-col w-full min-h-screen bg-background pt-16">
      <section className="py-16 md:py-24 bg-muted/30 border-b">
        <div className="container mx-auto px-4 md:px-8 text-center max-w-3xl">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl md:text-5xl font-bold tracking-tight mb-6 font-serif"
          >
            Documentation & Help
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-lg text-muted-foreground mb-8"
          >
            Everything you need to set up, configure, and master Atelier OmniCore.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="relative max-w-xl mx-auto"
          >
            <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-muted-foreground">
              <BookOpen className="w-5 h-5" />
            </div>
            <input
              type="text"
              className="flex h-12 w-full rounded-full border border-input bg-background px-12 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 shadow-sm"
              placeholder="Search guides, tutorials, and API docs..."
            />
          </motion.div>
        </div>
      </section>

      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4 md:px-8 max-w-5xl space-y-16">

          <article id="getting-started" className="bg-card border border-border/50 rounded-3xl p-6 md:p-10 shadow-sm">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-[#C9A450]/10 flex items-center justify-center">
                <Settings className="w-5 h-5 text-[#C9A450]" />
              </div>
              <div>
                <h2 className="text-2xl font-bold">Getting Started</h2>
                <p className="text-sm text-muted-foreground">Initial setup &amp; configuration</p>
              </div>
            </div>

            <p className="text-muted-foreground mb-6">Follow these essential steps to get your workspace ready for your team.</p>

            <div className="grid gap-4">
              {[
                { title: "1. Create your workspace account", desc: "Setting up your company details and timezone." },
                { title: "2. Add your brand assets", desc: "Upload logos and set colors for the chat widget." },
                { title: "3. Invite your agents", desc: "Add team members and assign roles (Admin, Agent, Viewer)." },
                { title: "4. Embed the widget", desc: "Copy the script tag to your website's <head>." },
              ].map((step, i) => (
                <div key={i} className="flex items-center justify-between p-4 rounded-xl border border-border/50 hover:border-[#C9A450]/30 hover:bg-[#F5EDE0]/50 transition-colors group">
                  <div>
                    <h3 className="font-semibold">{step.title}</h3>
                    <p className="text-sm text-muted-foreground mt-1">{step.desc}</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-[#C9A450] transition-colors" />
                </div>
              ))}
            </div>
          </article>

          <article id="email-setup" className="bg-card border border-border/50 rounded-3xl p-6 md:p-10 shadow-sm">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-[#C9A450]/10 flex items-center justify-center">
                <Mail className="w-5 h-5 text-[#C9A450]" />
              </div>
              <div>
                <h2 className="text-2xl font-bold">Email Setup — Connecting Mailboxes</h2>
                <p className="text-sm text-muted-foreground">Connect your mailboxes</p>
              </div>
            </div>

            <div className="prose dark:prose-invert max-w-none">
              <h3>Forwarding your support email</h3>
              <p>
                To receive emails in OmniCore, forward emails from your existing support address
                (e.g., support@yourcompany.com) to your OmniCore forwarding address.
              </p>
              <div className="bg-muted p-4 rounded-lg my-4 font-mono text-sm border not-prose">
                your-brand@inbound.atelieromnicore.com
              </div>

              <h3>Setup guides by provider</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6 not-prose">
                <Link href="/help/google-workspace-forwarding">
                  <Card className="shadow-none border-border/50 hover:border-[#C9A450]/30 hover:shadow-md transition-all cursor-pointer h-full">
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-base">Google Workspace (G Suite)</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <CardDescription>Configure forwarding in Gmail settings</CardDescription>
                      <p className="text-xs text-[#C9A450] mt-2 font-medium flex items-center gap-1">
                        Read guide <ChevronRight className="w-3 h-3" />
                      </p>
                    </CardContent>
                  </Card>
                </Link>
                <Link href="/help/microsoft-365-email-setup">
                  <Card className="shadow-none border-border/50 hover:border-[#C9A450]/30 hover:shadow-md transition-all cursor-pointer h-full">
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-base">Microsoft 365</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <CardDescription>Setup Exchange mail flow rules</CardDescription>
                      <p className="text-xs text-[#C9A450] mt-2 font-medium flex items-center gap-1">
                        Read guide <ChevronRight className="w-3 h-3" />
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              </div>
            </div>
          </article>

          <article id="bot-ai" className="bg-card border border-border/50 rounded-3xl p-6 md:p-10 shadow-sm">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-[#C9A450]/10 flex items-center justify-center">
                <Bot className="w-5 h-5 text-[#C9A450]" />
              </div>
              <div>
                <h2 className="text-2xl font-bold">Bot &amp; AI — Enabling the AI Bot</h2>
                <p className="text-sm text-muted-foreground">Configure auto-replies and AI deflection</p>
              </div>
            </div>

            <p className="text-muted-foreground mb-6">Configure your AI agent to deflect repetitive questions instantly.</p>

            <div className="grid gap-6">
              <div className="p-6 rounded-2xl bg-gradient-to-br from-[#C9A450]/10 to-transparent border border-[#C9A450]/20">
                <h3 className="font-bold text-lg text-[#8B6914] mb-2">Knowledge Base Tips</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  The AI Bot is only as good as the knowledge you feed it. Ensure your help articles are clear,
                  up-to-date, and cover your most common support inquiries.
                </p>
                <ul className="list-disc list-inside text-sm space-y-2 text-foreground ml-4">
                  <li>Write descriptive titles for articles</li>
                  <li>Use bullet points for step-by-step instructions</li>
                  <li>Update articles when your product changes</li>
                </ul>
              </div>

              <Link href="/help/ai-bot-setup" className="flex items-center justify-between p-4 rounded-xl border border-border/50 hover:border-[#C9A450]/30 hover:bg-[#F5EDE0]/50 transition-colors group">
                <div>
                  <h3 className="font-semibold">Full AI Bot Setup Guide</h3>
                  <p className="text-sm text-muted-foreground mt-1">Persona configuration, handoff rules, and performance review.</p>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-[#C9A450] transition-colors" />
              </Link>

              <div className="grid gap-4">
                {[
                  { title: "Configure Bot Persona", desc: "Set the bot's name, avatar, and tone of voice." },
                  { title: "Set Handoff Rules", desc: "Determine when the bot should escalate to a human agent." },
                  { title: "Review Bot Performance", desc: "Analyze deflection rates and improve knowledge gaps." },
                ].map((step, i) => (
                  <div key={i} className="flex items-center justify-between p-4 rounded-xl border border-border/50 hover:border-[#C9A450]/30 hover:bg-[#F5EDE0]/50 transition-colors group">
                    <div>
                      <h3 className="font-semibold">{step.title}</h3>
                      <p className="text-sm text-muted-foreground mt-1">{step.desc}</p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-[#C9A450] transition-colors" />
                  </div>
                ))}
              </div>
            </div>
          </article>

        </div>
      </section>
    </div>
  );
}
