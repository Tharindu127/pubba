<?php
/**
 * Everything the plugin does, with no WordPress calls, so the same code runs
 * in WordPress (pubba-guide.php) and in the plain PHP demo (../demo).
 */

use Pubba\Entity;
use Pubba\EntityChip;
use Pubba\Guide;
use Pubba\GuideChip;
use Pubba\NudgePolicy;
use Pubba\Pubba;
use Pubba\QuestionChip;
use Pubba\Reply;
use Pubba\Trail;
use Pubba\TrailStorage;

final class Pubba_Guide_Site {

	/** How a visitor reached a page, from the `pubba_via` query parameter. */
	public const VIAS = array( 'suggestion', 'chip', 'typed', 'match', 'related' );

	private Trail $trail;

	public function __construct( public readonly Pubba $pubba, TrailStorage $storage ) {
		$this->trail = new Trail( storage: $storage );
	}

	/** The site path of an entity (its url's path), or null when it has no page. */
	public function path( Entity $e ): ?string {
		if ( null === $e->url ) {
			return null;
		}
		$path = parse_url( $e->url, PHP_URL_PATH );
		return '/' . trim( is_string( $path ) ? $path : '', '/' );
	}

	/** The entity a request path shows, if any. */
	public function entity_for_path( string $path ): ?Entity {
		$path = '/' . trim( $path, '/' );
		foreach ( $this->pubba->graph->entities as $e ) {
			if ( $this->path( $e ) === $path && '/' !== $path ) {
				return $e;
			}
		}
		return null;
	}

	/** People are the site's owner, not a place to send visitors. */
	public function accepts( Entity $e ): bool {
		return 'person' !== $e->type;
	}

	/** The guide only sends visitors to places that have a page. */
	public function offers( Entity $e ): bool {
		return $this->accepts( $e ) && null !== $this->path( $e );
	}

	/** A fresh guide over this visitor's trail; `$now` lets a nudge be worked out ahead of time. */
	public function guide( ?callable $now = null ): Guide {
		return new Guide(
			$this->pubba,
			trail: $this->trail,
			route: fn ( Entity $e ) => $this->path( $e ),
			accept: fn ( Entity $e ) => $this->offers( $e ),
			now: $now,
		);
	}

	/** Record the page view: a step the visitor chose, or one the guide sent them on (`$via`). */
	public function record( Entity $e, ?string $via ): void {
		if ( null !== $via && in_array( $via, self::VIAS, true ) ) {
			$this->guide()->follow( $e->id, $via );
		} else {
			$this->guide()->visited( $e->id );
		}
	}

	/**
	 * The nudge for this page, if one is due: the server picks what, the browser picks when
	 * (after `delayMs`, and only once per page per visit).
	 *
	 * @return array<string, mixed>|null
	 */
	public function nudge_for( Entity $e, bool $own_step ): ?array {
		if ( ! $own_step ) {
			return null;
		}
		$clock = 0.0;
		$guide = $this->guide( static function () use ( &$clock ): float {
			return $clock;
		} );
		$guide->visited( $e->id );
		$clock += $guide->nudgePolicy->delayMs;
		$reply = $guide->nudge();
		return null === $reply ? null : array( 'from' => $e->id, 'delayMs' => $guide->nudgePolicy->delayMs ) + $this->reply_data( $reply );
	}

	/** @return list<array{label: string, url: ?string, text: string}> */
	public function related( Entity $e, int $limit = 6 ): array {
		$out = array();
		foreach ( $this->pubba->related( $e->id, limit: $limit, accept: fn ( Entity $x ) => $this->accepts( $x ) ) as $r ) {
			$out[] = array( 'label' => $r->entity->label, 'url' => $this->path( $r->entity ), 'text' => $r->text );
		}
		return $out;
	}

	/** @return list<array{label: string, url: ?string, text: string}> */
	public function next( int $limit = 3 ): array {
		$out = array();
		foreach ( $this->pubba->next( $this->trail->get(), $limit, accept: fn ( Entity $x ) => $this->accepts( $x ) ) as $s ) {
			$out[] = array( 'label' => $s->entity->label, 'url' => $this->path( $s->entity ), 'text' => $s->text );
		}
		return $out;
	}

	/** @return array<string, mixed> The guide's answer, as JSON for the widget. */
	public function ask( string $question ): array {
		return $this->reply_data( $this->guide()->ask( mb_substr( $question, 0, 200 ) ) );
	}

	/** @return array<string, mixed> */
	private function reply_data( Reply $r ): array {
		return array(
			'kind'   => $r->kind,
			'text'   => $r->text,
			'action' => null === $r->action ? null : array( 'id' => $r->action->id, 'url' => $r->action->url ),
			'chips'  => array_map( array( self::class, 'chip_data' ), $r->chips ),
		);
	}

	/** @return array<string, mixed> */
	private static function chip_data( GuideChip $c ): array {
		if ( $c instanceof QuestionChip ) {
			return array( 'label' => $c->label, 'question' => $c->question );
		}
		assert( $c instanceof EntityChip );
		return array( 'label' => $c->label, 'url' => $c->url, 'text' => $c->text );
	}

	/**
	 * The related list under a page, as HTML. `$esc` escapes text for HTML (esc_html in WordPress).
	 *
	 * @param list<array{label: string, url: ?string, text: string}> $items
	 */
	public static function list_html( string $title, array $items, callable $esc ): string {
		if ( array() === $items ) {
			return '';
		}
		$html = '<section class="pubba-list"><h2>' . $esc( $title ) . '</h2><ul>';
		foreach ( $items as $item ) {
			$label = $esc( $item['label'] );
			$link  = null === $item['url'] ? $label : '<a href="' . $esc( $item['url'] . '?pubba_via=related' ) . '">' . $label . '</a>';
			$html .= '<li>' . $link . '<span>' . $esc( $item['text'] ) . '</span></li>';
		}
		return $html . '</ul></section>';
	}
}
