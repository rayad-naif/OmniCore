/**
 * seed-paddle-products.ts
 * Creates OmniCore's self-serve products and prices in Paddle Billing.
 *
 * Plans created:
 *   Starter  — $29/month  (14-day trial baked into the Price)
 *   Growth   — $79/month  (14-day trial baked into the Price)
 *
 * IMPORTANT: After running, copy the printed Price IDs into your environment
 * secrets as:
 *   PADDLE_STARTER_PRICE_ID=pri_xxx
 *   PADDLE_GROWTH_PRICE_ID=pri_xxx
 *
 * Idempotent: checks for existing products by custom_data.plan before creating.
 *
 * Required env vars:
 *   PADDLE_API_KEY          — from Paddle dashboard → Developer → Authentication
 *   PADDLE_ENVIRONMENT      — 'sandbox' (default) | 'production'
 *
 * Run: pnpm --filter @workspace/scripts run seed-paddle
 */

const TRIAL_DAYS = 14;

interface PlanSpec {
  plan: string;
  name: string;
  description: string;
  unitAmountCents: number;
  metadata: Record<string, string>;
}

const PLANS: PlanSpec[] = [
  {
    plan: "starter",
    name: "OmniCore Starter",
    description:
      "For small teams getting started with omnichannel support. Includes live chat widget, email integration, and basic reporting. 14-day free trial included.",
    unitAmountCents: 2900,
    metadata: {
      plan: "starter",
      self_serve: "true",
      max_brands_allowed: "1",
      max_agents_allowed: "3",
      conversation_limit: "500",
      ai_feature_enabled: "false",
      smtp_feature_enabled: "false",
    },
  },
  {
    plan: "growth",
    name: "OmniCore Growth",
    description:
      "For scaling teams with AI deflection and powerful automations. Unlimited agents, AI bot deflection, advanced reporting, and custom branding. 14-day free trial included.",
    unitAmountCents: 7900,
    metadata: {
      plan: "growth",
      self_serve: "true",
      max_brands_allowed: "10",
      max_agents_allowed: "999",
      conversation_limit: "10000",
      ai_feature_enabled: "true",
      smtp_feature_enabled: "true",
    },
  },
];

function getApiKey(): string {
  const key = process.env.PADDLE_API_KEY;
  if (!key) {
    throw new Error(
      "PADDLE_API_KEY is not set.\n" +
        "Add it as an environment secret from: Paddle dashboard → Developer → Authentication.",
    );
  }
  return key;
}

function baseUrl(): string {
  return process.env.PADDLE_ENVIRONMENT === "production"
    ? "https://api.paddle.com"
    : "https://sandbox-api.paddle.com";
}

async function paddlePost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json()) as { data?: unknown; error?: { detail?: string } };
  if (!res.ok) {
    const detail = json?.error?.detail ?? `Paddle API error ${res.status}`;
    throw new Error(detail);
  }
  return json.data;
}

async function paddleGet(path: string): Promise<unknown[]> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json()) as {
    data?: unknown[];
    error?: { detail?: string };
  };
  if (!res.ok) {
    const detail = json?.error?.detail ?? `Paddle API error ${res.status}`;
    throw new Error(detail);
  }
  return json.data ?? [];
}

async function seed() {
  const env = process.env.PADDLE_ENVIRONMENT === "production" ? "production" : "sandbox";
  console.log(`\nSeeding Paddle Billing products — environment: ${env}\n`);

  const priceIds: Record<string, string> = {};

  for (const spec of PLANS) {
    // Paddle doesn't have product search by custom_data via REST, so list and filter.
    const products = (await paddleGet("/products?per_page=200")) as Array<{
      id: string;
      name: string;
      custom_data?: Record<string, string>;
      status?: string;
    }>;

    const existing = products.find(
      (p) => p.custom_data?.plan === spec.plan && p.status === "active",
    );

    let productId: string;
    if (existing) {
      productId = existing.id;
      console.log(`✓ ${spec.name} product already exists (${productId})`);
    } else {
      const product = (await paddlePost("/products", {
        name: spec.name,
        description: spec.description,
        tax_category: "saas",
        custom_data: spec.metadata,
      })) as { id: string };
      productId = product.id;
      console.log(`+ Created ${spec.name} product (${productId})`);
    }

    // Check for an existing monthly price with the right amount on this product.
    const prices = (await paddleGet(
      `/prices?product_id=${productId}&per_page=200`,
    )) as Array<{
      id: string;
      unit_price?: { amount?: string };
      billing_cycle?: { interval?: string; frequency?: number };
      trial_period?: unknown;
      status?: string;
    }>;

    const hasPrice = prices.some(
      (p) =>
        p.status === "active" &&
        p.unit_price?.amount === String(spec.unitAmountCents) &&
        p.billing_cycle?.interval === "month",
    );

    if (hasPrice) {
      const match = prices.find(
        (p) =>
          p.status === "active" &&
          p.unit_price?.amount === String(spec.unitAmountCents) &&
          p.billing_cycle?.interval === "month",
      )!;
      priceIds[spec.plan] = match.id;
      console.log(
        `  ✓ Monthly price $${(spec.unitAmountCents / 100).toFixed(2)} already exists (${match.id})`,
      );
    } else {
      const price = (await paddlePost("/prices", {
        product_id: productId,
        description: `OmniCore ${spec.plan.charAt(0).toUpperCase() + spec.plan.slice(1)} — Monthly`,
        unit_price: {
          amount: String(spec.unitAmountCents),
          currency_code: "USD",
        },
        billing_cycle: { interval: "month", frequency: 1 },
        // 14-day free trial — baked into the Price so it applies at every checkout
        trial_period: { interval: "day", frequency: TRIAL_DAYS },
        tax_mode: "account_setting",
        custom_data: { plan: spec.plan },
      })) as { id: string };
      priceIds[spec.plan] = price.id;
      console.log(
        `  + Created monthly price $${(spec.unitAmountCents / 100).toFixed(2)} with ${TRIAL_DAYS}-day trial (${price.id})`,
      );
    }
  }

  console.log("\n✓ Paddle products seeded successfully!\n");
  console.log(
    "Add these price IDs as environment secrets (Replit → Secrets):\n",
  );
  for (const [plan, priceId] of Object.entries(priceIds)) {
    console.log(
      `  PADDLE_${plan.toUpperCase()}_PRICE_ID=${priceId}`,
    );
  }
  console.log(
    "\nAlso set BILLING_PROVIDER=paddle to route new checkouts through Paddle.",
  );
  console.log(
    "Set PADDLE_WEBHOOK_SECRET from Paddle dashboard → Developer → Notifications.\n",
  );
}

seed().catch((err: Error) => {
  console.error("\nError seeding Paddle products:", err.message);
  process.exit(1);
});
