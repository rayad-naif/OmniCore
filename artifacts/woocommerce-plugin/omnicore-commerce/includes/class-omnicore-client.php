<?php
/**
 * Signed requests between this store and OmniCore.
 *
 * Both directions send X-OmniCore-Store, X-OmniCore-Timestamp and
 * X-OmniCore-Signature = hex(HMAC-SHA256(secret, timestamp + "." + body)).
 */

defined( 'ABSPATH' ) || exit;

final class OmniCore_Client {

	const MAX_SKEW = 300;

	public static function sign( $secret, $timestamp, $body ) {
		return hash_hmac( 'sha256', $timestamp . '.' . $body, $secret );
	}

	public static function verify( $secret, $timestamp, $body, $signature ) {
		if ( '' === $timestamp || '' === $signature || ! ctype_digit( $timestamp ) ) {
			return false;
		}
		if ( abs( time() - (int) $timestamp ) > self::MAX_SKEW ) {
			return false;
		}
		return hash_equals( self::sign( $secret, $timestamp, $body ), strtolower( $signature ) );
	}

	/**
	 * Calls OmniCore. Returns the decoded JSON body or WP_Error.
	 */
	public static function request( $method, $path, $payload = null ) {
		$c = OmniCore_Commerce::connection();
		if ( ! $c ) {
			return new WP_Error( 'omnicore_not_connected', 'This store is not connected to OmniCore.' );
		}
		$body = null === $payload ? '' : wp_json_encode( $payload );
		$ts   = (string) time();
		$res  = wp_remote_request(
			$c['api_url'] . $path,
			array(
				'method'  => $method,
				'timeout' => 20,
				'headers' => array(
					'Content-Type'         => 'application/json',
					'Accept'               => 'application/json',
					'X-OmniCore-Store'     => $c['store_id'],
					'X-OmniCore-Timestamp' => $ts,
					'X-OmniCore-Signature' => self::sign( $c['secret'], $ts, $body ),
				),
				'body'    => '' === $body ? null : $body,
			)
		);
		if ( is_wp_error( $res ) ) {
			return $res;
		}
		$code = (int) wp_remote_retrieve_response_code( $res );
		$data = json_decode( (string) wp_remote_retrieve_body( $res ), true );
		if ( $code < 200 || $code >= 300 ) {
			$err = is_array( $data ) && ! empty( $data['error'] ) ? $data['error'] : 'OmniCore returned HTTP ' . $code;
			return new WP_Error( 'omnicore_http_' . $code, $err );
		}
		return is_array( $data ) ? $data : array();
	}
}
