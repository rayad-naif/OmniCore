import { motion } from "framer-motion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
        <div className="container mx-auto px-4 md:px-8 max-w-5xl">
          <Tabs defaultValue="getting-started" className="w-full">
            <TabsList className="grid w-full grid-cols-1 md:grid-cols-3 h-auto gap-2 bg-transparent p-0 mb-12">
              <TabsTrigger 
                value="getting-started" 
                className="data-[state=active]:bg-[#C9A450] data-[state=active]:text-white data-[state=active]:shadow-md rounded-xl py-4 flex flex-col gap-2 border border-transparent data-[state=inactive]:border-border/50 data-[state=inactive]:bg-card hover:bg-muted/50 transition-all"
              >
                <Settings className="w-6 h-6 mb-1" />
                <span className="font-semibold text-base">Getting Started</span>
                <span className="text-xs font-normal opacity-80">Initial setup & configuration</span>
              </TabsTrigger>
              <TabsTrigger 
                value="email-setup" 
                className="data-[state=active]:bg-[#C9A450] data-[state=active]:text-white data-[state=active]:shadow-md rounded-xl py-4 flex flex-col gap-2 border border-transparent data-[state=inactive]:border-border/50 data-[state=inactive]:bg-card hover:bg-muted/50 transition-all"
              >
                <Mail className="w-6 h-6 mb-1" />
                <span className="font-semibold text-base">Email Setup</span>
                <span className="text-xs font-normal opacity-80">Connect your mailboxes</span>
              </TabsTrigger>
              <TabsTrigger 
                value="bot-ai" 
                className="data-[state=active]:bg-[#C9A450] data-[state=active]:text-white data-[state=active]:shadow-md rounded-xl py-4 flex flex-col gap-2 border border-transparent data-[state=inactive]:border-border/50 data-[state=inactive]:bg-card hover:bg-muted/50 transition-all"
              >
                <Bot className="w-6 h-6 mb-1" />
                <span className="font-semibold text-base">Bot & AI</span>
                <span className="text-xs font-normal opacity-80">Configure auto-replies</span>
              </TabsTrigger>
            </TabsList>

            <div className="bg-card border border-border/50 rounded-3xl p-6 md:p-10 shadow-sm">
              <TabsContent value="getting-started" className="mt-0 outline-none">
                <div className="space-y-8">
                  <div>
                    <h2 className="text-2xl font-bold mb-4">How to set up OmniCore</h2>
                    <p className="text-muted-foreground mb-6">Follow these essential steps to get your workspace ready for your team.</p>
                  </div>
                  
                  <div className="grid gap-4">
                    {[
                      { title: "1. Create your workspace account", desc: "Setting up your company details and timezone." },
                      { title: "2. Add your brand assets", desc: "Upload logos and set colors for the chat widget." },
                      { title: "3. Invite your agents", desc: "Add team members and assign roles (Admin, Agent, Viewer)." },
                      { title: "4. Embed the widget", desc: "Copy the script tag to your website's <head>." }
                    ].map((step, i) => (
                      <div key={i} className="flex items-center justify-between p-4 rounded-xl border border-border/50 hover:border-[#C9A450]/30 hover:bg-[#F5EDE0]/50 transition-colors cursor-pointer group">
                        <div>
                          <h4 className="font-semibold">{step.title}</h4>
                          <p className="text-sm text-muted-foreground mt-1">{step.desc}</p>
                        </div>
                        <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-[#C9A450] transition-colors" />
                      </div>
                    ))}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="email-setup" className="mt-0 outline-none">
                <div className="space-y-8">
                  <div>
                    <h2 className="text-2xl font-bold mb-4">Connecting Mailboxes</h2>
                    <p className="text-muted-foreground mb-6">Learn how inbound email creates tickets automatically in OmniCore.</p>
                  </div>
                  
                  <div className="prose dark:prose-invert max-w-none">
                    <h3>Forwarding your support email</h3>
                    <p>
                      To receive emails in OmniCore, you need to forward emails from your existing support address (e.g., support@yourcompany.com) to your OmniCore forwarding address.
                    </p>
                    <div className="bg-muted p-4 rounded-lg my-4 font-mono text-sm border">
                      your-brand@inbound.atelieromnicore.com
                    </div>
                    
                    <h3>Setup guides by provider</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6 not-prose">
                      <Card className="shadow-none border-border/50 hover:border-[#C9A450]/30 transition-colors cursor-pointer">
                        <CardHeader className="p-4 pb-2">
                          <CardTitle className="text-base">Google Workspace (G Suite)</CardTitle>
                        </CardHeader>
                        <CardContent className="p-4 pt-0">
                          <CardDescription>Configure forwarding in Gmail settings</CardDescription>
                        </CardContent>
                      </Card>
                      <Card className="shadow-none border-border/50 hover:border-[#C9A450]/30 transition-colors cursor-pointer">
                        <CardHeader className="p-4 pb-2">
                          <CardTitle className="text-base">Microsoft 365</CardTitle>
                        </CardHeader>
                        <CardContent className="p-4 pt-0">
                          <CardDescription>Setup Exchange mail flow rules</CardDescription>
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="bot-ai" className="mt-0 outline-none">
                <div className="space-y-8">
                  <div>
                    <h2 className="text-2xl font-bold mb-4">Enabling the AI Bot</h2>
                    <p className="text-muted-foreground mb-6">Configure your AI agent to deflect repetitive questions instantly.</p>
                  </div>
                  
                  <div className="grid gap-6">
                    <div className="p-6 rounded-2xl bg-gradient-to-br from-[#C9A450]/10 to-transparent border border-[#C9A450]/20">
                      <h3 className="font-bold text-lg text-[#8B6914] mb-2">Knowledge Base Tips</h3>
                      <p className="text-sm text-muted-foreground mb-4">
                        The AI Bot is only as good as the knowledge you feed it. Ensure your help articles are clear, up-to-date, and cover your most common support inquiries.
                      </p>
                      <ul className="list-disc list-inside text-sm space-y-2 text-foreground ml-4">
                        <li>Write descriptive titles for articles</li>
                        <li>Use bullet points for step-by-step instructions</li>
                        <li>Update articles when your product changes</li>
                      </ul>
                    </div>

                    <div className="grid gap-4">
                      {[
                        { title: "Configure Bot Persona", desc: "Set the bot's name, avatar, and tone of voice." },
                        { title: "Set Handoff Rules", desc: "Determine when the bot should escalate to a human agent." },
                        { title: "Review Bot Performance", desc: "Analyze deflection rates and improve knowledge gaps." },
                      ].map((step, i) => (
                        <div key={i} className="flex items-center justify-between p-4 rounded-xl border border-border/50 hover:border-[#C9A450]/30 hover:bg-[#F5EDE0]/50 transition-colors cursor-pointer group">
                          <div>
                            <h4 className="font-semibold">{step.title}</h4>
                            <p className="text-sm text-muted-foreground mt-1">{step.desc}</p>
                          </div>
                          <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-[#C9A450] transition-colors" />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </section>
    </div>
  );
}
