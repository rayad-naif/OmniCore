import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import { applyMeta, metaForPath } from "@/lib/seo";
import Home from "@/pages/home";
import Pricing from "@/pages/pricing";
import Contact from "@/pages/contact";
import Help from "@/pages/help";
import Terms from "@/pages/terms";
import Privacy from "@/pages/privacy";
import Refunds from "@/pages/refunds";
import Checkout from "@/pages/checkout";
import CheckoutSuccess from "@/pages/checkout-success";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function Seo() {
  const [location] = useLocation();
  useEffect(() => {
    applyMeta(metaForPath(location));
  }, [location]);
  return null;
}

function Router() {
  return (
    <Layout>
      <Seo />
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/pricing" component={Pricing} />
        <Route path="/contact" component={Contact} />
        <Route path="/help" component={Help} />
        <Route path="/terms" component={Terms} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/refunds" component={Refunds} />
        <Route path="/checkout" component={Checkout} />
        <Route path="/checkout/success" component={CheckoutSuccess} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App({ ssrPath }: { ssrPath?: string }) {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter
          base={import.meta.env.BASE_URL.replace(/\/$/, "")}
          ssrPath={ssrPath}
        >
          <Router />
        </WouterRouter>
        {typeof document !== "undefined" && <Toaster />}
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
