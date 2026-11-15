// The guide widget: an Ask button, a panel with the guide's reply and chips, and nudges.
// The server answers (window.pubbaGuide.endpoint); this file only draws and navigates.
(function () {
	'use strict';
	var config = window.pubbaGuide;
	if (!config) return;

	var root = document.createElement('div');
	root.className = 'pubba-guide';
	root.innerHTML =
		'<div class="pubba-nudge" hidden><p aria-live="polite"></p><div class="pubba-row">' +
		'<button type="button" class="pubba-quiet" data-dismiss>Not now</button>' +
		'<a class="pubba-button" data-go>Show me</a></div></div>' +
		'<div class="pubba-panel" id="pubba-panel" role="dialog" aria-label="Ask about the work" hidden>' +
		'<p class="pubba-text" aria-live="polite"></p><div class="pubba-chips"></div>' +
		'<form><label class="pubba-hidden" for="pubba-q">Ask about the work</label>' +
		'<input id="pubba-q" name="q" type="text" autocomplete="off" maxlength="200" placeholder="Ask about the work">' +
		'<button type="submit">Ask</button></form></div>' +
		'<button type="button" class="pubba-open" aria-expanded="false" aria-controls="pubba-panel">Ask</button>';
	document.body.appendChild(root);

	var panel = root.querySelector('.pubba-panel');
	var open = root.querySelector('.pubba-open');
	var text = root.querySelector('.pubba-text');
	var chips = root.querySelector('.pubba-chips');
	var input = root.querySelector('input');
	var nudge = root.querySelector('.pubba-nudge');

	// A link the guide sends the visitor to says so, so the next page records it as followed.
	function via(url, how) {
		return url + (url.indexOf('?') < 0 ? '?' : '&') + 'pubba_via=' + how;
	}

	function ask(question) {
		text.textContent = '…';
		return fetch(config.endpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'same-origin',
			body: JSON.stringify({ q: question })
		})
			.then(function (r) { return r.json(); })
			.then(show)
			.catch(function () { text.textContent = 'The guide is unavailable right now.'; });
	}

	function show(reply) {
		// The guide doesn't move the visitor; the page performs the action.
		if (reply.action && reply.action.url) {
			window.location.href = via(reply.action.url, 'typed');
			return;
		}
		text.textContent = reply.text;
		chips.textContent = '';
		reply.chips.forEach(function (c) {
			var el;
			if (c.url) {
				el = document.createElement('a');
				el.href = via(c.url, 'chip');
				el.title = c.text;
			} else {
				el = document.createElement('button');
				el.type = 'button';
				el.addEventListener('click', function () { ask(c.question || c.label); });
			}
			el.className = 'pubba-chip';
			el.textContent = c.label;
			chips.appendChild(el);
		});
	}

	function setOpen(isOpen) {
		panel.hidden = !isOpen;
		open.setAttribute('aria-expanded', String(isOpen));
		open.textContent = isOpen ? 'Close' : 'Ask';
		if (isOpen) {
			nudge.hidden = true;
			ask('');
			input.focus();
		}
	}

	open.addEventListener('click', function () { setOpen(panel.hidden); });
	root.querySelector('form').addEventListener('submit', function (e) {
		e.preventDefault();
		if (input.value.trim()) ask(input.value);
		input.value = '';
	});
	document.addEventListener('keydown', function (e) {
		if (e.key === 'Escape' && !panel.hidden) {
			setOpen(false);
			open.focus();
		}
	});

	// Nudges: the server worked out what to suggest; show it after the delay, once per page
	// per visit, and no closer together than the policy's gap.
	var n = config.nudge;
	if (n && n.action && n.action.url) {
		var key = 'pubba-nudged';
		var seen = JSON.parse(sessionStorage.getItem(key) || '{"from":[],"at":0}');
		if (seen.from.indexOf(n.from) < 0) {
			setTimeout(function () {
				if (!panel.hidden || Date.now() - seen.at < config.nudgeGapMs) return;
				seen.from.push(n.from);
				seen.at = Date.now();
				sessionStorage.setItem(key, JSON.stringify(seen));
				nudge.querySelector('p').textContent = n.text;
				nudge.querySelector('[data-go]').href = via(n.action.url, 'suggestion');
				nudge.hidden = false;
			}, n.delayMs);
		}
	}
	nudge.querySelector('[data-dismiss]').addEventListener('click', function () { nudge.hidden = true; });
})();
