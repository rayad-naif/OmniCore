import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ArrowRight, Bot, MessageSquare, Zap, Users, Inbox, ShieldCheck } from "lucide-react";
import heroImg from "@/assets/hero.png";
import feature1Img from "@/assets/feature-1.png";
import feature2Img from "@/assets/feature-2.png";
import abstractImg1 from "@assets/Gemini_Generated_Image_xqx9m7xqx9m7xqx9_1782734752504.png";
import abstractImg2 from "@assets/Gemini_Generated_Image_ljfznyljfznyljfz_1782734752504.png";
import coreBenefitsImg from "@assets/Gemini_Generated_Image_o33hxo33hxo33hxo_1782739956431.png";
import coreFeaturesImg from "@assets/Gemini_Generated_Image_a3fmgsa3fmgsa3fm_1782739956432.png";

export default function Home() {
  return (
    <div className="flex flex-col w-full overflow-hidden">
      {/* Hero Section */}
      <section className="relative pt-24 pb-32 md:pt-32 md:pb-40 overflow-hidden bg-[#F5EDE0] text-foreground">
        {/* Abstract Background Elements */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 flex items-center justify-center pointer-events-none">
          <div className="absolute w-96 h-96 bg-[#C9A450]/15 blur-[150px] rounded-full mix-blend-multiply" />
        </div>
        
        <div className="container mx-auto px-4 md:px-8 relative z-10">
          <div className="max-w-4xl mx-auto text-center flex flex-col items-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#C9A450]/30 text-[#C9A450] text-xs uppercase tracking-widest font-semibold mb-8"
            >
              <span>SUPPORT DESK SOFTWARE</span>
            </motion.div>
            
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="font-serif text-5xl md:text-7xl font-bold tracking-tight text-balance leading-tight mb-6"
            >
              Support software your team <span className="text-[#C9A450]">actually wants to use</span>.
            </motion.h1>
            
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="text-lg md:text-xl text-muted-foreground max-w-2xl mb-10 text-balance"
            >
              Atelier OmniCore is a premium multi-tenant SaaS platform that unifies all your conversations with an AI-powered helpdesk. Precision engineered for modern businesses.
            </motion.p>
            
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="flex flex-col sm:flex-row gap-4"
            >
              <a href="/dashboard/">
                <Button size="lg" className="h-12 px-8 text-base font-medium rounded-full w-full sm:w-auto bg-[#C9A450] hover:bg-[#B8963E] text-white shadow-lg shadow-[#C9A450]/20">
                  Start for free <ArrowRight className="ml-2 w-4 h-4" />
                </Button>
              </a>
              <Button asChild size="lg" variant="outline" className="h-12 px-8 text-base font-medium rounded-full bg-transparent border-[#C9A450]/50 text-foreground hover:bg-[#C9A450]/10 w-full sm:w-auto">
                <a href="/contact">Book a Demo</a>
              </Button>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Hero Image / App Preview Reveal */}
      <section className="relative -mt-16 md:-mt-24 z-20 container mx-auto px-4 md:px-8 pb-20">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="rounded-xl overflow-hidden border border-border/50 shadow-2xl bg-background"
        >
          <img 
            src={heroImg} 
            alt="OmniCore Dashboard Interface" 
            className="w-full h-auto object-cover border-b"
          />
        </motion.div>
      </section>

      {/* Value Props / Logos Grid */}
      <section className="py-16 md:py-24 bg-[#F5EDE0]">
        <div className="container mx-auto px-4 md:px-8">
          <div className="text-center mb-16">
            <h2 className="font-serif text-3xl md:text-4xl font-bold tracking-tight mb-4">Precision-engineered for scale</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">Everything you need to deliver exceptional support experiences, without the bloated legacy interfaces.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <motion.div 
              whileHover={{ y: -5 }}
              className="p-8 rounded-2xl bg-card border border-border/50 shadow-sm transition-all duration-300 hover:shadow-md"
            >
              <div className="w-12 h-12 rounded-lg bg-[#C9A450]/15 flex items-center justify-center mb-6 text-[#C9A450]">
                <Bot className="w-6 h-6" />
              </div>
              <h3 className="font-serif text-xl font-semibold mb-3">AI-Powered Routing</h3>
              <p className="text-muted-foreground leading-relaxed">
                Our intelligent agent automatically categorizes, tags, and routes incoming conversations to the right human instantly.
              </p>
            </motion.div>

            <motion.div 
              whileHover={{ y: -5 }}
              className="p-8 rounded-2xl bg-card border border-border/50 shadow-sm transition-all duration-300 hover:shadow-md"
            >
              <div className="w-12 h-12 rounded-lg bg-[#C9A450]/15 flex items-center justify-center mb-6 text-[#C9A450]">
                <Inbox className="w-6 h-6" />
              </div>
              <h3 className="font-serif text-xl font-semibold mb-3">Omnichannel Inbox</h3>
              <p className="text-muted-foreground leading-relaxed">
                Email, chat, and social channels unified in one beautiful, lightning-fast interface that agents love.
              </p>
            </motion.div>

            <motion.div 
              whileHover={{ y: -5 }}
              className="p-8 rounded-2xl bg-card border border-border/50 shadow-sm transition-all duration-300 hover:shadow-md"
            >
              <div className="w-12 h-12 rounded-lg bg-[#C9A450]/15 flex items-center justify-center mb-6 text-[#C9A450]">
                <Users className="w-6 h-6" />
              </div>
              <h3 className="font-serif text-xl font-semibold mb-3">Multi-Tenant Core</h3>
              <p className="text-muted-foreground leading-relaxed">
                Built from the ground up for agencies and enterprises managing multiple brands from a single login.
              </p>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Feature 1: Omnichannel */}
      <section className="py-24 bg-[#EDE0C8]/40 overflow-hidden">
        <div className="container mx-auto px-4 md:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#C9A450]/15 text-[#C9A450] text-sm font-medium mb-6">
                <MessageSquare className="w-4 h-4" />
                <span>Unified Communications</span>
              </div>
              <h2 className="font-serif text-4xl md:text-5xl font-bold tracking-tight mb-6 leading-tight">
                One view.<br />Every conversation.
              </h2>
              <p className="text-lg text-muted-foreground mb-8 text-balance">
                Stop switching tabs. OmniCore brings your live chat widgets, support emails, and social messages into a single, high-performance workspace. Designed for speed, built for clarity.
              </p>
              
              <ul className="space-y-4 mb-8">
                {['Real-time chat widget synchronization', 'Automated email threading and parsing', 'Collision detection to prevent duplicate replies'].map((item, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-[#C9A450]/20 flex items-center justify-center text-[#C9A450]">
                      <ShieldCheck className="w-3 h-3" />
                    </div>
                    <span className="text-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
            
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="relative"
            >
              <div className="aspect-[4/3] rounded-2xl overflow-hidden border shadow-xl">
                <img src={feature1Img} alt="Omnichannel routing" className="w-full h-full object-cover" />
              </div>
              
              {/* Floating decorative elements */}
              <div className="absolute -bottom-6 -left-6 w-32 h-32 bg-background border shadow-lg rounded-xl p-4 flex flex-col justify-between hidden md:flex">
                <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 mb-2">
                  <Zap className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground font-medium">Response Time</div>
                  <div className="text-xl font-bold">1m 24s</div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Brand Image Showcase */}
      <section className="py-24 bg-[#F5EDE0]">
        <div className="container mx-auto px-4 md:px-8">
          <div className="text-center mb-12">
            <h2 className="font-serif text-3xl font-bold text-[#C9A450]">Core Benefits — Unlock Operational Excellence</h2>
          </div>
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="rounded-3xl overflow-hidden shadow-2xl border border-border/50 max-w-5xl mx-auto"
          >
            <img src={coreBenefitsImg} alt="Core Benefits" className="w-full h-auto" />
          </motion.div>
        </div>
      </section>

      {/* Feature 2: AI */}
      <section className="py-24 bg-[#F5EDE0]">
        <div className="container mx-auto px-4 md:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="order-2 lg:order-1 relative"
            >
              <div className="aspect-[4/3] rounded-2xl overflow-hidden border shadow-xl">
                <img src={feature2Img} alt="AI Bot Data Analysis" className="w-full h-full object-cover" />
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="order-1 lg:order-2"
            >
               <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#C9A450]/15 text-[#C9A450] text-sm font-medium mb-6">
                <Bot className="w-4 h-4" />
                <span>AI-Native Architecture</span>
              </div>
              <h2 className="font-serif text-4xl md:text-5xl font-bold tracking-tight mb-6 leading-tight">
                Your sharpest agent<br />never sleeps.
              </h2>
              <p className="text-lg text-muted-foreground mb-8 text-balance">
                The OmniCore bot doesn't just block deflect tickets — it resolves them. Trained on your knowledge base, it provides accurate, context-aware answers in seconds, handing off to humans only when necessary.
              </p>
              
              <ul className="space-y-4">
                {['Automatic intent classification', 'Drafts suggested replies for human agents', 'Learns continuously from past resolutions'].map((item, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-[#C9A450]/20 flex items-center justify-center text-[#C9A450]">
                      <ShieldCheck className="w-3 h-3" />
                    </div>
                    <span className="text-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Dark Core Features Card Showcase */}
      <section className="py-24 bg-[#EDE0C8]/30">
        <div className="container mx-auto px-4 md:px-8">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="rounded-3xl overflow-hidden shadow-2xl p-4 md:p-8 bg-card border border-border/50 max-w-4xl mx-auto"
          >
            <img src={coreFeaturesImg} alt="Core Features" className="w-full h-auto rounded-xl" />
          </motion.div>
        </div>
      </section>

      {/* Abstract Divider / Quote */}
      <section className="relative py-32 overflow-hidden bg-gradient-to-br from-[#8B6914] to-[#C9A450] text-white">
        <div className="absolute inset-0 opacity-15 mix-blend-overlay">
          <img src={abstractImg1} alt="Abstract Background" className="w-full h-full object-cover" />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-[#8B6914] to-transparent opacity-40" />
        
        <div className="container mx-auto px-4 relative z-10 text-center max-w-4xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-3xl md:text-5xl font-serif italic mb-8 leading-tight">
              "We replaced three different tools with OmniCore. Our team is faster, and our customers are happier. It's the most elegant piece of B2B software we own."
            </h2>
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 rounded-full overflow-hidden mb-4 border-2 border-white/20">
                <img src={abstractImg2} alt="Avatar" className="w-full h-full object-cover" />
              </div>
              <div className="font-medium text-lg">Sarah Jenkins</div>
              <div className="text-white/80 text-sm">VP of Customer Success, TechFlow</div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 md:py-32 bg-[#F5EDE0]">
        <div className="container mx-auto px-4 md:px-8">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="max-w-4xl mx-auto bg-[#C9A450] text-white rounded-3xl p-10 md:p-16 text-center relative overflow-hidden shadow-2xl"
          >
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/20 rounded-full blur-[80px]" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-black/10 rounded-full blur-[80px]" />
            
            <h2 className="font-serif text-4xl md:text-5xl font-bold tracking-tight mb-6 relative z-10">Ready to elevate your support?</h2>
            <p className="text-lg md:text-xl text-white/90 mb-10 max-w-2xl mx-auto relative z-10 text-balance">
              Join thousands of modern teams delivering exceptional customer experiences with Atelier OmniCore.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-4 relative z-10">
              <a href="/dashboard/">
                <Button size="lg" className="h-14 px-8 text-base font-semibold rounded-full w-full sm:w-auto bg-white text-[#1A1001] hover:bg-white/90">
                  Start your free trial
                </Button>
              </a>
              <Button asChild size="lg" variant="outline" className="h-14 px-8 text-base font-semibold rounded-full bg-transparent border-white/30 text-white hover:bg-white/10 w-full sm:w-auto">
                <a href="/contact">Contact Sales</a>
              </Button>
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
