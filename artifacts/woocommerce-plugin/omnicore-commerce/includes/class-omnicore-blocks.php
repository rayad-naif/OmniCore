<?php
/**
 * Makes the OmniCore gateway available in the block-based Checkout.
 */

defined( 'ABSPATH' ) || exit;

use Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType;

final class OmniCore_Blocks_Payment extends AbstractPaymentMethodType {

	protected $name = 'omnicore';

	public function initialize() {
		$this->settings = get_option( 'woocommerce_omnicore_settings', array() );
	}

	public function is_active() {
		$enabled = isset( $this->settings['enabled'] ) ? $this->settings['enabled'] : 'yes';
		return 'yes' === $enabled && OmniCore_Commerce::connected();
	}

	public function get_payment_method_script_handles() {
		wp_register_script(
			'omnicore-commerce-blocks',
			plugins_url( 'assets/blocks.js', OMNICORE_COMMERCE_FILE ),
			array( 'wc-blocks-registry', 'wc-settings', 'wp-element', 'wp-html-entities' ),
			OMNICORE_COMMERCE_VERSION,
			true
		);
		return array( 'omnicore-commerce-blocks' );
	}

	public function get_payment_method_data() {
		return array(
			'title'       => isset( $this->settings['title'] ) ? $this->settings['title'] : 'Pay online',
			'description' => isset( $this->settings['description'] ) ? $this->settings['description'] : '',
			'supports'    => array( 'products' ),
		);
	}
}
