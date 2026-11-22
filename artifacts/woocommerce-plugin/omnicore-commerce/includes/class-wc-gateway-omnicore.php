<?php
/**
 * "Pay online" through OmniCore: the customer is sent to the OmniCore payment page,
 * which offers the processors the shop connected in OmniCore. OmniCore reports the
 * result back to /wp-json/omnicore/v1/payment.
 */

defined( 'ABSPATH' ) || exit;

class WC_Gateway_OmniCore extends WC_Payment_Gateway {

	public function __construct() {
		$this->id                 = 'omnicore';
		$this->method_title       = 'OmniCore';
		$this->method_description = 'Customers pay on your OmniCore payment page with the methods you connected in OmniCore (card processors, PayPal, bank transfer, cash on delivery, Payoneer).';
		$this->has_fields         = false;
		$this->supports           = array( 'products' );

		$this->init_form_fields();
		$this->init_settings();
		$this->title       = $this->get_option( 'title' );
		$this->description = $this->get_option( 'description' );
		$this->enabled     = $this->get_option( 'enabled' );

		add_action( 'woocommerce_update_options_payment_gateways_' . $this->id, array( $this, 'process_admin_options' ) );
	}

	public function init_form_fields() {
		$this->form_fields = array(
			'enabled'     => array(
				'title'   => 'Enable',
				'type'    => 'checkbox',
				'label'   => 'Offer OmniCore checkout',
				'default' => 'yes',
			),
			'title'       => array(
				'title'   => 'Title',
				'type'    => 'text',
				'default' => 'Pay online',
			),
			'description' => array(
				'title'   => 'Description',
				'type'    => 'textarea',
				'default' => 'Pay securely by card, PayPal, bank transfer or cash on delivery on the next page.',
			),
		);
	}

	public function is_available() {
		return parent::is_available() && OmniCore_Commerce::connected();
	}

	private static function money( $amount ) {
		return wc_format_decimal( $amount, wc_get_price_decimals() );
	}

	public function process_payment( $order_id ) {
		$order = wc_get_order( $order_id );
		if ( ! $order ) {
			wc_add_notice( 'Order not found.', 'error' );
			return array( 'result' => 'failure' );
		}

		$items = array();
		foreach ( $order->get_items() as $item ) {
			$items[] = array(
				'name'     => $item->get_name(),
				'quantity' => (int) $item->get_quantity(),
				'total'    => self::money( $item->get_subtotal() ),
			);
		}
		foreach ( $order->get_fees() as $fee ) {
			$items[] = array(
				'name'     => $fee->get_name(),
				'quantity' => 1,
				'total'    => self::money( $fee->get_total() ),
			);
		}

		$res = OmniCore_Client::request(
			'POST',
			'/api/stores/plugin/checkout',
			array(
				'order_id'       => $order->get_id(),
				'order_key'      => $order->get_order_key(),
				'number'         => $order->get_order_number(),
				'currency'       => $order->get_currency(),
				'total'          => self::money( $order->get_total() ),
				'shipping_total' => self::money( (float) $order->get_shipping_total() ),
				'tax_total'      => self::money( (float) $order->get_total_tax() ),
				'discount_total' => self::money( (float) $order->get_discount_total() ),
				'items'          => $items,
				'customer'       => array(
					'name'    => trim( $order->get_billing_first_name() . ' ' . $order->get_billing_last_name() ),
					'email'   => $order->get_billing_email(),
					'phone'   => $order->get_billing_phone(),
					'address' => wp_strip_all_tags( $order->get_formatted_billing_address() ),
				),
				'return_url'     => $this->get_return_url( $order ),
				'cancel_url'     => $order->get_cancel_order_url_raw(),
			)
		);

		if ( is_wp_error( $res ) || empty( $res['pay_url'] ) ) {
			$msg = is_wp_error( $res ) ? $res->get_error_message() : 'OmniCore did not return a payment page.';
			$order->add_order_note( 'OmniCore checkout could not start: ' . $msg );
			wc_add_notice( 'We could not start the payment. Please try again or choose another method.', 'error' );
			return array( 'result' => 'failure' );
		}

		$order->update_status( 'pending', 'Customer sent to the OmniCore payment page.' );
		$order->update_meta_data( '_omnicore_invoice', sanitize_text_field( (string) ( $res['invoice_id'] ?? '' ) ) );
		$order->save();

		return array(
			'result'   => 'success',
			'redirect' => esc_url_raw( $res['pay_url'] ),
		);
	}
}
