import { Link } from "wouter";
import { ArrowLeft, Bot, CheckCircle, Lightbulb } from "lucide-react";

export default function HelpAiBotSetup() {
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
              <Bot className="w-5 h-5 text-[#C9A450]" />
            </div>
            <span className="text-sm font-medium text-[#C9A450]">Bot &amp; AI</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-4 font-serif">
            AI Bot Setup &amp; Configuration
          </h1>
          <p className="text-lg text-muted-foreground">
            Enable OmniCore's AI bot to automatically answer common questions, deflect repetitive
            tickets, and escalate complex issues to a human agent — all without writing a single
            line of code.
          </p>
        </div>
      </section>

      <article className="py-12 md:py-16">
        <div className="container mx-auto px-4 md:px-8 max-w-3xl">
          <div className="prose dark:prose-invert max-w-none">

            <h2>How the AI Bot Works</h2>
            <p>
              OmniCore's AI bot uses your knowledge base articles and conversation history to generate
              context-aware replies. When a visitor starts a conversation, the bot attempts to answer
              immediately. If confidence is low or the visitor explicitly asks for a human, the bot
              creates an escalation event and notifies your agents.
            </p>

            <h2>Step 1 — Enable the Bot for Your Brand</h2>
            <ol>
              <li>In the OmniCore dashboard, navigate to <strong>Settings → Brands</strong> and select your brand.</li>
              <li>Open the <strong>AI Bot</strong> tab.</li>
              <li>Toggle <strong>Enable AI Bot</strong> to on.</li>
              <li>Click <strong>Save</strong>. The bot is now active on all new conversations for that brand.</li>
            </ol>

            <h2>Step 2 — Configure Bot Persona</h2>
            <p>
              A consistent persona builds visitor trust and keeps your brand voice coherent across
              automated and human replies.
            </p>
            <ol>
              <li>Under <strong>Bot Persona</strong>, set the <strong>Bot Name</strong> (e.g., <em>Aria</em>) and upload a square avatar image.</li>
              <li>
                Choose a <strong>Tone</strong>: <em>Professional</em>, <em>Friendly</em>, or <em>Concise</em>.
                This controls how the AI phrases its answers.
              </li>
              <li>Optionally add a <strong>Greeting Message</strong> — the first message visitors see when they open the widget.</li>
            </ol>

            <h2>Step 3 — Build Your Knowledge Base</h2>
            <p>
              The bot draws answers from knowledge base articles you create in OmniCore. Article quality
              directly determines answer accuracy.
            </p>

            <div className="not-prose p-5 rounded-2xl bg-gradient-to-br from-[#C9A450]/10 to-transparent border border-[#C9A450]/20 my-6">
              <div className="flex items-center gap-2 mb-3">
                <Lightbulb className="w-5 h-5 text-[#8B6914]" />
                <h3 className="font-bold text-[#8B6914] m-0">Knowledge Base Tips</h3>
              </div>
              <ul className="list-disc list-inside text-sm space-y-2 ml-4">
                <li>Write one article per topic — don't bundle unrelated questions.</li>
                <li>Use clear, descriptive titles that mirror how visitors phrase questions.</li>
                <li>Include step-by-step numbered lists for procedural content.</li>
                <li>Review and update articles whenever your product changes.</li>
                <li>Aim for at least 20 articles before enabling the bot on a live brand.</li>
              </ul>
            </div>

            <ol>
              <li>Go to <strong>Knowledge Base → New Article</strong>.</li>
              <li>Add a title, body content, and relevant tags (used for topic matching).</li>
              <li>Set visibility to <strong>Bot Only</strong> (internal) or <strong>Public</strong> (also shown in widget search).</li>
              <li>Click <strong>Publish</strong>. The bot indexes the article within 60 seconds.</li>
            </ol>

            <h2>Step 4 — Set Handoff Rules</h2>
            <p>
              Handoff rules determine when the bot stops replying and escalates to a human agent.
              Good handoff rules prevent frustrated visitors from feeling trapped in a bot loop.
            </p>

            <div className="not-prose grid gap-3 my-6">
              {[
                { rule: 'Visitor types "human", "agent", or "real person"', action: "Instant escalation" },
                { rule: "Bot confidence below threshold (default 60%)", action: "Escalation with context summary" },
                { rule: "No resolution after 3 bot turns", action: "Escalation + flag for review" },
                { rule: "Conversation tagged as billing or legal", action: "Skip bot, route directly to agent" },
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-border/50 bg-card">
                  <CheckCircle className="w-5 h-5 text-[#C9A450] mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">{item.rule}</p>
                    <p className="text-xs text-muted-foreground">{item.action}</p>
                  </div>
                </div>
              ))}
            </div>

            <p>
              Configure custom rules under <strong>Settings → AI Bot → Handoff Rules</strong>. You can
              add keyword triggers, minimum confidence thresholds, and per-tag routing.
            </p>

            <h2>Step 5 — Review Bot Performance</h2>
            <p>
              OmniCore tracks key bot metrics in <strong>Reports → AI Bot</strong>:
            </p>
            <ul>
              <li><strong>Deflection rate</strong> — percentage of conversations resolved without agent involvement.</li>
              <li><strong>Escalation rate</strong> — percentage escalated to a human.</li>
              <li><strong>CSAT on bot conversations</strong> — visitor satisfaction scores on bot-handled threads.</li>
              <li><strong>Unanswered questions</strong> — queries the bot couldn't handle, surfaced as knowledge gaps.</li>
            </ul>
            <p>
              Review unanswered questions weekly and convert high-frequency gaps into new knowledge base
              articles to continuously improve deflection rates.
            </p>

            <h2>Troubleshooting</h2>
            <h3>Bot not responding to new conversations</h3>
            <p>
              Confirm the bot is enabled for the specific brand the conversation belongs to. The toggle
              is per-brand, not global.
            </p>
            <h3>Bot giving incorrect answers</h3>
            <p>
              Check whether the relevant knowledge base article is published (not in Draft state) and
              that it's tagged correctly. You can also manually force a re-index from{" "}
              <strong>Knowledge Base → Settings → Re-index All</strong>.
            </p>
            <h3>Bot escalating immediately on every conversation</h3>
            <p>
              Your confidence threshold may be set too high. Lower it in{" "}
              <strong>Settings → AI Bot → Handoff Rules → Confidence Threshold</strong>, or add more
              knowledge base articles on the topics your visitors commonly ask about.
            </p>
          </div>

          <div className="mt-12 pt-8 border-t">
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
