<?php
/**
 * Plugin Name:       OmniCore Commerce
 * Description:       Connects this WooCommerce store to OmniCore: OmniCore checkout (Paddle, Stripe, PayPal, Square, Authorize.net, bank transfer, cash on delivery, Payoneer), payment updates and one-click sign-in from the OmniCore dashboard.
 * Version:           1.0.0
 * Requires at least: 6.4
 * Requires PHP:      7.4
 * Requires Plugins:  woocommerce
 * Author:            OmniCore
 * License:           GPL-2.0-or-later
 * Text Domain:       omnicore-commerce
 *
 * WC requires at least: 8.0
 */

defined( 'ABSPATH' ) || exit;

define( 'OMNICORE_COMMERCE_VERSION', '1.0.0' );
define( 'OMNICORE_COMMERCE_FILE', __FILE__ );
define( 'OMNICORE_COMMERCE_DIR', plugin_dir_path( __FILE__ ) );

require_once OMNICORE_COMMERCE_DIR . 'includes/class-omnicore-client.php';

/**
 * Plugin bootstrap: settings page, REST callbacks, single sign-on and the payment gateway.
 */
final class OmniCore_Commerce {

	const OPTION = 'omnicore_commerce_connection';

	public static function init() {
		add_action( 'before_woocommerce_init', array( __CLASS__, 'declare_compatibility' ) );
		add_action( 'plugins_loaded', array( __CLASS__, 'load_gateway' ), 20 );
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
		add_action( 'init', array( __CLASS__, 'maybe_sso' ), 1 );
		add_action( 'admin_menu', array( __CLASS__, 'admin_menu' ) );
		add_action( 'admin_post_omnicore_commerce_save', array( __CLASS__, 'save_settings' ) );
		add_filter( 'http_request_host_is_external', array( __CLASS__, 'allow_omnicore_host' ), 10, 2 );
		add_filter( 'http_allowed_safe_ports', array( __CLASS__, 'allow_omnicore_port' ), 10, 3 );
		add_filter( 'plugin_action_links_' . plugin_basename( __FILE__ ), array( __CLASS__, 'action_links' ) );
		if ( get_option( 'omnicore_commerce_hosted' ) ) {
			// Stores hosted by the platform are white-label: no theme credit link in the footer.
			add_filter( 'storefront_credit_link', '__return_false' );
			// OmniCore is the only webhook consumer of a hosted store: deliver order updates at once.
			add_filter( 'woocommerce_webhook_deliver_async', '__return_false' );
		}
		add_action( 'wp', array( __CLASS__, 'homepage_sections' ) );
	}

	/** Keeps only the Storefront homepage sections chosen by the store's template. */
	public static function homepage_sections() {
		$keep = get_option( 'omnicore_commerce_home_sections' );
		if ( ! is_array( $keep ) ) {
			return;
		}
		$sections = array(
			'categories'   => array( 'storefront_product_categories', 20 ),
			'recent'       => array( 'storefront_recent_products', 30 ),
			'featured'     => array( 'storefront_featured_products', 40 ),
			'popular'      => array( 'storefront_popular_products', 50 ),
			'on_sale'      => array( 'storefront_on_sale_products', 60 ),
			'best_selling' => array( 'storefront_best_selling_products', 70 ),
			'brands'       => array( 'storefront_woocommerce_brands_homepage_section', 80 ),
		);
		foreach ( $sections as $key => $hook ) {
			if ( ! in_array( $key, $keep, true ) ) {
				remove_action( 'homepage', $hook[0], $hook[1] );
			}
		}
	}

	/** The connection (OmniCore URL, store id and secret), or null when not connected. */
	public static function connection() {
		$c = get_option( self::OPTION );
		if ( ! is_array( $c ) || empty( $c['api_url'] ) || empty( $c['store_id'] ) || empty( $c['secret'] ) ) {
			return null;
		}
		return $c;
	}

	public static function connected() {
		return null !== self::connection();
	}

	/**
	 * Parses a connection key copied from the OmniCore dashboard:
	 * "ocs1." + base64url(JSON {u: OmniCore URL, s: store id, k: secret}).
	 */
	public static function parse_key( $key ) {
		$key = trim( (string) $key );
		if ( 0 !== strpos( $key, 'ocs1.' ) ) {
			return null;
		}
		$json = base64_decode( strtr( substr( $key, 5 ), '-_', '+/' ), true );
		$data = $json ? json_decode( $json, true ) : null;
		if ( ! is_array( $data ) || empty( $data['u'] ) || empty( $data['s'] ) || empty( $data['k'] ) ) {
			return null;
		}
		$url = esc_url_raw( rtrim( $data['u'], '/' ) );
		if ( ! $url || ! preg_match( '#^https?://#', $url ) ) {
			return null;
		}
		return array(
			'api_url'  => $url,
			'store_id' => sanitize_text_field( $data['s'] ),
			'secret'   => (string) $data['k'],
		);
	}

	public static function declare_compatibility() {
		if ( class_exists( '\Automattic\WooCommerce\Utilities\FeaturesUtil' ) ) {
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', __FILE__, true );
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'cart_checkout_blocks', __FILE__, true );
		}
	}

	public static function load_gateway() {
		if ( ! class_exists( 'WC_Payment_Gateway' ) ) {
			return;
		}
		require_once OMNICORE_COMMERCE_DIR . 'includes/class-wc-gateway-omnicore.php';
		add_filter(
			'woocommerce_payment_gateways',
			function ( $gateways ) {
				$gateways[] = 'WC_Gateway_OmniCore';
				return $gateways;
			}
		);
		add_action(
			'woocommerce_blocks_payment_method_type_registration',
			function ( $registry ) {
				require_once OMNICORE_COMMERCE_DIR . 'includes/class-omnicore-blocks.php';
				$registry->register( new OmniCore_Blocks_Payment() );
			}
		);
	}

	/** WooCommerce webhooks may be delivered to OmniCore even when it resolves to a private address. */
	public static function allow_omnicore_host( $external, $host ) {
		$c = self::connection();
		if ( $c && strtolower( (string) wp_parse_url( $c['api_url'], PHP_URL_HOST ) ) === strtolower( (string) $host ) ) {
			return true;
		}
		return $external;
	}

	/** WordPress only allows ports 80, 443 and 8080 for webhooks: also allow OmniCore's own port. */
	public static function allow_omnicore_port( $ports, $host = '', $url = '' ) {
		$c = self::connection();
		if ( $c && strtolower( (string) wp_parse_url( $c['api_url'], PHP_URL_HOST ) ) === strtolower( (string) $host ) ) {
			$port = (int) wp_parse_url( $c['api_url'], PHP_URL_PORT );
			if ( $port && ! in_array( $port, (array) $ports, true ) ) {
				$ports[] = $port;
			}
		}
		return $ports;
	}

	// ── REST: payment updates from OmniCore ─────────────────────────────────

	public static function register_routes() {
		register_rest_route(
			'omnicore/v1',
			'/payment',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'payment_callback' ),
				'permission_callback' => '__return_true',
			)
		);
		register_rest_route(
			'omnicore/v1',
			'/status',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'status_callback' ),
				'permission_callback' => '__return_true',
			)
		);
	}

	/** Verifies X-OmniCore-Timestamp / X-OmniCore-Signature against the raw body. */
	private static function verify_request( WP_REST_Request $request ) {
		$c = self::connection();
		if ( ! $c ) {
			return new WP_Error( 'omnicore_not_connected', 'This store is not connected to OmniCore.', array( 'status' => 409 ) );
		}
		$ok = OmniCore_Client::verify(
			$c['secret'],
			(string) $request->get_header( 'x_omnicore_timestamp' ),
			(string) $request->get_body(),
			(string) $request->get_header( 'x_omnicore_signature' )
		);
		if ( ! $ok ) {
			return new WP_Error( 'omnicore_bad_signature', 'Invalid signature.', array( 'status' => 401 ) );
		}
		return true;
	}

	public static function status_callback( WP_REST_Request $request ) {
		$ok = self::verify_request( $request );
		if ( is_wp_error( $ok ) ) {
			return $ok;
		}
		$gateway = get_option( 'woocommerce_omnicore_settings', array() );
		return array(
			'ok'               => true,
			'plugin_version'   => OMNICORE_COMMERCE_VERSION,
			'wc_version'       => defined( 'WC_VERSION' ) ? WC_VERSION : null,
			'checkout_enabled' => isset( $gateway['enabled'] ) && 'yes' === $gateway['enabled'],
			'currency'         => function_exists( 'get_woocommerce_currency' ) ? get_woocommerce_currency() : null,
		);
	}

	public static function payment_callback( WP_REST_Request $request ) {
		$ok = self::verify_request( $request );
		if ( is_wp_error( $ok ) ) {
			return $ok;
		}
		$p     = json_decode( $request->get_body(), true );
		$order = is_array( $p ) && ! empty( $p['order_id'] ) ? wc_get_order( absint( $p['order_id'] ) ) : null;
		if ( ! $order || ! hash_equals( (string) $order->get_order_key(), (string) ( $p['order_key'] ?? '' ) ) ) {
			return new WP_Error( 'omnicore_unknown_order', 'Unknown order.', array( 'status' => 404 ) );
		}
		$event   = (string) ( $p['event'] ?? '' );
		$method  = sanitize_text_field( (string) ( $p['method_label'] ?? $p['method'] ?? 'OmniCore' ) );
		$tx      = sanitize_text_field( (string) ( $p['transaction_id'] ?? '' ) );
		$amount  = (string) ( $p['amount'] ?? '' );
		$cur     = strtoupper( (string) ( $p['currency'] ?? '' ) );

		if ( 'paid' === $event ) {
			if ( $cur !== strtoupper( $order->get_currency() ) || abs( (float) $amount - (float) $order->get_total() ) > 0.009 ) {
				$order->update_status( 'on-hold', sprintf( 'OmniCore reported a payment of %s %s that does not match the order total; please check it.', $amount, $cur ) );
				return array( 'ok' => true, 'status' => $order->get_status(), 'mismatch' => true );
			}
			if ( ! $order->is_paid() ) {
				$order->add_order_note( sprintf( 'Paid through OmniCore (%s). Transaction %s.', $method, $tx ) );
				$order->payment_complete( $tx );
			}
		} elseif ( 'pending' === $event ) {
			if ( ! $order->is_paid() ) {
				$order->update_status( 'on-hold', sprintf( 'Awaiting %s; the shop confirms it in OmniCore.', $method ) );
			}
		} elseif ( 'failed' === $event ) {
			if ( ! $order->is_paid() ) {
				$order->update_status( 'failed', sprintf( '%s payment was rejected in OmniCore.', $method ) );
			}
		} elseif ( 'refunded' === $event ) {
			$order->update_status( 'refunded', sprintf( 'Payment %s was marked refunded in OmniCore.', $tx ) );
		} else {
			return new WP_Error( 'omnicore_bad_event', 'Unknown event.', array( 'status' => 400 ) );
		}
		return array( 'ok' => true, 'status' => $order->get_status() );
	}

	// ── Single sign-on from the OmniCore dashboard ──────────────────────────

	public static function maybe_sso() {
		if ( empty( $_GET['omnicore_sso'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			return;
		}
		$c     = self::connection();
		$token = sanitize_text_field( wp_unslash( $_GET['omnicore_sso'] ) ); // phpcs:ignore WordPress.Security.NonceVerification
		$parts = explode( '.', $token );
		if ( ! $c || 2 !== count( $parts ) ) {
			wp_die( 'This sign-in link is not valid.', 'Sign-in', array( 'response' => 403 ) );
		}
		list( $payload, $sig ) = $parts;
		$expected = hash_hmac( 'sha256', 'sso.' . $payload, $c['secret'] );
		$data     = json_decode( (string) base64_decode( strtr( $payload, '-_', '+/' ), true ), true );
		if ( ! hash_equals( $expected, $sig ) || ! is_array( $data ) || empty( $data['e'] ) || (int) $data['e'] < time() || empty( $data['n'] ) ) {
			wp_die( 'This sign-in link is not valid or has expired. Open the store again from OmniCore.', 'Sign-in', array( 'response' => 403 ) );
		}
		$nonce_key = 'omnicore_sso_' . md5( (string) $data['n'] );
		if ( get_transient( $nonce_key ) ) {
			wp_die( 'This sign-in link was already used. Open the store again from OmniCore.', 'Sign-in', array( 'response' => 403 ) );
		}
		set_transient( $nonce_key, 1, 15 * MINUTE_IN_SECONDS );

		$user = ! empty( $data['m'] ) ? get_user_by( 'email', sanitize_email( $data['m'] ) ) : false;
		if ( ! $user || ! user_can( $user, 'manage_woocommerce' ) ) {
			$fallback = get_option( 'omnicore_commerce_admin_user' );
			$user     = $fallback ? get_user_by( 'login', $fallback ) : false;
		}
		if ( ! $user || ! user_can( $user, 'manage_woocommerce' ) ) {
			wp_die( 'No store manager account matches your OmniCore login. Ask the store owner to add you in WordPress.', 'Sign-in', array( 'response' => 403 ) );
		}
		wp_set_current_user( $user->ID );
		wp_set_auth_cookie( $user->ID, false, is_ssl() );
		$to = ! empty( $data['r'] ) ? admin_url( ltrim( (string) $data['r'], '/' ) ) : admin_url( 'admin.php?page=wc-admin' );
		wp_safe_redirect( $to );
		exit;
	}

	// ── Settings page (WooCommerce → OmniCore) ──────────────────────────────

	public static function admin_menu() {
		add_submenu_page( 'woocommerce', 'OmniCore', 'OmniCore', 'manage_woocommerce', 'omnicore-commerce', array( __CLASS__, 'render_settings' ) );
	}

	public static function action_links( $links ) {
		array_unshift( $links, '<a href="' . esc_url( admin_url( 'admin.php?page=omnicore-commerce' ) ) . '">Settings</a>' );
		return $links;
	}

	public static function render_settings() {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}
		$c       = self::connection();
		$message = isset( $_GET['omnicore_msg'] ) ? sanitize_text_field( wp_unslash( $_GET['omnicore_msg'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
		echo '<div class="wrap"><h1>OmniCore</h1>';
		if ( $message ) {
			echo '<div class="notice notice-info"><p>' . esc_html( $message ) . '</p></div>';
		}
		if ( $c ) {
			echo '<p>Connected to <strong>' . esc_html( $c['api_url'] ) . '</strong> (store ' . esc_html( $c['store_id'] ) . ').</p>';
			echo '<p>Turn the OmniCore checkout on or off under <a href="' . esc_url( admin_url( 'admin.php?page=wc-settings&tab=checkout&section=omnicore' ) ) . '">WooCommerce → Settings → Payments → OmniCore</a>. Other WooCommerce payment plugins keep working next to it.</p>';
		} else {
			echo '<p>Paste the connection key from OmniCore (Online Stores → your store → Payments).</p>';
		}
		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
		wp_nonce_field( 'omnicore_commerce_save' );
		echo '<input type="hidden" name="action" value="omnicore_commerce_save" />';
		echo '<p><label for="omnicore_key"><strong>Connection key</strong></label><br/><input type="password" class="large-text" id="omnicore_key" name="omnicore_key" autocomplete="off" placeholder="ocs1.…" /></p>';
		submit_button( $c ? 'Replace connection' : 'Connect' );
		if ( $c ) {
			echo '<p><label><input type="checkbox" name="omnicore_disconnect" value="1" /> Disconnect from OmniCore</label></p>';
		}
		echo '</form></div>';
	}

	public static function save_settings() {
		if ( ! current_user_can( 'manage_woocommerce' ) || ! check_admin_referer( 'omnicore_commerce_save' ) ) {
			wp_die( 'Not allowed.' );
		}
		$msg = 'Nothing changed.';
		if ( ! empty( $_POST['omnicore_disconnect'] ) ) {
			delete_option( self::OPTION );
			$msg = 'Disconnected from OmniCore.';
		} elseif ( ! empty( $_POST['omnicore_key'] ) ) {
			$parsed = self::parse_key( sanitize_text_field( wp_unslash( $_POST['omnicore_key'] ) ) );
			if ( ! $parsed ) {
				$msg = 'That connection key is not valid.';
			} else {
				update_option( self::OPTION, $parsed, false );
				$check = OmniCore_Client::request( 'POST', '/api/stores/plugin/hello', array( 'site_url' => home_url(), 'plugin_version' => OMNICORE_COMMERCE_VERSION ) );
				$msg   = is_wp_error( $check ) ? 'Saved, but OmniCore could not be reached: ' . $check->get_error_message() : 'Connected to OmniCore.';
			}
		}
		wp_safe_redirect( add_query_arg( 'omnicore_msg', rawurlencode( $msg ), admin_url( 'admin.php?page=omnicore-commerce' ) ) );
		exit;
	}
}

OmniCore_Commerce::init();
