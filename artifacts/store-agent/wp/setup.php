<?php
/**
 * Runs inside a store through `wp eval-file` (WordPress and WooCommerce loaded).
 * Reads the JSON spec from $OC_SPEC and applies settings, design, pages, menus and
 * starter products. Idempotent: pages are matched by slug, categories by name, and
 * starter products are only created once. Prints one line "OMNICORE_RESULT:{json}".
 *
 * mode: "install" (new store: everything + REST API key for OmniCore)
 *       "design"  (theme colours, CSS and page content only)
 *       "settings" (OmniCore checkout on/off only)
 *       "content" (design + starter categories/products if none exist yet)
 */

$spec = json_decode( (string) file_get_contents( getenv( 'OC_SPEC' ) ), true );
if ( ! is_array( $spec ) ) {
	fwrite( STDERR, "Invalid spec\n" );
	exit( 1 );
}
$mode    = isset( $spec['mode'] ) ? $spec['mode'] : 'install';
$design  = isset( $spec['design'] ) && is_array( $spec['design'] ) ? $spec['design'] : array();
$catalog = isset( $spec['catalog'] ) && is_array( $spec['catalog'] ) ? $spec['catalog'] : array();
$summary = array();

function oc_text( $v, $max = 2000 ) {
	return mb_substr( wp_strip_all_tags( (string) $v ), 0, $max );
}

/** Renders structured content ([{type, text|items}]) as escaped block markup. */
function oc_blocks( $blocks ) {
	$out = '';
	foreach ( (array) $blocks as $b ) {
		$type = isset( $b['type'] ) ? $b['type'] : 'paragraph';
		if ( 'heading' === $type ) {
			$out .= '<!-- wp:heading --><h2 class="wp-block-heading">' . esc_html( oc_text( $b['text'] ?? '', 200 ) ) . "</h2><!-- /wp:heading -->\n\n";
		} elseif ( 'list' === $type ) {
			$items = '';
			foreach ( (array) ( $b['items'] ?? array() ) as $it ) {
				$items .= '<!-- wp:list-item --><li>' . esc_html( oc_text( $it, 500 ) ) . '</li><!-- /wp:list-item -->';
			}
			$out .= '<!-- wp:list --><ul class="wp-block-list">' . $items . "</ul><!-- /wp:list -->\n\n";
		} elseif ( 'shortcode' === $type ) {
			$code = (string) ( $b['text'] ?? '' );
			if ( preg_match( '/^\[(products|product_categories|woocommerce_[a-z_]+)( [^\]]*)?\]$/', $code ) ) {
				$out .= "<!-- wp:shortcode -->\n" . $code . "\n<!-- /wp:shortcode -->\n\n";
			}
		} else {
			$out .= '<!-- wp:paragraph --><p>' . esc_html( oc_text( $b['text'] ?? '' ) ) . "</p><!-- /wp:paragraph -->\n\n";
		}
	}
	return $out;
}

function oc_hero( $home, $color ) {
	$bg     = sanitize_hex_color( $color ) ? sanitize_hex_color( $color ) : '#111827';
	$url    = esc_url( isset( $home['button_url'] ) ? $home['button_url'] : '/shop/' );
	$button = esc_html( oc_text( $home['button_label'] ?? 'Shop now', 60 ) );
	return '<!-- wp:cover {"customOverlayColor":"' . $bg . '","dimRatio":100,"minHeight":380,"isDark":true,"align":"full"} -->'
		. '<div class="wp-block-cover alignfull is-dark" style="min-height:380px"><span aria-hidden="true" class="wp-block-cover__background has-background-dim-100 has-background-dim" style="background-color:' . $bg . '"></span><div class="wp-block-cover__inner-container">'
		. '<!-- wp:heading {"textAlign":"center","level":1} --><h1 class="wp-block-heading has-text-align-center">' . esc_html( oc_text( $home['heading'] ?? get_bloginfo( 'name' ), 160 ) ) . '</h1><!-- /wp:heading -->'
		. '<!-- wp:paragraph {"align":"center"} --><p class="has-text-align-center">' . esc_html( oc_text( $home['text'] ?? '', 400 ) ) . '</p><!-- /wp:paragraph -->'
		. '<!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"}} --><div class="wp-block-buttons"><!-- wp:button --><div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="' . $url . '">' . $button . '</a></div><!-- /wp:button --></div><!-- /wp:buttons -->'
		. "</div></div><!-- /wp:cover -->\n\n";
}

function oc_page( $slug, $title, $content ) {
	$slug = sanitize_title( $slug );
	$page = get_page_by_path( $slug, OBJECT, 'page' );
	$data = array(
		'post_type'    => 'page',
		'post_status'  => 'publish',
		'post_title'   => oc_text( $title, 160 ),
		'post_name'    => $slug,
		'post_content' => $content,
	);
	if ( $page ) {
		$data['ID'] = $page->ID;
		return wp_update_post( wp_slash( $data ) );
	}
	return wp_insert_post( wp_slash( $data ) );
}

/**
 * Starter product picture: an 800×800 PNG in the store's colours (GD), until the owner
 * uploads real photos. Returns the attachment id or 0.
 */
function oc_swatch( $name, $c1, $c2, $seed ) {
	if ( ! function_exists( 'imagecreatetruecolor' ) ) {
		return 0;
	}
	$hex = function ( $c, $fallback ) {
		$c = sanitize_hex_color( (string) $c );
		$c = $c ? ltrim( $c, '#' ) : $fallback;
		if ( 3 === strlen( $c ) ) {
			$c = $c[0] . $c[0] . $c[1] . $c[1] . $c[2] . $c[2];
		}
		return array( hexdec( substr( $c, 0, 2 ) ), hexdec( substr( $c, 2, 2 ) ), hexdec( substr( $c, 4, 2 ) ) );
	};
	$a    = $hex( $c1, '334155' );
	$b    = $hex( $c2, 'cbd5e1' );
	$size = 800;
	$img  = imagecreatetruecolor( $size, $size );
	$turn = ( $seed % 4 );
	for ( $y = 0; $y < $size; $y++ ) {
		for ( $x = 0; $x < $size; $x += 4 ) {
			$t   = ( 0 === $turn ? $x + $y : ( 1 === $turn ? $size - $x + $y : ( 2 === $turn ? $y * 2 : $x * 2 ) ) ) / ( 2 * $size );
			$col = imagecolorallocate( $img, (int) ( $a[0] + ( $b[0] - $a[0] ) * $t ), (int) ( $a[1] + ( $b[1] - $a[1] ) * $t ), (int) ( $a[2] + ( $b[2] - $a[2] ) * $t ) );
			imagefilledrectangle( $img, $x, $y, $x + 3, $y, $col );
		}
	}
	imagealphablending( $img, true );
	mt_srand( $seed * 7919 );
	for ( $i = 0; $i < 5; $i++ ) {
		$white = imagecolorallocatealpha( $img, 255, 255, 255, mt_rand( 96, 116 ) );
		$r     = mt_rand( 120, 360 );
		imagefilledellipse( $img, mt_rand( 0, $size ), mt_rand( 0, $size ), $r, $r, $white );
	}
	ob_start();
	imagepng( $img, null, 6 );
	$png = ob_get_clean();
	imagedestroy( $img );
	$file = wp_upload_bits( sanitize_title( $name ) . '-' . $seed . '.png', null, $png );
	if ( ! empty( $file['error'] ) ) {
		return 0;
	}
	require_once ABSPATH . 'wp-admin/includes/image.php';
	$id = wp_insert_attachment(
		array(
			'post_mime_type' => 'image/png',
			'post_title'     => oc_text( $name, 120 ),
			'post_status'    => 'inherit',
		),
		$file['file']
	);
	if ( is_wp_error( $id ) || ! $id ) {
		return 0;
	}
	wp_update_attachment_metadata( $id, wp_generate_attachment_metadata( $id, $file['file'] ) );
	return (int) $id;
}

// ── General and WooCommerce settings (install only) ──────────────────────────
if ( 'install' === $mode ) {
	update_option( 'blogname', oc_text( $spec['site_title'] ?? 'My store', 120 ) );
	update_option( 'blogdescription', oc_text( $spec['tagline'] ?? '', 200 ) );
	if ( ! empty( $spec['timezone'] ) && in_array( $spec['timezone'], timezone_identifiers_list(), true ) ) {
		update_option( 'timezone_string', $spec['timezone'] );
	}
	global $wp_rewrite;
	$wp_rewrite->set_permalink_structure( '/%postname%/' );

	$store = isset( $spec['store'] ) && is_array( $spec['store'] ) ? $spec['store'] : array();
	$cur   = strtoupper( preg_replace( '/[^A-Za-z]/', '', (string) ( $store['currency'] ?? 'USD' ) ) );
	update_option( 'woocommerce_currency', $cur ? $cur : 'USD' );
	if ( in_array( $cur, array( 'JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'XAF', 'XOF', 'PYG' ), true ) ) {
		update_option( 'woocommerce_price_num_decimals', 0 );
	}
	if ( ! empty( $store['country'] ) ) {
		update_option( 'woocommerce_default_country', strtoupper( preg_replace( '/[^A-Za-z:]/', '', $store['country'] ) ) );
	}
	foreach ( array( 'address' => 'woocommerce_store_address', 'city' => 'woocommerce_store_city', 'postcode' => 'woocommerce_store_postcode' ) as $k => $opt ) {
		if ( ! empty( $store[ $k ] ) ) {
			update_option( $opt, oc_text( $store[ $k ], 200 ) );
		}
	}
	if ( ! empty( $store['email'] ) && is_email( $store['email'] ) ) {
		update_option( 'woocommerce_email_from_address', sanitize_email( $store['email'] ) );
		update_option( 'woocommerce_email_from_name', oc_text( $spec['site_title'] ?? '', 120 ) );
	}
	update_option( 'woocommerce_onboarding_profile', array( 'skipped' => true ) );
	update_option( 'woocommerce_task_list_hidden', 'yes' );
	update_option( 'woocommerce_coming_soon', 'no' );
	update_option( 'woocommerce_store_pages_only', 'no' );
	update_option( 'woocommerce_allow_tracking', 'no' );
	update_option( 'woocommerce_show_marketplace_suggestions', 'no' );
	update_option( 'woocommerce_enable_guest_checkout', 'yes' );
	if ( class_exists( 'WC_Install' ) ) {
		WC_Install::create_pages();
	}
	// Without a shipping method WooCommerce refuses every order: start with free
	// shipping everywhere; the owner sets real rates under WooCommerce → Shipping.
	if ( class_exists( 'WC_Shipping_Zone' ) ) {
		$rest_of_world = new WC_Shipping_Zone( 0 );
		if ( ! $rest_of_world->get_shipping_methods() ) {
			$rest_of_world->add_shipping_method( 'free_shipping' );
		}
	}

	// Default sample content.
	$hello = get_post( 1 );
	if ( $hello && 'post' === $hello->post_type ) {
		wp_delete_post( 1, true );
	}
	$sample = get_page_by_path( 'sample-page' );
	if ( $sample ) {
		wp_delete_post( $sample->ID, true );
	}

	// OmniCore connection, checkout and single sign-on.
	$oc = isset( $spec['omnicore'] ) && is_array( $spec['omnicore'] ) ? $spec['omnicore'] : array();
	if ( ! empty( $oc['api_url'] ) && ! empty( $oc['store_id'] ) && ! empty( $oc['secret'] ) ) {
		update_option(
			'omnicore_commerce_connection',
			array(
				'api_url'  => esc_url_raw( rtrim( $oc['api_url'], '/' ) ),
				'store_id' => sanitize_text_field( $oc['store_id'] ),
				'secret'   => (string) $oc['secret'],
			),
			false
		);
		update_option( 'omnicore_commerce_hosted', 1 );
		update_option(
			'woocommerce_omnicore_settings',
			array(
				'enabled'     => ! empty( $oc['checkout_enabled'] ) ? 'yes' : 'no',
				'title'       => 'Pay online',
				'description' => 'Pay securely by card, PayPal, bank transfer or cash on delivery on the next page.',
			)
		);
	}
	if ( ! empty( $spec['admin_user'] ) ) {
		update_option( 'omnicore_commerce_admin_user', sanitize_user( $spec['admin_user'] ) );
	}
	$summary[] = 'settings';
}

if ( 'settings' === $mode && isset( $spec['omnicore'] ) ) {
	$gateway            = get_option( 'woocommerce_omnicore_settings', array() );
	$gateway            = is_array( $gateway ) ? $gateway : array();
	$gateway['enabled'] = ! empty( $spec['omnicore']['checkout_enabled'] ) ? 'yes' : 'no';
	update_option( 'woocommerce_omnicore_settings', $gateway );
	$summary[] = 'OmniCore checkout ' . ( 'yes' === $gateway['enabled'] ? 'on' : 'off' );
	$design    = array();
	$catalog   = array();
}

// ── Design: theme colours and CSS ────────────────────────────────────────────
if ( ! empty( $design['theme_mods'] ) && is_array( $design['theme_mods'] ) ) {
	foreach ( $design['theme_mods'] as $key => $value ) {
		if ( preg_match( '/^[a-z0-9_]+$/', (string) $key ) ) {
			$color = sanitize_hex_color( (string) $value );
			set_theme_mod( $key, $color ? $color : oc_text( $value, 200 ) );
		}
	}
	$summary[] = 'colours';
}
if ( isset( $design['home_sections'] ) && is_array( $design['home_sections'] ) ) {
	update_option( 'omnicore_commerce_home_sections', array_values( array_map( 'sanitize_key', $design['home_sections'] ) ) );
}
if ( isset( $design['custom_css'] ) ) {
	wp_update_custom_css_post( wp_strip_all_tags( (string) $design['custom_css'] ) );
}

// ── Starter catalog (install, or "content" when the store has no products) ───
$created_products = 0;
$has_samples      = (bool) get_posts(
	array(
		'post_type'      => 'product',
		'posts_per_page' => 1,
		'post_status'    => 'any',
		'fields'         => 'ids',
	)
);
if ( in_array( $mode, array( 'install', 'content' ), true ) && ! $has_samples && class_exists( 'WC_Product_Simple' ) ) {
	$cat_ids = array();
	$swatch  = isset( $design['swatch'] ) && is_array( $design['swatch'] ) ? array_values( $design['swatch'] ) + array( '#334155', '#cbd5e1' ) : array( '#334155', '#cbd5e1' );
	foreach ( (array) ( $catalog['categories'] ?? array() ) as $name ) {
		$name = oc_text( $name, 80 );
		if ( '' === $name ) {
			continue;
		}
		$term = term_exists( $name, 'product_cat' );
		if ( ! $term ) {
			$term = wp_insert_term( $name, 'product_cat' );
		}
		if ( ! is_wp_error( $term ) ) {
			$cat_ids[ $name ] = (int) ( is_array( $term ) ? $term['term_id'] : $term );
			$thumb            = oc_swatch( $name, $swatch[0], $swatch[1], count( $cat_ids ) + 40 );
			if ( $thumb ) {
				update_term_meta( $cat_ids[ $name ], 'thumbnail_id', $thumb );
			}
		}
	}
	foreach ( array_slice( (array) ( $catalog['products'] ?? array() ), 0, 24 ) as $i => $p ) {
		$product = new WC_Product_Simple();
		$product->set_name( oc_text( $p['name'] ?? 'Product', 120 ) );
		$product->set_status( 'publish' );
		$product->set_regular_price( wc_format_decimal( $p['price'] ?? '0' ) );
		if ( ! empty( $p['sale_price'] ) ) {
			$product->set_sale_price( wc_format_decimal( $p['sale_price'] ) );
		}
		$product->set_short_description( oc_text( $p['short_description'] ?? '', 400 ) );
		$product->set_description( wpautop( esc_html( oc_text( $p['description'] ?? '', 4000 ) ) ) );
		$cat = oc_text( $p['category'] ?? '', 80 );
		if ( $cat && isset( $cat_ids[ $cat ] ) ) {
			$product->set_category_ids( array( $cat_ids[ $cat ] ) );
		}
		$product->set_featured( $i < 4 );
		$product->set_stock_status( 'instock' );
		$product->update_meta_data( '_omnicore_starter', 1 );
		$image = oc_swatch( $product->get_name(), $swatch[ $i % 2 ], $swatch[ ( $i + 1 ) % 2 ], $i + 1 );
		if ( $image ) {
			$product->set_image_id( $image );
		}
		$product->save();
		$created_products++;
	}
	$summary[] = $created_products . ' products';
}

// ── Pages, homepage and menus ────────────────────────────────────────────────
if ( ! empty( $design['home'] ) || ! empty( $design['pages'] ) ) {
	$ids = array();
	if ( ! empty( $design['home'] ) ) {
		$home    = $design['home'];
		$content = oc_hero( $home, $design['theme_mods']['storefront_button_background_color'] ?? ( $home['background'] ?? '' ) );
		$content .= oc_blocks( $home['blocks'] ?? array() );
		$ids['home'] = oc_page( 'home', $home['title'] ?? 'Home', $content );
		if ( $ids['home'] && ! is_wp_error( $ids['home'] ) ) {
			update_post_meta( $ids['home'], '_wp_page_template', 'template-homepage.php' );
			update_option( 'show_on_front', 'page' );
			update_option( 'page_on_front', $ids['home'] );
		}
	}
	foreach ( (array) ( $design['pages'] ?? array() ) as $page ) {
		if ( empty( $page['slug'] ) ) {
			continue;
		}
		$id = oc_page( $page['slug'], $page['title'] ?? $page['slug'], oc_blocks( $page['blocks'] ?? array() ) );
		if ( $id && ! is_wp_error( $id ) ) {
			$ids[ sanitize_title( $page['slug'] ) ] = $id;
		}
	}
	if ( isset( $ids['privacy-policy'] ) ) {
		update_option( 'wp_page_for_privacy_policy', $ids['privacy-policy'] );
	}
	if ( isset( $ids['terms'] ) ) {
		update_option( 'woocommerce_terms_page_id', $ids['terms'] );
	}

	$wc_pages = array(
		'shop'       => function_exists( 'wc_get_page_id' ) ? wc_get_page_id( 'shop' ) : 0,
		'cart'       => function_exists( 'wc_get_page_id' ) ? wc_get_page_id( 'cart' ) : 0,
		'my-account' => function_exists( 'wc_get_page_id' ) ? wc_get_page_id( 'myaccount' ) : 0,
	);
	$menus = array(
		'primary'   => array( 'name' => 'Main menu', 'items' => $design['menu'] ?? array( 'home', 'shop', 'about', 'contact' ) ),
		'secondary' => array( 'name' => 'Footer menu', 'items' => $design['footer_menu'] ?? array() ),
	);
	$locations = get_theme_mod( 'nav_menu_locations', array() );
	foreach ( $menus as $location => $menu ) {
		if ( empty( $menu['items'] ) ) {
			continue;
		}
		$existing = wp_get_nav_menu_object( $menu['name'] );
		if ( $existing ) {
			wp_delete_nav_menu( $existing->term_id );
		}
		$menu_id = wp_create_nav_menu( $menu['name'] );
		if ( is_wp_error( $menu_id ) ) {
			continue;
		}
		foreach ( $menu['items'] as $slug ) {
			$pid = $ids[ $slug ] ?? ( $wc_pages[ $slug ] ?? 0 );
			if ( ! $pid ) {
				$p   = get_page_by_path( $slug );
				$pid = $p ? $p->ID : 0;
			}
			if ( $pid > 0 ) {
				wp_update_nav_menu_item(
					$menu_id,
					0,
					array(
						'menu-item-object-id' => $pid,
						'menu-item-object'    => 'page',
						'menu-item-type'      => 'post_type',
						'menu-item-status'    => 'publish',
					)
				);
			}
		}
		$locations[ $location ] = $menu_id;
		if ( 'primary' === $location ) {
			$locations['handheld'] = $menu_id;
		}
	}
	set_theme_mod( 'nav_menu_locations', $locations );
	$summary[] = count( $ids ) . ' pages';
}

// ── REST API key for OmniCore order/customer sync (install only) ─────────────
$result = array(
	'summary'    => implode( ', ', $summary ),
	'wp_version' => get_bloginfo( 'version' ),
	'wc_version' => defined( 'WC_VERSION' ) ? WC_VERSION : null,
	'products'   => $created_products,
);
if ( 'install' === $mode && function_exists( 'wc_rand_hash' ) ) {
	global $wpdb;
	$user = get_user_by( 'login', $spec['admin_user'] ?? '' );
	if ( $user ) {
		$wpdb->delete( $wpdb->prefix . 'woocommerce_api_keys', array( 'description' => 'OmniCore sync' ) );
		$consumer_key    = 'ck_' . wc_rand_hash();
		$consumer_secret = 'cs_' . wc_rand_hash();
		$wpdb->insert(
			$wpdb->prefix . 'woocommerce_api_keys',
			array(
				'user_id'         => $user->ID,
				'description'     => 'OmniCore sync',
				'permissions'     => 'read_write',
				'consumer_key'    => wc_api_hash( $consumer_key ),
				'consumer_secret' => $consumer_secret,
				'truncated_key'   => substr( $consumer_key, -7 ),
			),
			array( '%d', '%s', '%s', '%s', '%s', '%s' )
		);
		$result['wc_consumer_key']    = $consumer_key;
		$result['wc_consumer_secret'] = $consumer_secret;
	}
}
flush_rewrite_rules( false );
echo 'OMNICORE_RESULT:' . wp_json_encode( $result ) . "\n";
