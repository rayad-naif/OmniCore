import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Mail, MapPin, Phone } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function Contact() {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const form = e.target as HTMLFormElement;
    const firstName = (form.elements.namedItem("firstName") as HTMLInputElement).value;
    const lastName = (form.elements.namedItem("lastName") as HTMLInputElement).value;
    const email = (form.elements.namedItem("email") as HTMLInputElement).value;
    const company = (form.elements.namedItem("company") as HTMLInputElement).value;
    const message = (form.elements.namedItem("message") as HTMLTextAreaElement).value;

    const subject = encodeURIComponent(`OmniCore Enquiry from ${firstName} ${lastName}${company ? ` (${company})` : ""}`);
    const body = encodeURIComponent(
      `Name: ${firstName} ${lastName}\nEmail: ${email}${company ? `\nCompany: ${company}` : ""}\n\n${message}`
    );
    const mailto = `mailto:atelier@irofficial.com,idylle_radieuse@outlook.com?subject=${subject}&body=${body}`;

    window.location.href = mailto;

    setTimeout(() => {
      setIsSubmitting(false);
      toast.success("Opening your email client…", {
        description: "Your message is pre-filled and ready to send.",
      });
      form.reset();
    }, 600);
  };

  return (
    <div className="flex flex-col w-full min-h-screen bg-background pt-16">
      <section className="py-20 md:py-32 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-[50%] h-[50%] bg-[#C9A450]/5 blur-[100px] rounded-full pointer-events-none" />
        
        <div className="container mx-auto px-4 md:px-8 relative z-10">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <motion.h1 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-4xl md:text-6xl font-bold tracking-tight mb-6 font-serif"
            >
              Get in touch
            </motion.h1>
            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-lg text-muted-foreground text-balance"
            >
              Whether you're looking for a demo, need help with billing, or just have a question about our API, our team is ready to help.
            </motion.p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-12 max-w-6xl mx-auto">
            {/* Contact Info */}
            <motion.div 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="lg:col-span-2 flex flex-col gap-8"
            >
              <div className="bg-card border border-border/50 p-8 rounded-3xl shadow-sm">
                <h3 className="font-semibold text-xl mb-6">Contact Information</h3>
                
                <div className="flex flex-col gap-6">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-[#C9A450]/10 flex items-center justify-center text-[#C9A450] flex-shrink-0">
                      <Mail className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-medium text-sm mb-1">General Enquiries</h4>
                      <a href="mailto:atelier@irofficial.com" className="text-muted-foreground hover:text-[#C9A450] transition-colors block">atelier@irofficial.com</a>
                      <a href="mailto:idylle_radieuse@outlook.com" className="text-muted-foreground hover:text-[#C9A450] transition-colors block mt-1">idylle_radieuse@outlook.com</a>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-[#C9A450]/10 flex items-center justify-center text-[#C9A450] flex-shrink-0">
                      <MapPin className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-medium text-sm mb-1">Office</h4>
                      <p className="text-muted-foreground">100 Innovation Drive<br />San Francisco, CA 94103</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-[#C9A450] text-white p-8 rounded-3xl shadow-lg relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-white/20 rounded-full blur-[40px]" />
                <h3 className="font-bold text-xl mb-3 relative z-10 font-serif">Enterprise Support</h3>
                <p className="text-white/90 mb-6 relative z-10 text-sm">
                  Existing enterprise customers have access to priority 24/7 phone support and a dedicated Slack channel.
                </p>
                <a href="/dashboard/" className="text-sm font-semibold underline underline-offset-4 hover:text-white relative z-10">
                  Login to view your dedicated PIN
                </a>
              </div>
            </motion.div>

            {/* Contact Form */}
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 }}
              className="lg:col-span-3 bg-card border border-border/50 p-8 md:p-10 rounded-3xl shadow-sm"
            >
              <form onSubmit={handleSubmit} className="flex flex-col gap-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="firstName">First name</Label>
                    <Input id="firstName" placeholder="Jane" required className="bg-background" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName">Last name</Label>
                    <Input id="lastName" placeholder="Smith" required className="bg-background" />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="email">Work email</Label>
                  <Input id="email" type="email" placeholder="jane@company.com" required className="bg-background" />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="company">Company name</Label>
                  <Input id="company" placeholder="Acme Inc." className="bg-background" />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="message">How can we help?</Label>
                  <Textarea 
                    id="message" 
                    placeholder="Tell us about your support setup and what you're looking for..." 
                    className="min-h-[150px] bg-background resize-none focus-visible:ring-[#C9A450]" 
                    required 
                  />
                </div>
                
                <Button 
                  type="submit" 
                  size="lg" 
                  className="w-full sm:w-auto self-start mt-2 rounded-full px-8 bg-[#C9A450] hover:bg-[#B8963E] text-white"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Sending..." : "Send Message"}
                </Button>
              </form>
            </motion.div>
          </div>
        </div>
      </section>
    </div>
  );
}
