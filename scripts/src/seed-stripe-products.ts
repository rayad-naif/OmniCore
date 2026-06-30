import { getUncachableStripeClient } from "./stripeClient";

/**
 * Seeds Atelier OmniCore's self-serve plans in Stripe.
 *
 * Plans:
 *   Starter — $29/mo  (metadata.plan = "starter")
 *   Growth  — $79/mo  (metadata.plan = "growth")
 *
 * Enterprise stays as a "contact sales" flow — not seeded here.
 *
 * Idempotent: looks up products by metadata.plan before creating.
 * The managed webhook syncs the created products/prices into the `stripe`
 * Postgres schema automatically.
 *
 * Run: pnpm --filter @workspace/scripts run seed-stripe
 */

interface PlanSpec {
  plan: string;
  name: string;
  description: string;
  unitAmount: number;
  trialDays: number;
  metadata: Record<string, string>;
}

const PLANS: PlanSpec[] = [
  {
    plan: "starter",
    name: "OmniCore Starter",
    description:
      "For small teams getting started with omnichannel support. Includes live chat widget, email integration, and basic reporting.",
    unitAmount: 2900,
    trialDays: 14,
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
      "For scaling teams that need AI deflection and powerful automations. Includes unlimited agents, AI bot deflection, advanced reporting, and custom branding.",
    unitAmount: 7900,
    trialDays: 14,
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

async function seed() {
  const stripe = await getUncachableStripeClient();

  for (const spec of PLANS) {
    // Look up by plan slug in metadata (idempotent).
    const existing = await stripe.products.search({
      query: `metadata['plan']:'${spec.plan}' AND active:'true'`,
    });

    let productId: string;
    if (existing.data.length > 0) {
      productId = existing.data[0].id;
      console.log(`✓ ${spec.name} product already exists (${productId})`);

      // Keep metadata up to date.
      await stripe.products.update(productId, {
        name: spec.name,
        description: spec.description,
        metadata: spec.metadata,
      });
      console.log(`  ↺ Updated metadata for ${spec.name}`);
    } else {
      const product = await stripe.products.create({
        name: spec.name,
        description: spec.description,
        metadata: spec.metadata,
      });
      productId = product.id;
      console.log(`+ Created ${spec.name} product (${productId})`);
    }

    // Ensure an active monthly price with the expected amount exists.
    const prices = await stripe.prices.list({
      product: productId,
      active: true,
      limit: 100,
    });
    const hasPrice = prices.data.some(
      (p) =>
        p.unit_amount === spec.unitAmount &&
        p.currency === "usd" &&
        p.recurring?.interval === "month",
    );

    if (hasPrice) {
      console.log(
        `  ✓ Monthly price $${(spec.unitAmount / 100).toFixed(2)} already exists`,
      );
    } else {
      const price = await stripe.prices.create({
        product: productId,
        unit_amount: spec.unitAmount,
        currency: "usd",
        recurring: { interval: "month" },
        metadata: { plan: spec.plan },
      });
      console.log(
        `  + Created monthly price $${(spec.unitAmount / 100).toFixed(2)} (${price.id})`,
      );
    }
  }

  console.log(
    "\n✓ Stripe plans seeded. The managed webhook will sync them to Postgres.",
  );
  console.log("  Starter: $29.00/month | Growth: $79.00/month");
  console.log("  Both plans include a 14-day free trial.");
}

seed().catch((err) => {
  console.error("Error seeding Stripe products:", err?.message ?? err);
  process.exit(1);
});
