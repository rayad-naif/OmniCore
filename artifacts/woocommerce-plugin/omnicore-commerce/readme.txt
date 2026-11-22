=== OmniCore Commerce ===
Requires at least: 6.4
Tested up to: 6.8
Requires PHP: 7.4
WC requires at least: 8.0
License: GPLv2 or later

Connects a WooCommerce store to OmniCore.

== Description ==

* OmniCore checkout: customers pay on your OmniCore payment page with the methods you
  connected in OmniCore (Paddle, Stripe, PayPal, Square, Authorize.net, bank transfer,
  cash on delivery, Payoneer). Works with the classic and the block Checkout. Other
  WooCommerce payment plugins keep working next to it.
* Orders are updated when OmniCore receives the payment (paid, awaiting confirmation,
  rejected, refunded).
* One-click sign-in to this store's admin from the OmniCore dashboard.

Orders and customers are synced to OmniCore through the WooCommerce REST API and
webhooks; that part does not need this plugin.

== Installation ==

1. Upload the plugin and activate it (stores hosted by OmniCore have it already).
2. WooCommerce → OmniCore: paste the connection key from OmniCore
   (Online Stores → your store → Payments).
3. WooCommerce → Settings → Payments: turn on "OmniCore".
