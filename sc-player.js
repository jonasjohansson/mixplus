(function($) {
	var timecode = function(ms) {
		var hms = function(ms) {
					return {
						h: Math.floor(ms/(60*60*1000)),
						m: Math.floor((ms/60000) % 60),
						s: Math.floor((ms/1000) % 60)
					};
				}(ms),
				tc = [];

		if (hms.h > 0) {
			tc.push(hms.h);
		}

		tc.push((hms.m < 10 && hms.h > 0 ? "0" + hms.m : hms.m));
		tc.push((hms.s < 10  ? "0" + hms.s : hms.s));

		return tc.join('.');
	};

	var shuffle = function(arr) {
		arr.sort(function() { return 1 - Math.floor(Math.random() * 3); } );
		return arr;
	};

	var debug = true,
	useSandBox = false,
	$doc = $(document),
	log = function(args) {
		try {
			if(debug && window.console && window.console.log){
				window.console.log.apply(window.console, arguments);
			}
		} catch (e) {
		}
	},

	domain = useSandBox ? 'sandbox-soundcloud.com' : 'soundcloud.com',
	secureDocument = (document.location.protocol === 'https:'),

	scApiUrl = function(url, apiKey) {
		var resolver = ( secureDocument || (/^https/i).test(url) ? 'https' : 'http') + '://api.' + domain + '/resolve?url=',
				params = 'format=json&consumer_key=' + apiKey +'&callback=?';

		if( secureDocument ) {
			url = url.replace(/^http:/, 'https:');
		}

		if ( (/api\./).test(url) ) {
			return url + '?' + params;
		} else {
			return resolver + url + '&' + params;
		}
	};

	var audioEngine = function() {
		var html5AudioAvailable = function() {
				var state = false;
				try {
					var a = new Audio();
					state = a.canPlayType && (/maybe|probably/).test(a.canPlayType('audio/mpeg'));
					// uncomment the following line, if you want to enable the html5 audio only on mobile devices
					// state = state && (/iPad|iphone|mobile|pre\//i).test(navigator.userAgent);
				} catch(e) { }

				return state;
		}(),

		callbacks = {
			onReady: function() {
				$doc.trigger('scPlayer:onAudioReady');
			},
			onPlay: function() {
				$doc.trigger('scPlayer:onMediaPlay');
			},
			onPause: function() {
				$doc.trigger('scPlayer:onMediaPause');
			},
			onEnd: function() {
				$doc.trigger('scPlayer:onMediaEnd');
			},
			onBuffer: function(percent) {
				$doc.trigger({type: 'scPlayer:onMediaBuffering', percent: percent});
			}
		};

		var html5Driver = function() {
			var player = new Audio(),
				onTimeUpdate = function(event){
					var obj = event.target,
						buffer = ((obj.buffered.length && obj.buffered.end(0)) / obj.duration) * 100;
					callbacks.onBuffer(buffer);
					if (obj.currentTime === obj.duration) { callbacks.onEnd(); }
				},
				onProgress = function(event) {
					var obj = event.target,
						buffer = ((obj.buffered.length && obj.buffered.end(0)) / obj.duration) * 100;
					callbacks.onBuffer(buffer);
				};

			$('<div class="sc-player-engine-container"></div>').appendTo(document.body).append(player);

			player.addEventListener('play', callbacks.onPlay, false);
			player.addEventListener('ended', callbacks.onEnd, false);
			player.addEventListener('progress', onProgress, false);

			return {
				load: function(track, apiKey) {
					player.pause();
					player.src = track.stream_url + (/\?/.test(track.stream_url) ? '&' : '?') + 'consumer_key=' + apiKey;
					player.load();
					player.play();
				},
				play: function() {
					player.play();
				},
				pause: function() {
					player.pause();
				},
				stop: function(){
					if (player.currentTime) {
						player.currentTime = 0;
						player.pause();
					}
				},
				seek: function(relative){
					player.currentTime = player.duration * relative;
					player.play();
				},
				getDuration: function() {
					return player.duration * 1000;
				},
				getPosition: function() {
					return player.currentTime * 1000;
				},
				setVolume: function(val) {
					player.volume = val / 100;
				}
			};
		};

		return html5Driver();

	}();

	var apiKey,
		didAutoPlay = false,
		players = [],
		updates = {},
		currentUrl,
		loadTracksData = function($player, links, key) {
			var index = 0,
				playerObj = {node: $player, tracks: []},
				loadUrl = function(link) {
					var apiUrl = scApiUrl(link.url, apiKey);
					$.getJSON(apiUrl, function(data) {
						index += 1;
						if (data.tracks) {
							playerObj.tracks = playerObj.tracks.concat(data.tracks);
						} else if(data.duration) {
							data.permalink_url = link.url;
							playerObj.tracks.push(data);
						} else if(data.creator) {
							links.push({url:data.uri + '/tracks'});
						} else if(data.username) {
							if (/favorites/.test(link.url)) {
								links.push({url:data.uri + '/favorites'});
							} else {
								links.push({url:data.uri + '/tracks'});
							}
						} else if($.isArray(data)) {
							playerObj.tracks = playerObj.tracks.concat(data);
						}
						if (links[index]){
							loadUrl(links[index]);
						} else {
							playerObj.node.trigger({type:'onTrackDataLoaded', playerObj: playerObj, url: apiUrl});
						}
				 });
			 };
			apiKey = key;
			players.push(playerObj);
			loadUrl(links[index]);
		},
		updateTrackInfo = function($player, track) {
			$('.sc-duration', $player).html(timecode(track.duration));
        	$('.sc-waveform-container', $player).html('<img src="' + track.waveform_url +'" />');
			$player.trigger('onPlayerTrackSwitch.scPlayer', [track]);
		},
		play = function(track) {
			var url = track.permalink_url;
			if(currentUrl === url){
				audioEngine.play();
			}else{
				currentUrl = url;
				audioEngine.load(track, apiKey);
			}
		},
		getPlayerData = function(node) {
			return players[$(node).data('sc-player').id];
		},
		updatePlayStatus = function(player, status) {
			if (status) {
				// reset all other players playing status
				$('div.sc-player.playing').removeClass('playing');
			}
			$(player)
				.toggleClass('playing', status)
				.trigger((status ? 'onPlayerPlay' : 'onPlayerPause'));
		},
		onPlay = function(player, id) {
			var track = getPlayerData(player).tracks[id || 0];
			updateTrackInfo(player, track);
			updates = {
				$buffer: $('.sc-buffer', player),
				$played: $('.sc-played', player),
				position:  $('.sc-position', player)[0]
			};
			updatePlayStatus(player, true);
			play(track);
			$('body').addClass('playing');
		},
		onPause = function(player) {
			updatePlayStatus(player, false);
			audioEngine.pause();
			$('body').removeClass('playing');
		},
		onFinish = function() {
			var $player = updates.$played.closest('.sc-player'),
				$nextItem;
			updates.$played.css('width', '0%');
			updates.position.innerHTML = timecode(0);
			updatePlayStatus($player, false);
			audioEngine.stop();
			$player.trigger('onPlayerTrackFinish');
		},
		onSeek = function(player, relative) {
			audioEngine.seek(relative);
			$(player).trigger('onPlayerSeek');
		},
		onSkip = function(player) {
			var $player = $(player);
			log('track finished get the next one');
			$nextItem = $('.sc-trackslist li.active', $player).next('li');
			if(!$nextItem.length){
				$nextItem = $player.nextAll('div.sc-player:first').find('.sc-trackslist li.active');
			}
			$('.sc-play',$nextItem.parent().parent()).click();
		},
		soundVolume = function() {
			var vol = 80,
				cooks = document.cookie.split(';'),
				volRx = new RegExp('scPlayer_volume=(\\d+)');
			for(var i in cooks){
				if(volRx.test(cooks[i])){
					vol = parseInt(cooks[i].match(volRx)[1], 10);
					break;
				}
			}
			return vol;
		}(),
		onVolume = function(volume) {
			var vol = Math.floor(volume);
			var date = new Date();
			date.setTime(date.getTime() + (365 * 24 * 60 * 60 * 1000));
			soundVolume = vol;
			document.cookie = ['scPlayer_volume=', vol, '; expires=', date.toUTCString(), '; path="/"'].join('');
			audioEngine.setVolume(soundVolume);
		},
		positionPoll;

		$doc
			.bind('scPlayer:onAudioReady', function(event) {
				audioEngine.play();
				onVolume(0);
			})
			.bind('scPlayer:onMediaPlay', function(event) {
				clearInterval(positionPoll);
				positionPoll = setInterval(function() {
					var duration = audioEngine.getDuration(),
						position = audioEngine.getPosition(),
						relative = (position / duration);

					updates.$played.css('width', (100 * relative) + '%');
					updates.position.innerHTML = timecode(position);
					$doc.trigger({
						type: 'onMediaTimeUpdate.scPlayer',
						duration: duration,
						position: position,
						relative: relative
					});
				}, 500);
			})
			.bind('scPlayer:onMediaPause', function(event) {
				clearInterval(positionPoll);
				positionPoll = null;
			})
			.bind('scPlayer:onVolumeChange', function(event) {
				onVolume(event.volume);
			})
			.bind('scPlayer:onMediaEnd', function(event) {
				onFinish();
			})
			.bind('scPlayer:onMediaBuffering', function(event) {
				updates.$buffer.css('width', event.percent + '%');
			});

		$.scPlayer = function(options, node) {
			var opts = $.extend({}, $.scPlayer.defaults, options),
				playerId = players.length,
				$source = node && $(node),
				sourceClasses = $source[0].className.replace('sc-player', ''),
				links = opts.links || $.map($('a', $source).add($source.filter('a')), function(val) { return {url: val.href, title: val.innerHTML}; }),
				$player = $('<div class="sc-player loading"></div>').data('sc-player', {id: playerId}),
				$container = $('<div></div>').appendTo($player),
				$artworks = null,
				$controls = $('<div class="sc-controls"></div>').appendTo($container),
				$list = $('<ol class="sc-trackslist"></ol>').appendTo($container);

			if(sourceClasses || opts.customClass){
				$player.addClass(sourceClasses).addClass(opts.customClass);
			}

			$player
				.find('.sc-controls')
					.append('<div class="button"><a class="sc-play"></a></div>')
				.end()

			loadTracksData($player, links, opts.apiKey);

			$player.bind('onTrackDataLoaded.scPlayer', function(event) {

				var tracks = event.playerObj.tracks;
				if (opts.randomize) {
					tracks = shuffle(tracks);
				}

				// add links

				$.each(tracks, function(index, track) {
					var active = index === 0;
					$('<li><span>'+track.user.username.toLowerCase()+'</span> &rarr; <span>'+track.title.toLowerCase()+'</span></li>').data('sc-track', {id:index}).toggleClass('active', active).appendTo($list);
					$player
						.find('.sc-controls')
							.append('<div class="button"><a class="sc-link-external" href="'+track.permalink_url+'" target="_blank"></a></div>')

					if (track.downloadable) {
						$player.find('.sc-controls').append('<div class="button"><a class="sc-link-download" href="'+track.download_url+'?client_id=cef9224262e60e2c07053248f133feed" target="_blank"></a></div>');
					} else {
						//$player.find('.sc-controls').append('<div class="button"><span></span></div>');
					}
					$('<div class="sc-time-indicators"><span class="sc-position"></span>/<span class="sc-duration"></span></div>').appendTo($container);
				});

				$player.each(function() {
					if($.isFunction(opts.beforeRender)){
						opts.beforeRender.call(this, tracks);
					}
				});

				$('.sc-duration', $player)[0].innerHTML = timecode(tracks[0].duration);
				$('.sc-position', $player)[0].innerHTML = timecode(0);
				updateTrackInfo($player, tracks[0]);
				if (opts.continuePlayback) {
					$player.bind('onPlayerTrackFinish', function(event) {
						onSkip($player);
					});
				}

				$player
					.append('<div class="sc-scrubber"></div>')
						.find('.sc-scrubber')
							.append('<div class="sc-time-span"><div class="sc-waveform-container"></div><div class="sc-buffer"></div><div class="sc-played"></div></div>')
					.end()
					.removeClass('loading')
					.trigger('onPlayerInit');

				if(opts.autoPlay && !didAutoPlay){
					onPlay($player);
					didAutoPlay = true;
				}
			});

		$source.each(function(index) {
			$(this).replaceWith($player);
		});

		return $player;
	};

	$.scPlayer.stopAll = function() {
	};

	$.scPlayer.destroy = function() {
		$('.sc-player, .sc-player-engine-container').remove();
	};

	// plugin wrapper

	$.fn.scPlayer = function(options) {
		didAutoPlay = false;
		this.each(function() {
			$.scPlayer(options, this);
		});
		return this;
	};

	// default plugin options

	$.scPlayer.defaults = $.fn.scPlayer.defaults = {
		customClass: null,

		// do something with the dom object before you render it, add nodes, get more data from the services etc.

		beforeRender  :   function(tracksData) {
			var $player = $(this);
		},

		// init when dom ready

		onDomReady  : function() {
			$('a.sc-player, div.sc-player').scPlayer();
		},
		autoPlay: false,
		continuePlayback: true,
		randomize: false,
		loadArtworks: 5,

		// get key here http://soundcloud.com/you/apps/new

		apiKey: 'htuiRd1JP11Ww0X72T1C3g'
	};

	// toggle play / pause

	$(document).on('click','a.sc-play, a.sc-pause', function(event) {
		var $list = $(this).closest('.sc-player').find('ol.sc-trackslist');

		// simulate the click in the tracklist

		var par = $(this).parent().parent().parent();
		par = $('li.active', par) ;
		var $track = par,
				$player = $(this).closest('.sc-player'),
				trackId = $track.data('sc-track').id,
				play = $player.is(':not(.playing)') || $track.is(':not(.active)');
		if (play) {
			onPlay($player, trackId);
		}else{
			onPause($player);
		}
		$track.addClass('active').siblings('li').removeClass('active');
		return false;
	});


	var scrub = function(node, xPos) {
		var $scrubber = $(node).closest('.sc-time-span'),
				$buffer = $scrubber.find('.sc-buffer'),
				$available = $scrubber.find('.sc-waveform-container img'),
				$player = $scrubber.closest('.sc-player'),
				relative = Math.min($buffer.width(), (xPos  - $available.offset().left)) / $available.width();
		onSeek($player, relative);
	};

	var onTouchMove = function(ev) {
		if (ev.targetTouches.length === 1) {
			scrub(ev.target, ev.targetTouches && ev.targetTouches.length && ev.targetTouches[0].clientX);
			ev.preventDefault();
		}
	};

	// seeking

	$(document)
		.on('click','.playing .sc-time-span', function(event) {
			scrub(this, event.pageX);
			return false;
		});
		/*.on('touchstart','.sc-time-span', function(event) {
			this.addEventListener('touchmove', onTouchMove, false);
			event.originalEvent.preventDefault();
		})
		.on('touchend','.sc-time-span', function(event) {
			this.removeEventListener('touchmove', onTouchMove, false);
			event.originalEvent.preventDefault();
		})*/

	// change volume

	var startVolumeTracking = function(node, startEvent) {
		var $node = $(node),
			originX = $node.offset().left,
			originWidth = $node.width(),
			originY = $node.offset().top,
			originHeight = $node.height(),
			getVolume = function(x) {
				return Math.floor(((x - originX)/originWidth)*100);
			},
			update = function(event) {
				$doc.trigger({type: 'scPlayer:onVolumeChange', volume: getVolume(event.pageX)});
			};
		$node.bind('mousemove.sc-player', update);
		update(startEvent);
	};

	var stopVolumeTracking = function(node, event) {
		$(node).unbind('mousemove.sc-player');
	};

	$(document)
		.on('click','.sc-volume-slider', function(event) {
			startVolumeTracking(this, event);
		})
		.on('click','.sc-volume-slider', function(event) {
			stopVolumeTracking(this, event);
		})

	$doc.bind('scPlayer:onVolumeChange', function(event) {
		$('span.sc-volume-status').css({width: event.volume + '%'});
	});

	// -------------------------------------------------------------------

	$(function() {
		if($.isFunction($.scPlayer.defaults.onDomReady)){
			$.scPlayer.defaults.onDomReady();
		}
	});

})(jQuery);
