import { motion } from 'framer-motion';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import {
  ArrowRight,
  BarChart3,
  Bot,
  Building2,
  Check,
  CreditCard,
  Inbox,
  Library,
  Mail,
  MessageCircle,
  ShieldCheck,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface FeatureGroup {
  id: string;
  icon: LucideIcon;
  title: string;
  summary: string;
  points: string[];
}

// Every item below maps to a shipped capability in the OmniCore app.
const groups: FeatureGroup[] = [
  {
    id: 'inbox',
    icon: Inbox,
    title: 'Unified inbox & ticketing',
    summary:
      'Every live chat and email lands in one real-time queue your whole team works from.',
    points: [
      'Live updates over WebSockets: new messages, assignments and status changes appear instantly',
      'Open, Pending, AI-handled and Closed views with full-text search across names, emails and messages',
      'Turn any conversation into a ticket with priority, or let visitors file tickets from the widget',
      'Round-robin auto-assignment with per-brand SLA targets and automatic escalation of breaches',
      'File and image attachments for agents and visitors',
      'Edit or delete sent messages, assign owners and set priority in one click',
      'Auto-close idle conversations after a configurable period',
      'Notification bell for new conversations and plan events',
    ],
  },
  {
    id: 'ai',
    icon: Bot,
    title: 'AI assistant powered by Google Gemini',
    summary:
      'Answer common questions automatically and hand off to a human the moment it matters.',
    points: [
      'AI auto-replies grounded in your own knowledge base (retrieval-augmented generation)',
      'Per-brand bot persona and system prompt, plus a cap on bot messages per conversation',
      'Detects when a visitor asks for a person and hands over with full context',
      'Conversation summaries for agents picking up a thread',
      'Agent copilot: rephrase any draft in the tone you choose',
    ],
  },
  {
    id: 'knowledge',
    icon: Library,
    title: 'Knowledge base & AI training',
    summary:
      'Teach the AI everything it needs, from whatever you already have.',
    points: [
      'Write and organise articles per brand or for the whole workspace',
      'Crawl your website to import pages automatically',
      'Upload PDFs, paste text content or build FAQ pairs',
      'Search that ranks the most relevant articles for every customer question',
    ],
  },
  {
    id: 'widget',
    icon: MessageCircle,
    title: 'Embeddable live chat widget',
    summary: 'One script tag adds a branded chat to any website.',
    points: [
      'Recognises returning visitors and restores their conversation history',
      'Visitors can send files and images',
      'Offline ticket form with subject, description and priority',
      'Built-in CSAT rating when a conversation is closed',
      'Unread message indicators and real-time delivery',
      "Your brand's logo and colour, set per brand",
    ],
  },
  {
    id: 'email',
    icon: Mail,
    title: 'Email channel',
    summary: 'Bring your support mailbox into the same inbox as chat.',
    points: [
      'Inbound email via a unique forwarding address per brand',
      'Step-by-step guides for Google Workspace and Microsoft 365',
      'Send replies from your own domain with custom SMTP',
      'Built-in SMTP connection test before you go live',
    ],
  },
  {
    id: 'team',
    icon: Users,
    title: 'Team & permissions',
    summary: 'Give every teammate exactly the access they need.',
    points: [
      'Admin, Supervisor and Agent roles',
      'Per-feature read / edit / no-access permissions for inbox, contacts, knowledge base, analytics, brands, team, billing and settings',
      'Email invitations with secure set-password links',
      'Password reset by email and self-service profile management',
    ],
  },
  {
    id: 'contacts',
    icon: BarChart3,
    title: 'Contacts, CSAT & reporting',
    summary: 'Know your customers and measure how well you serve them.',
    points: [
      "Contact directory with each visitor's full conversation history",
      'One-click CSV export of contacts',
      'CSAT and agent performance dashboard with rating distribution',
      'PDF transcript export for any conversation, plus bulk export',
      'Usage meters for agents, brands, conversations and knowledge articles',
    ],
  },
  {
    id: 'brands',
    icon: Building2,
    title: 'Multi-brand & multi-tenant',
    summary:
      'Run several brands, or many client workspaces, from a single platform.',
    points: [
      'Multiple brands per workspace, each with its own widget, inbox address, AI prompt and SLA',
      'Fully isolated workspaces (tenants) for agencies and resellers',
      'Platform administration: manage workspaces, limits, suspensions and user accounts',
      'View any workspace as its owner for support and onboarding',
      'Platform-wide email settings for system notifications',
    ],
  },
  {
    id: 'billing',
    icon: CreditCard,
    title: 'Billing built in',
    summary: 'Subscriptions, trials and invoices handled by Paddle.',
    points: [
      '14-day free trial on paid plans',
      'Secure Paddle checkout (cards, PayPal and more, as enabled in your Paddle account)',
      'Self-service customer portal to update payment details, view invoices or cancel',
      'Plan manager that keeps prices and features in sync with Paddle',
      'Upgrade requests and grace periods for failed payments',
    ],
  },
  {
    id: 'security',
    icon: ShieldCheck,
    title: 'Security & hosting',
    summary: 'Built to production standards from day one.',
    points: [
      'Short-lived access tokens with httpOnly refresh cookies',
      'Strict CORS, security headers and signed, replay-protected billing webhooks',
      'Tenant-isolated data in PostgreSQL',
      'Logos, attachments and exports on Cloudflare R2 with time-limited links',
      'Runs on your own cloud (Oracle Cloud, any Linux VPS, or Docker)',
    ],
  },
];

export default function Features() {
  return (
    <div className="flex flex-col w-full min-h-screen bg-background pt-16">
      {/* Hero */}
      <section className="py-20 md:py-28 bg-[#F5EDE0]">
        <div className="container mx-auto px-4 md:px-8 text-center max-w-3xl">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-sm font-semibold uppercase tracking-widest text-[#C9A450] mb-4"
          >
            Everything in OmniCore
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="font-serif text-4xl md:text-6xl font-bold tracking-tight mb-6 text-balance"
          >
            One helpdesk. Every tool your support team needs.
          </motion.h1>
          <p className="text-lg text-muted-foreground text-balance mb-10">
            Live chat, email, AI answers, knowledge base, ticketing, analytics
            and billing, in a single multi-brand platform.
          </p>
          <nav
            aria-label="Feature sections"
            className="flex flex-wrap justify-center gap-2"
          >
            {groups.map((g) => (
              <a
                key={g.id}
                href={`#${g.id}`}
                className="px-3 py-1.5 rounded-full border border-[#C9A450]/30 text-sm text-foreground/80 hover:bg-[#C9A450]/10 hover:text-[#8B6914] transition-colors"
              >
                {g.title}
              </a>
            ))}
          </nav>
        </div>
      </section>

      {/* Feature groups */}
      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4 md:px-8 grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-8">
          {groups.map((g) => {
            const Icon = g.icon;
            return (
              <motion.article
                key={g.id}
                id={g.id}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                className="scroll-mt-24 p-8 rounded-2xl bg-card border border-border/50 shadow-sm"
              >
                <div className="flex items-start gap-4 mb-5">
                  <div className="w-12 h-12 shrink-0 rounded-lg bg-[#C9A450]/15 flex items-center justify-center text-[#C9A450]">
                    <Icon className="w-6 h-6" aria-hidden="true" />
                  </div>
                  <div>
                    <h2 className="font-serif text-2xl font-semibold mb-1">
                      {g.title}
                    </h2>
                    <p className="text-muted-foreground">{g.summary}</p>
                  </div>
                </div>
                <ul className="space-y-2.5">
                  {g.points.map((point) => (
                    <li
                      key={point}
                      className="flex gap-3 text-sm leading-relaxed"
                    >
                      <Check
                        className="w-4 h-4 mt-0.5 shrink-0 text-[#C9A450]"
                        aria-hidden="true"
                      />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </motion.article>
            );
          })}
        </div>
      </section>

      {/* CTA */}
      <section className="pb-24 md:pb-32">
        <div className="container mx-auto px-4 md:px-8">
          <div className="max-w-4xl mx-auto bg-[#C9A450] text-white rounded-3xl p-10 md:p-14 text-center shadow-xl">
            <h2 className="font-serif text-3xl md:text-4xl font-bold tracking-tight mb-4">
              Try every feature free for 14 days
            </h2>
            <p className="text-white/90 mb-8 max-w-xl mx-auto">
              Pick a plan, start your trial, and invite your team in minutes.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-4">
              <Link href="/pricing">
                <Button
                  size="lg"
                  className="h-12 px-8 rounded-full w-full sm:w-auto bg-white text-[#1A1001] hover:bg-white/90"
                >
                  See plans & pricing <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-12 px-8 rounded-full bg-transparent border-white/30 text-white hover:bg-white/10 w-full sm:w-auto"
              >
                <a href="/contact">Talk to sales</a>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
