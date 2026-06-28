import { getUncachableStripeClient } from "./stripeClient";

/**
 * Seeds Atelier OmniCore's self-serve plans in Stripe.
 *
 * Plans:
 *   - Starter — $29/mo  (metadata.plan = "starter")
 *   - Pro     — $99/mo  (metadata.plan = "pro")
 *
 * Enterprise is intentionally NOT seeded — it stays a "request upgrade" flow.
 *
 * Idempotent: looks up products by metadata.plan before creating.
 * The managed webhook syncs the created products/prices into the `stripe`
 * Postgres schema automatically.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/seed-stripe-products.ts
 */

interface PlanSpec {
  plan: string;
  name: string;
  description: string;
  unitAmount: number; // cents
}

const PLANS: PlanSpec[] = [
  {
    plan: "starter",
    name: "Starter",
    description: "For small teams getting started with omnichannel support.",
    unitAmount: 2900,
  },
  {
    plan: "pro",
    name: "Pro",
    description: "For growing teams that need advanced automation and AI.",
    unitAmount: 9900,
  },
];

async function seed() {
  const stripe = await getUncachableStripeClient();

  for (const spec of PLANS) {
    const existing = await stripe.products.search({
      query: `metadata['plan']:'${spec.plan}' AND active:'true'`,
    });

    let productId: string;
    if (existing.data.length > 0) {
      productId = existing.data[0].id;
      console.log(`✓ ${spec.name} product already exists (${productId})`);
    } else {
      const product = await stripe.products.create({
        name: spec.name,
        description: spec.description,
        metadata: { plan: spec.plan },
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
      console.log(`  ✓ Monthly price $${spec.unitAmount / 100} already exists`);
    } else {
      const price = await stripe.prices.create({
        product: productId,
        unit_amount: spec.unitAmount,
        currency: "usd",
        recurring: { interval: "month" },
        metadata: { plan: spec.plan },
      });
      console.log(`  + Created monthly price $${spec.unitAmount / 100} (${price.id})`);
    }
  }

  console.log("\n✓ Stripe plans seeded. The managed webhook will sync them to Postgres.");
}

seed().catch((err) => {
  console.error("Error seeding Stripe products:", err?.message ?? err);
  process.exit(1);
});
