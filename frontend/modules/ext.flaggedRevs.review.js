/**
 * FlaggedRevs Review JavaScript
 * @author Aaron Schulz
 * @author Daniel Arnold 2008
 */
( function ( mw, $ ) {
	'use strict';

	var fr,
		wgFlaggedRevsParams = mw.config.get( 'wgFlaggedRevsParams' );

	fr = {
		/* User is reviewing this page? */
		isUserReviewing: 0,

		/*
		 * Update <select> color for the selected item/option
		 */
		updateReviewFormColors: function ( form ) {
			var tag, select, selectedlevel, value;
			for ( tag in wgFlaggedRevsParams.tags ) { // for each tag
				select = form.find( '[name="wp' + tag + '"]' ).eq( 0 );
				// Look for a selector for this tag
				if ( select.length && select.prop( 'nodeName' ) === 'SELECT' ) {
					selectedlevel = select.prop( 'selectedIndex' );
					value = select.children( 'option' ).eq( selectedlevel ).val();
					select.prop( 'className', 'fr-rating-option-' + value );
					// Fix FF one-time jitter bug of changing an <option>
					select.prop( 'selectedIndex', null );
					select.prop( 'selectedIndex', selectedlevel );
				}
			}
		},

		/*
		 * Updates for radios/checkboxes on patch by Daniel Arnold (bug 13744).
		 * Visually update the revision rating form on change.
		 * - Disable submit in case of invalid input.
		 * - Update colors when <select> changes.
		 * - Also remove comment box clutter in case of invalid input.
		 * NOTE: all buttons should exist (perhaps hidden though)
		 */
		updateReviewForm: function ( form ) {
			var somezero, tag, tagLevelSelects, tagLevelSelect, selectedlevel, i, l;
			if ( form.prop( 'disabled' ) ) {
				return;
			}

			somezero = false;
			// Determine if this is a "quality" or "incomplete" review
			for ( tag in wgFlaggedRevsParams.tags ) {
				// Get the element or elements for selecting the tag level.
				// We might get back a select, a checkbox, or *several* radios.
				tagLevelSelects = form.find( '[name="wp' + tag + '"]' );
				if ( !tagLevelSelects.length ) {
					continue; // none found; binary flagging?
				}
				tagLevelSelect = tagLevelSelects.eq( 0 ); // convenient for select and checkbox

				selectedlevel = 0; // default
				if ( tagLevelSelect.prop( 'nodeName' ) === 'SELECT' ) {
					selectedlevel = tagLevelSelect.prop( 'selectedIndex' );
				} else if ( tagLevelSelect.prop( 'type' ) === 'checkbox' ) {
					selectedlevel = tagLevelSelect.prop( 'checked' ) ? 1 : 0;
				} else if ( tagLevelSelect.prop( 'type' ) === 'radio' ) {
					// Go through each radio option and find the selected one...
					for ( i = 0, l = tagLevelSelects.length; i < l; i++ ) {
						if ( tagLevelSelects.eq( i ).prop( 'checked' ) ) {
							selectedlevel = i;
							break;
						}
					}
				} else {
					return; // error: should not happen
				}

				if ( selectedlevel <= 0 ) {
					somezero = true;
				}
			}

			// (a) If only a few levels are zero ("incomplete") then disable submission.
			// (b) Re-enable submission for already accepted revs when ratings change.
			$( '#mw-fr-submit-accept' )
				.prop( 'disabled', somezero )
				.val( mw.msg( 'revreview-submit-review' ) ); // reset to "Accept"

			// Update colors of <select>
			fr.updateReviewFormColors( form );
		},

		/*
		 * Lock review form from submissions (using during AJAX requests)
		 */
		lockReviewForm: function ( form ) {
			form.find( 'input, textarea, select' ).prop( 'disabled', true );
		},

		/*
		 * Unlock review form from submissions (using after AJAX requests)
		 */
		unlockReviewForm: function ( form ) {
			var i, inputs = form.find( 'input' );
			for ( i = 0; i < inputs.length; i++ ) {
				if ( inputs.eq( i ).prop( 'type' ) !== 'submit' ) { // not all buttons can be enabled
					inputs.eq( i ).prop( 'disabled', false );
				} else {
					inputs.eq( i ).blur(); // focus off element (bug 24013)
				}
			}
			form.find( 'textarea, select' ).prop( 'disabled', false );
		},

		/*
		 * Update form elements after AJAX review.
		 */
		postSubmitRevisionReview: function ( form, response ) {
			var changeTime, $asubmit, $usubmit, $rsubmit, $diffNotice, $tagBox, $diffUIParams,
				requestArgs, urlParams, i, l,
				msg = response.substr( 6 ), // remove <err#> or <suc#>
				// Read new "last change time" timestamp for conflict handling
				// @TODO: pass last-chage-time data using JSON or something not retarded
				m = msg.match( /^<lct#(\d*)>(.*)/m );
			if ( m ) {
				msg = m[ 2 ]; // remove tag from msg
			}
			changeTime = m ? m[ 1 ] : null; // MW TS

			// Review form elements
			$asubmit = $( '#mw-fr-submit-accept' ); // ACCEPT
			$usubmit = $( '#mw-fr-submit-unaccept' ); // UNACCEPT
			$rsubmit = $( '#mw-fr-submit-reject' ); // REJECT
			$diffNotice = $( '#mw-fr-difftostable' );
			// FlaggedRevs rating box
			$tagBox = $( '#mw-fr-revisiontag' );
			// Diff parameters
			$diffUIParams = $( '#mw-fr-diff-dataform' );

			// On success...
			if ( response.indexOf( '<suc#>' ) === 0 ) {
				// (a) Update document title and form buttons...
				if ( $asubmit.length && $usubmit.length ) {
					// Revision was flagged
					if ( $asubmit.val() === mw.msg( 'revreview-submitting' ) ) {
						$asubmit.val( mw.msg( 'revreview-submit-reviewed' ) ); // done!
						$asubmit.css( 'fontWeight', 'bold' );
						// Unlock and reset *unflag* button
						$usubmit.val( mw.msg( 'revreview-submit-unreview' ) );
						$usubmit.css( 'fontWeight', '' ); // back to normal
						$usubmit.show(); // now available
						$usubmit.prop( 'disabled', false ); // unlock
						$rsubmit.prop( 'disabled', true ); // lock if present
					// Revision was unflagged
					} else if ( $usubmit.val() === mw.msg( 'revreview-submitting' ) ) {
						$usubmit.val( mw.msg( 'revreview-submit-unreviewed' ) ); // done!
						$usubmit.css( 'fontWeight', 'bold' );
						// Unlock and reset *flag* button
						$asubmit.val( mw.msg( 'revreview-submit-review' ) );
						$asubmit.css( 'fontWeight', '' ); // back to normal
						$asubmit.prop( 'disabled', false ); // unlock
						$rsubmit.prop( 'disabled', false ); // unlock if present
					}
				}
				// (b) Remove review tag from drafts
				$tagBox.css( 'display', 'none' );
				// (c) Update diff-related items...
				if ( $diffUIParams.length ) {
					// Hide "review this" box on diffs
					$diffNotice.hide();
					// Update the contents of the mw-fr-diff-headeritems div
					requestArgs = []; // <oldid, newid>
					requestArgs.push( $diffUIParams.find( 'input' ).eq( 0 ).val() );
					requestArgs.push( $diffUIParams.find( 'input' ).eq( 1 ).val() );
					// Send encoded function plus all arguments...
					urlParams = '?action=ajax&rs=FlaggablePageView::AjaxBuildDiffHeaderItems';
					for ( i = 0, l = requestArgs.length; i < l; i++ ) {
						urlParams += '&rsargs[]=' + encodeURIComponent( requestArgs[ i ] );
					}
					// Send GET request via AJAX!
					$.ajax( {
						url: mw.util.wikiScript( 'index' ) + urlParams,
						type: 'GET',
						dataType: 'html', // response type
						success: function ( response ) {
							// Update the contents of the mw-fr-diff-headeritems div
							$( '#mw-fr-diff-headeritems' ).html( response );
						}
					} );
				}
			// On failure...
			} else {
				// (a) Update document title and form buttons...
				if ( $asubmit.length && $usubmit.length ) {
					// Revision was flagged
					if ( $asubmit.val() === mw.msg( 'revreview-submitting' ) ) {
						$asubmit.val( mw.msg( 'revreview-submit-review' ) ); // back to normal
						$asubmit.prop( 'disabled', false ); // unlock
					// Revision was unflagged
					} else if ( $usubmit.val() === mw.msg( 'revreview-submitting' ) ) {
						$usubmit.val( mw.msg( 'revreview-submit-unreview' ) ); // back to normal
						$usubmit.prop( 'disabled', false ); // unlock
					}
				}
				// (b) Output any error response message
				if ( response.indexOf( '<err#>' ) === 0 ) {
					mw.notify( $.parseHTML( msg ), { tag: 'review' } ); // failure notice
				} else {
					mw.notify( response, { tag: 'review' } ); // fatal notice
				}
			}
			// Update changetime for conflict handling
			if ( changeTime !== null ) {
				$( '#mw-fr-input-changetime' ).val( changeTime );
			}
			fr.unlockReviewForm( form );
		},

		/*
		 * Submit a revision review via AJAX and update form elements.
		*
		 * Note: requestArgs build-up from radios/checkboxes
		 * based on patch by Daniel Arnold (bug 13744)
		 */
		submitRevisionReview: function ( button, form ) {
			var i, l, requestArgs, inputs, input, selects, select, soption,
				postData;
			fr.lockReviewForm( form ); // disallow submissions
			// Build up arguments array and update submit button text...
			requestArgs = []; // array of strings of the format <"pname|pval">.
			inputs = form.find( 'input' );
			for ( i = 0; i < inputs.length; i++ ) {
				input = inputs.eq( i );
				// Different input types may occur depending on tags...
				if ( input.prop( 'name' ) === 'title' || input.prop( 'name' ) === 'action' ) {
					continue; // No need to send these...
				} else if ( input.prop( 'type' ) === 'submit' ) {
					if ( input.prop( 'id' ) === button.id ) {
						requestArgs.push( input.prop( 'name' ) + '|1' );
						// Show that we are submitting via this button
						input.val( mw.msg( 'revreview-submitting' ) );
					}
				} else if ( input.prop( 'type' ) === 'checkbox' ) {
					requestArgs.push( input.prop( 'name' ) + '|' + // must send a number
						( input.prop( 'checked' ) ? input.val() : 0 ) );
				} else if ( input.prop( 'type' ) === 'radio' ) {
					if ( input.prop( 'checked' ) ) { // must be checked
						requestArgs.push( input.prop( 'name' ) + '|' + input.val() );
					}
				} else {
					requestArgs.push( input.prop( 'name' ) + '|' + input.val() ); // text/hiddens...
				}
			}
			selects = form.find( 'select' );
			for ( i = 0, l = selects.length; i < l; i++ ) {
				select = selects.eq( i );
				// Get the selected tag level...
				if ( select.prop( 'selectedIndex' ) >= 0 ) {
					soption = select.find( 'option' ).eq( select.prop( 'selectedIndex' ) );
					requestArgs.push( select.prop( 'name' ) + '|' + soption.val() );
				}
			}
			// Send encoded function plus all arguments...
			postData = 'action=ajax&rs=RevisionReview::AjaxReview';
			for ( i = 0; i < requestArgs.length; i++ ) {
				postData += '&rsargs[]=' + encodeURIComponent( requestArgs[ i ] );
			}
			// Send POST request via AJAX!
			$.ajax( {
				url: mw.util.wikiScript( 'index' ),
				type: 'POST',
				data: postData,
				dataType: 'html', // response type
				success: function ( response ) {
					fr.postSubmitRevisionReview( form, response );
				},
				error: function () {
					fr.unlockReviewForm( form );
				}
			} );
		},

		/*
		 * Set reviewing status for this page/diff
		 */
		setReviewingStatus: function ( value ) {
			var res = false,
				// Get [previd, oldid]  array for this page view.
				// The previd value will be 0 if this is not a diff view.
				$inputRefId = $( '#mw-fr-input-refid' ),
				oRevId = $inputRefId.length ? $inputRefId.val() : 0,
				$inputOldId = $( '#mw-fr-input-oldid' ),
				nRevId = $inputOldId.length ? $inputOldId.val() : 0;
			if ( nRevId > 0 ) {
				// Send GET request via AJAX!
				$.ajax( {
					url: mw.util.wikiScript( 'api' ),
					data: {
						action: 'reviewactivity',
						previd: oRevId,
						oldid: nRevId,
						reviewing: value,
						token: mw.user.tokens.get( 'editToken' ),
						format: 'json'
					},
					type: 'POST',
					dataType: 'json', // response type
					timeout: 1700, // don't delay user exiting
					success: function ( data ) { res = data; },
					async: false
				} );
				if ( res && res.reviewactivity && res.reviewactivity.result === 'Success' ) {
					fr.isUserReviewing = value;
					return true;
				}
			}
			return false;
		},

		/*
		 * Flag users as "now reviewing"
		 */
		advertiseReviewing: function ( e, isInitial ) {
			var msgkey, $underReview;
			if ( isInitial !== true ) { // don't send if just setting up form
				if ( !fr.setReviewingStatus( 1 ) ) {
					return; // failed
				}
			}
			// Build notice to say that user is advertising...
			msgkey = $( '#mw-fr-input-refid' ).length ?
				'revreview-adv-reviewing-c' : // diff
				'revreview-adv-reviewing-p'; // page
			$underReview = $(
				'<span class="fr-under-review">' + mw.message( msgkey, mw.user ).escaped() + '</span>' );
			// Update notice to say that user is advertising...
			$( '#mw-fr-reviewing-status' )
				.empty()
				.append( $underReview )
				.append( ' (' + mw.html.element( 'a',
					{ id: 'mw-fr-reviewing-stop' }, mw.msg( 'revreview-adv-stop-link' ) ) + ')' )
				.find( '#mw-fr-reviewing-stop' )
				.css( 'cursor', 'pointer' )
				.click( fr.deadvertiseReviewing );
		},

		/*
		 * Flag users as "no longer reviewing"
		 */
		deadvertiseReviewing: function ( e, isInitial ) {
			var msgkey, $underReview;
			if ( isInitial !== true ) { // don't send if just setting up form
				if ( !fr.setReviewingStatus( 0 ) ) {
					return; // failed
				}
			}
			// Build notice to say that user is not advertising...
			msgkey = $( '#mw-fr-input-refid' ).length ?
				'revreview-sadv-reviewing-c' : // diff
				'revreview-sadv-reviewing-p'; // page
			$underReview = $(
				'<span class="fr-make-under-review">' +
				mw.message( msgkey )
					.escaped()
					.replace( /\$1/, mw.html.element( 'a',
						{ id: 'mw-fr-reviewing-start' }, mw.msg( 'revreview-adv-start-link' ) ) ) +
				'</span>'
			);
			$underReview.find( '#mw-fr-reviewing-start' )
				.css( 'cursor', 'pointer' )
				.click( fr.advertiseReviewing );
			// Update notice to say that user is not advertising...
			$( '#mw-fr-reviewing-status' ).empty().append( $underReview );
		},

		/*
		 * Enable AJAX-based functionality to set that a user is reviewing a page/diff
		 */
		enableAjaxReviewActivity: function () {
			// User is already reviewing in another tab...
			if ( $( '#mw-fr-user-reviewing' ).val() === 1 ) {
				fr.isUserReviewing = 1;
				fr.advertiseReviewing( null, true );
			// User is not already reviewing this....
			} else {
				fr.deadvertiseReviewing( null, true );
			}
			$( '#mw-fr-reviewing-status' ).show();
		},

		/* Startup function */
		init: function () {
			var $form = $( '#mw-fr-reviewform' );

			// Enable AJAX-based submit functionality to the review form on this page
			$( '#mw-fr-submit-accept, #mw-fr-submit-unaccept' ).click( function () {
				fr.submitRevisionReview( this, $form );
				return false; // don't do normal non-AJAX submit
			} );

			// Disable 'accept' button if the revision was already reviewed.
			// This is used so that they can be re-enabled if a rating changes.
			/* global jsReviewNeedsChange */
			// wtf? this is set in frontend/RevisionReviewFormUI by outputting JS
			if ( typeof jsReviewNeedsChange !== 'undefined' && jsReviewNeedsChange === 1 ) {
				$( '#mw-fr-submit-accept' ).prop( 'disabled', true );
			}

			// Setup <select> form option colors
			fr.updateReviewFormColors( $form );
			// Update review form on change
			$form.find( 'input, select' ).change( function () {
				fr.updateReviewForm( $form );
			} );

			// Display "advertise" notice
			fr.enableAjaxReviewActivity();
			// "De-advertise" user as "no longer reviewing" on navigate-away
			$( window ).on( 'unload', function () {
				if ( fr.isUserReviewing === 1 ) {
					fr.deadvertiseReviewing();
				}
			} );
		}
	};

	// Perform some onload events:
	$( fr.init );

}( mediaWiki, jQuery ) );
