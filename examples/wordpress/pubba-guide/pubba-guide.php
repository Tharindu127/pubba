<?php
/**
 * Plugin Name:       pubba guide
 * Description:       Related items with reasons under each page, "what next" from the visitor's trail, and an Ask guide, from a pubba bundle.
 * Version:           0.8.0
 * Requires PHP:      8.1
 * Requires at least: 6.4
 * License:           MIT
 * Text Domain:       pubba-guide
 */

use Pubba\CookieTrailStorage;
use Pubba\Entity;
use Pubba\Pubba;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// The pubba runtime: from Composer (`composer require tharindu127/pubba`), or a copy of
// packages/php from the pubba repository in lib/pubba.
if ( is_file( __DIR__ . '/vendor/autoload.php' ) ) {
	require_once __DIR__ . '/vendor/autoload.php';
} else {
	require_once __DIR__ . '/lib/pubba/autoload.php';
}
require_once __DIR__ . '/includes/class-pubba-guide-site.php';

/** The site, built once per request. The bundle path can be changed with the `pubba_guide_bundle` filter. */
function pubba_guide_site(): ?Pubba_Guide_Site {
	static $site = false;
	if ( false === $site ) {
		$file = apply_filters( 'pubba_guide_bundle', __DIR__ . '/pubba.bundle.json' );
		$json = is_readable( $file ) ? file_get_contents( $file ) : false;
		$site = false === $json ? null : new Pubba_Guide_Site( Pubba::load( $json ), new CookieTrailStorage( secure: is_ssl() ) );
	}
	return $site;
}

/** The entity the current page shows (matched by url path; change with the `pubba_guide_entity` filter). */
function pubba_guide_current(): ?Entity {
	static $entity = false;
	if ( false === $entity ) {
		$site   = pubba_guide_site();
		$path   = (string) wp_parse_url( home_url( add_query_arg( array() ) ), PHP_URL_PATH );
		$home   = (string) wp_parse_url( home_url(), PHP_URL_PATH );
		$path   = substr( $path, strlen( rtrim( $home, '/' ) ) );
		$entity = apply_filters( 'pubba_guide_entity', null === $site ? null : $site->entity_for_path( $path ), $path );
	}
	return $entity;
}

// Record the page view before any output, since the trail lives in a cookie.
add_action(
	'template_redirect',
	static function (): void {
		$site   = pubba_guide_site();
		$entity = pubba_guide_current();
		if ( null !== $site && null !== $entity ) {
			$via = isset( $_GET['pubba_via'] ) ? sanitize_key( wp_unslash( $_GET['pubba_via'] ) ) : null; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only.
			$site->record( $entity, $via );
		}
	}
);

// "Related" with reasons under the page, rendered on the server (works without JavaScript).
add_filter(
	'the_content',
	static function ( string $content ): string {
		$site   = pubba_guide_site();
		$entity = pubba_guide_current();
		if ( null === $site || null === $entity || ! in_the_loop() || ! is_main_query() ) {
			return $content;
		}
		return $content . Pubba_Guide_Site::list_html( __( 'Related', 'pubba-guide' ), $site->related( $entity ), 'esc_html' );
	}
);

// [pubba_next]: what this visitor is likely to want next.
add_shortcode(
	'pubba_next',
	static function ( $atts ): string {
		$site = pubba_guide_site();
		$atts = shortcode_atts( array( 'title' => __( 'You might like next', 'pubba-guide' ), 'limit' => 3 ), $atts );
		return null === $site ? '' : Pubba_Guide_Site::list_html( $atts['title'], $site->next( (int) $atts['limit'] ), 'esc_html' );
	}
);

// The guide's endpoint: POST /wp-json/pubba/v1/ask {"q": "..."}. Read-only, so public.
add_action(
	'rest_api_init',
	static function (): void {
		register_rest_route(
			'pubba/v1',
			'/ask',
			array(
				'methods'             => 'POST',
				'permission_callback' => '__return_true',
				'args'                => array( 'q' => array( 'type' => 'string', 'default' => '' ) ),
				'callback'            => static function ( WP_REST_Request $request ) {
					$site = pubba_guide_site();
					if ( null === $site ) {
						return new WP_Error( 'pubba_no_bundle', 'No pubba bundle.', array( 'status' => 503 ) );
					}
					$response = rest_ensure_response( $site->ask( (string) $request->get_param( 'q' ) ) );
					$response->header( 'Cache-Control', 'no-store' );
					return $response;
				},
			)
		);
	}
);

add_action(
	'wp_enqueue_scripts',
	static function (): void {
		$site = pubba_guide_site();
		if ( null === $site ) {
			return;
		}
		$entity = pubba_guide_current();
		$own    = ! isset( $_GET['pubba_via'] ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only.
		wp_enqueue_style( 'pubba-guide', plugins_url( 'assets/guide.css', __FILE__ ), array(), '0.8.0' );
		wp_enqueue_script( 'pubba-guide', plugins_url( 'assets/guide.js', __FILE__ ), array(), '0.8.0', array( 'in_footer' => true ) );
		wp_localize_script(
			'pubba-guide',
			'pubbaGuide',
			array(
				'endpoint'   => rest_url( 'pubba/v1/ask' ),
				'nudge'      => null === $entity ? null : $site->nudge_for( $entity, $own ),
				'nudgeGapMs' => $site->guide()->nudgePolicy->gapMs,
			)
		);
	}
);
