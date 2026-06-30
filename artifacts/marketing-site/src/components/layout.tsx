import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import irAtelierLogo from "@assets/WhatsApp_Image_2026-06-29_at_2.10.14_AM_1782740652894.jpeg";

export function Layout({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [location] = useLocation();

  const navLinks = [
    { href: "/", label: "Home" },
    { href: "/pricing", label: "Pricing" },
    { href: "/help", label: "Help" },
    { href: "/contact", label: "Contact" },
  ];

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background selection:bg-primary selection:text-primary-foreground font-sans">
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-[#F5EDE0]/95 backdrop-blur supports-[backdrop-filter]:bg-[#F5EDE0]/60">
        <div className="container mx-auto px-4 md:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href="/" className="flex items-center gap-2 transition-opacity hover:opacity-90">
              <span className="font-bold text-xl tracking-tight font-serif"><span className="text-foreground">Omni</span><span style={{color:'#C9A450'}}>Core</span></span>
            </Link>
          </div>
          
          <nav className="hidden md:flex items-center gap-6">
            {navLinks.map((link) => (
              <Link 
                key={link.href} 
                href={link.href}
                className={`text-sm font-medium transition-colors hover:text-[#C9A450] ${
                  location === link.href ? "text-[#C9A450]" : "text-foreground/70"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          
          <div className="hidden md:flex items-center gap-4">
            <a href="/dashboard/">
              <Button className="bg-[#C9A450] hover:bg-[#B8963E] text-white font-semibold border-none shadow-sm hover:shadow-md transition-all">Login to Dashboard</Button>
            </a>
          </div>

          <div className="md:hidden">
            <Sheet open={isOpen} onOpenChange={setIsOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden">
                  <Menu className="h-5 w-5" />
                  <span className="sr-only">Toggle Menu</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[300px] sm:w-[400px]">
                <nav className="flex flex-col gap-4 mt-8">
                  {navLinks.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={() => setIsOpen(false)}
                      className={`text-lg font-medium transition-colors hover:text-[#C9A450] ${
                        location === link.href ? "text-[#C9A450]" : "text-foreground/70"
                      }`}
                    >
                      {link.label}
                    </Link>
                  ))}
                  <div className="mt-4 pt-4 border-t">
                    <a href="/dashboard/" onClick={() => setIsOpen(false)}>
                      <Button className="w-full bg-[#C9A450] hover:bg-[#B8963E] text-white font-semibold border-none">Login to Dashboard</Button>
                    </a>
                  </div>
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full">
        {children}
      </main>

      <footer className="border-t bg-[#EDE0C8]/50 py-12 md:py-16">
        <div className="container mx-auto px-4 md:px-8 grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="md:col-span-2 flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <span className="font-bold text-2xl tracking-tight font-serif"><span className="text-foreground">Omni</span><span style={{color:'#C9A450'}}>Core</span></span>
              <span className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">Support Desk Software</span>
            </div>
            <p className="text-muted-foreground text-sm max-w-sm text-balance mt-2">
              The premium multi-tenant SaaS platform giving businesses an AI-powered omnichannel helpdesk they actually want to use.
            </p>
          </div>
          <div>
            <h3 className="font-medium mb-4">Product</h3>
            <ul className="flex flex-col gap-3 text-sm text-muted-foreground">
              <li><Link href="/" className="hover:text-primary transition-colors">Features</Link></li>
              <li><Link href="/pricing" className="hover:text-primary transition-colors">Pricing</Link></li>
              <li><Link href="/help" className="hover:text-primary transition-colors">Documentation</Link></li>
              <li><Link href="/contact" className="hover:text-primary transition-colors">Contact</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="font-medium mb-4">Legal</h3>
            <ul className="flex flex-col gap-3 text-sm text-muted-foreground">
              <li><Link href="/privacy" className="hover:text-primary transition-colors">Privacy Policy</Link></li>
              <li><Link href="/terms" className="hover:text-primary transition-colors">Terms of Service</Link></li>
              <li><Link href="/refunds" className="hover:text-primary transition-colors">Refund Policy</Link></li>
            </ul>
          </div>
        </div>
        <div className="container mx-auto px-4 md:px-8 mt-12 pt-8 border-t text-sm text-muted-foreground text-center md:text-left flex flex-col md:flex-row justify-between items-center gap-4">
          <p>© {new Date().getFullYear()} Atelier OmniCore. All rights reserved.</p>
          <div className="flex items-center gap-3">
            <span className="text-xs uppercase tracking-widest">A Production of</span>
            <img
              src={irAtelierLogo}
              alt="IR Atelier — Idylle Radieuse"
              className="h-10 w-10 object-contain rounded-sm"
            />
            <span className="font-serif text-sm" style={{ color: '#C9A450' }}>IR Atelier</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
