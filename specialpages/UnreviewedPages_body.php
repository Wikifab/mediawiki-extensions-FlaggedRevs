<?php
if ( !defined( 'MEDIAWIKI' ) ) {
	echo "FlaggedRevs extension\n";
	exit( 1 );
}

class UnreviewedPages extends SpecialPage
{
	protected $pager = null;

	public function __construct() {
		parent::__construct( 'UnreviewedPages', 'unreviewedpages' );
	}

	public function execute( $par ) {
		global $wgRequest, $wgUser, $wgOut;

		$this->setHeaders();
		if ( !$wgUser->isAllowed( 'unreviewedpages' ) ) {
			$wgOut->permissionRequired( 'unreviewedpages' );
			return;
		}
		$this->skin = $wgUser->getSkin();

		# Get default namespace
		$namespaces = FlaggedRevs::getReviewNamespaces();
		$defaultNS = !$namespaces ? NS_MAIN : $namespaces[0];

		$this->namespace = $wgRequest->getIntOrNull( 'namespace', $defaultNS );
		$category = trim( $wgRequest->getVal( 'category' ) );
		$catTitle = Title::makeTitleSafe( NS_CATEGORY, $category );
		$this->category = is_null( $catTitle ) ? '' : $catTitle->getText();
		$this->level = $wgRequest->getInt( 'level' );
		$this->hideRedirs = $wgRequest->getBool( 'hideredirs', true );
		$this->live = self::generalQueryOK();

		$this->pager = new UnreviewedPagesPager( $this, $this->live,
			$this->namespace, !$this->hideRedirs, $this->category, $this->level );

		$this->showForm();
		$this->showPageList();
	}

	protected function showForm() {
		global $wgOut, $wgLang, $wgScript;
		# Add explanatory text
		$wgOut->addWikiMsg( 'unreviewedpages-list', $wgLang->formatNum( $this->pager->getNumRows() ) );

		# show/hide links
		$showhide = array( wfMsgHtml( 'show' ), wfMsgHtml( 'hide' ) );
		$onoff = 1 - $this->hideRedirs;
		$link = $this->skin->link( $this->getTitle(), $showhide[$onoff], array(),
			array( 'hideredirs' => $onoff, 'category' => $this->category,
				'namespace' => $this->namespace )
		);
		$showhideredirs = wfMsgHtml( 'whatlinkshere-hideredirs', $link );

		# Add form...
		$form = Html::openElement( 'form', array( 'name' => 'unreviewedpages',
			'action' => $wgScript, 'method' => 'get' ) ) . "\n";
		$form .= "<fieldset><legend>" . wfMsg( 'unreviewedpages-legend' ) . "</legend>\n";
		$form .= Html::hidden( 'title', $this->getTitle()->getPrefixedDBKey() ) . "\n";
		# Add dropdowns as needed
		if ( count( FlaggedRevs::getReviewNamespaces() ) > 1 ) {
			$form .= FlaggedRevsXML::getNamespaceMenu( $this->namespace ) . '&#160;';
		}
		if ( FlaggedRevs::qualityVersions() ) {
			$form .= FlaggedRevsXML::getLevelMenu( $this->level, false, 1 ) . '&#160;';
		}
		$form .= 
			"<span style='white-space: nowrap;'>" .
			Xml::label( wfMsg( "unreviewedpages-category" ), 'category' ) . '&#160;' .
			Xml::input( 'category', 30, $this->category, array( 'id' => 'category' ) ) .
			'</span><br />';
		$form .= $showhideredirs . '&#160;&#160;';
		$form .= Xml::submitButton( wfMsg( 'allpagessubmit' ) );
		$form .= '</fieldset>';
		$form .= Html::closeElement( 'form' ) . "\n";

		# Query may get too slow to be live...
		if ( !$this->live ) {
			$dbr = wfGetDB( DB_SLAVE );
			$ts = $dbr->selectField( 'querycache_info', 'qci_timestamp',
				array( 'qci_type' => 'fr_unreviewedpages' ), __METHOD__ );
			if ( $ts ) {
				$ts = wfTimestamp( TS_MW, $ts );
				$td = $wgLang->timeanddate( $ts );
				$d = $wgLang->date( $ts );
				$t = $wgLang->time( $ts );
				$form .= wfMsgExt( 'perfcachedts', 'parse', $td, $d, $t );
			} else {
				$form .= wfMsgExt( 'perfcached', 'parse' );
			}
		}

		$wgOut->addHTML( $form );
	}

	protected function showPageList() {
		global $wgOut;
		if ( $this->pager->getNumRows() ) {
			$wgOut->addHTML( $this->pager->getNavigationBar() );
			$wgOut->addHTML( $this->pager->getBody() );
			$wgOut->addHTML( $this->pager->getNavigationBar() );
		} else {
			$wgOut->addWikiMsg( 'unreviewedpages-none' );
		}
	}

	public function formatRow( $row ) {
		global $wgLang, $wgUser;
		$title = Title::newFromRow( $row );

		$stxt = $underReview = $watching = '';
		$link = $this->skin->link( $title, null, array(), 'redirect=no&reviewing=1' );
		$hist = $this->skin->linkKnown( $title, wfMsgHtml( 'hist' ),
			array(), 'action=history&reviewing=1' );
		if ( !is_null( $size = $row->page_len ) ) {
			$stxt = ( $size == 0 )
				? wfMsgHtml( 'historyempty' )
				: wfMsgExt( 'historysize', 'parsemag', $wgLang->formatNum( $size ) );
			$stxt = " <small>$stxt</small>";
		}
		# Get how long the first unreviewed edit has been waiting...
		static $currentTime;
		$currentTime = wfTimestamp( TS_UNIX ); // now
		$firstPendingTime = wfTimestamp( TS_UNIX, $row->creation );
		$hours = ( $currentTime - $firstPendingTime ) / 3600;
		// After three days, just use days
		if ( $hours > ( 3 * 24 ) ) {
			$days = round( $hours / 24, 0 );
			$age = ' ' . wfMsgExt( 'unreviewedpages-days',
				'parsemag', $wgLang->formatNum( $days ) );
		// If one or more hours, use hours
		} elseif ( $hours >= 1 ) {
			$hours = round( $hours, 0 );
			$age = ' ' . wfMsgExt( 'unreviewedpages-hours',
				'parsemag', $wgLang->formatNum( $hours ) );
		} else {
			$age = ' ' . wfMsg( 'unreviewedpages-recent' ); // hot off the press :)
		}
		if ( $wgUser->isAllowed( 'unwatchedpages' ) ) {
			$uw = FRUserActivity::numUsersWatchingPage( $title );
			$watching = $uw
				? wfMsgExt( 'unreviewedpages-watched', 'parsemag', $wgLang->formatNum( $uw ) )
				: wfMsgHtml( 'unreviewedpages-unwatched' );
			$watching = " $watching"; // Oh-noes!
		} else {
			$uw = - 1;
		}
		$css = self::getLineClass( $hours, $uw );
		$css = $css ? " class='$css'" : "";

		# Show if a user is looking at this page
		list( $u, $ts ) = FRUserActivity::getUserReviewingPage( $row->page_id );
		if ( $u !== null ) {
			$underReview = " <span class='fr-under-review'>" .
				wfMsgHtml( 'unreviewedpages-viewing' ) . '</span>';
		}

		return( "<li{$css}>{$link} {$stxt} ({$hist})" .
			"{$age}{$watching}{$underReview}</li>" );
	}

	protected static function getLineClass( $hours, $uw ) {
		if ( $uw == 0 )
			return 'fr-unreviewed-unwatched';
		else if ( $hours > 20 * 24 )
			return 'fr-pending-long2';
		else if ( $hours > 7 * 24 )
			return 'fr-pending-long';
		else
			return "";
	}

	/**
	 * There may be many pages, most of which are reviewed
	 */
	public static function generalQueryOK() {
		$namespaces = FlaggedRevs::getReviewNamespaces();
		if ( !$namespaces || !wfQueriesMustScale() ) {
			return true;
		}
		# Get est. of fraction of pages that are reviewed
		$dbr = wfGetDB( DB_SLAVE );
		$reviewedpages = $dbr->estimateRowCount( 'flaggedpages', '*', array(), __METHOD__ );
		$pages = $dbr->estimateRowCount( 'page', '*',
			array( 'page_namespace' => $namespaces ),
			__METHOD__
		);
		$ratio = $pages / ( $pages - $reviewedpages );
		# If dist. is equal, # of rows scanned = $ratio * LIMIT (or until list runs out)
		return ( $ratio <= 400 );
	}
}

/**
 * Query to list out unreviewed pages
 */
class UnreviewedPagesPager extends AlphabeticPager {
	public $mForm;
	protected $live, $namespace, $category, $showredirs;

	const PAGE_LIMIT = 50; // Don't get too expensive

	function __construct(
		$form, $live, $namespace, $redirs = false, $category = null, $level = 0
	) {
		$this->mForm = $form;
		$this->live = (bool)$live;
		# Must be a content page...
		if ( !is_null( $namespace ) ) {
			$namespace = (int)$namespace;
		}
		$vnamespaces = FlaggedRevs::getReviewNamespaces();
		# Must be a single NS for perfomance reasons
		if ( is_null( $namespace ) || !in_array( $namespace, $vnamespaces ) ) {
			$namespace = !$vnamespaces ? -1 : $vnamespaces[0];
		}
		$this->namespace = $namespace;
		$this->category = $category ? str_replace( ' ', '_', $category ) : null;
		$this->level = intval( $level );
		$this->showredirs = (bool)$redirs;
		parent::__construct();
		// Don't get too expensive
		$this->mLimitsShown = array( 20, 50 );
		$this->setLimit( $this->mLimit ); // apply max limit
	}

	function setLimit( $limit ) {
		$this->mLimit = min( $limit, self::PAGE_LIMIT );
	}

	function formatRow( $row ) {
		return $this->mForm->formatRow( $row );
	}

	function getQueryInfo() {
		if ( !$this->live ) {
			return $this->getQueryCacheInfo();
		}
		$fields = array( 'page_namespace', 'page_title', 'page_len', 'page_id',
			'MIN(rev_timestamp) AS creation' );
		# Filter by level
		if ( $this->level == 1 ) {
			$conds[] = "fp_page_id IS NULL OR fp_quality = 0";
		} else {
			$conds[] = 'fp_page_id IS NULL';
		}
		# Reviewable pages only
		$conds['page_namespace'] = $this->namespace;
		# No redirects
		if ( !$this->showredirs ) {
			$conds['page_is_redirect'] = 0;
		}
		# Filter by category
		if ( $this->category != '' ) {
			$tables = array( 'categorylinks', 'page', 'flaggedpages', 'revision' );
			$fields[] = 'cl_sortkey';
			$conds['cl_to'] = $this->category;
			$conds[] = 'cl_from = page_id';
			# Note: single NS always specified
			if ( $this->namespace == NS_FILE ) {
				$conds['cl_type'] = 'file';
			} elseif ( $this->namespace == NS_CATEGORY ) {
				$conds['cl_type'] = 'subcat';
			} else {
				$conds['cl_type'] = 'page';
			}
			$this->mIndexField = 'cl_sortkey';
			$useIndex = array( 'categorylinks' => 'cl_sortkey' );
			$groupBy = 'cl_sortkey,cl_from';
		} else {
			$tables = array( 'page', 'flaggedpages', 'revision' );
			$this->mIndexField = 'page_title';
			$useIndex = array( 'page' => 'name_title' );
			$groupBy = 'page_title';
		}
		$useIndex['revision'] = 'page_timestamp'; // sigh...
		return array(
			'tables'  => $tables,
			'fields'  => $fields,
			'conds'   => $conds,
			'options' => array( 'USE INDEX' => $useIndex, 'GROUP BY' => $groupBy ),
			'join_conds' => array(
				'revision'     => array( 'LEFT JOIN', 'rev_page=page_id' ), // Get creation date
				'flaggedpages' => array( 'LEFT JOIN', 'fp_page_id=page_id' )
			)
		);
	}
	
	function getQueryCacheInfo() {
		$conds = $this->mConds;
		$fields = array( 'page_namespace', 'page_title', 'page_len', 'page_id',
			'qc_value', 'MIN(rev_timestamp) AS creation' );
		# Re-join on flaggedpages to double-check since things
		# could have changed since the cache date. Also, use
		# the proper cache for this level.
		if ( $this->level == 1 ) {
			$conds['qc_type'] = 'fr_unreviewedpages_q';
			$conds[] = "fp_page_id IS NULL OR fp_quality < 1";
		} else {
			$conds['qc_type'] = 'fr_unreviewedpages';
			$conds[] = 'fp_page_id IS NULL';
		}
		# Reviewable pages only
		$conds['qc_namespace'] = $this->namespace;
		# No redirects
		if ( !$this->showredirs ) {
			$conds['page_is_redirect'] = 0;
		}
		$this->mIndexField = 'qc_value'; // page_id
		# Filter by category
		if ( $this->category != '' ) {
			$tables = array( 'page', 'categorylinks', 'querycache', 'flaggedpages', 'revision' );
			$conds['cl_to'] = $this->category;
			$conds[] = 'cl_from = qc_value'; // page_id
			# Note: single NS always specified
			if ( $this->namespace == NS_FILE ) {
				$conds['cl_type'] = 'file';
			} elseif ( $this->namespace == NS_CATEGORY ) {
				$conds['cl_type'] = 'subcat';
			} else {
				$conds['cl_type'] = 'page';
			}
		} else {
			$tables = array( 'page', 'querycache', 'flaggedpages', 'revision' );
		}
		$useIndex = array( 'querycache' => 'qc_type', 'page' => 'PRIMARY',
			'revision' => 'page_timestamp' ); // sigh...
		return array(
			'tables'  => $tables,
			'fields'  => $fields,
			'conds'   => $conds,
			'options' => array( 'USE INDEX' => $useIndex, 'GROUP BY' => 'qc_value' ),
			'join_conds' => array(
				'querycache'    => array( 'LEFT JOIN', 'qc_value=page_id' ),
				'revision'      => array( 'LEFT JOIN', 'rev_page=page_id' ), // Get creation date
				'flaggedpages'  => array( 'LEFT JOIN', 'fp_page_id=page_id' ),
				'categorylinks' => array( 'LEFT JOIN',
					array( 'cl_from=page_id', 'cl_to' => $this->category ) )
			)
		);
	}

	function getIndexField() {
		return $this->mIndexField;
	}
	
	function getStartBody() {
		wfProfileIn( __METHOD__ );
		# Do a link batch query
		$lb = new LinkBatch();
		foreach ( $this->mResult as $row ) {
			$lb->add( $row->page_namespace, $row->page_title );
		}
		$lb->execute();
		wfProfileOut( __METHOD__ );
		return '<ul>';
	}
	
	function getEndBody() {
		return '</ul>';
	}
}
