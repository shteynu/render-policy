# Evil-Markdown corpus results

Corpus version 2026-09-30, 49 cases, run in Chromium by `corpus/run.mjs`.

A pass means every invariant of the case held: nothing executed, no forbidden element or attribute, no request to the listed hosts, and the guard content survived. "n/a" means the adapter has no streaming API.

| Category | naive (marked + innerHTML) | DOMPurify defaults + innerHTML | @render-policy/core (balanced, defaults) |
| --- | --- | --- | --- |
| script-execution | 1 / 8 | 7 / 8 | 8 / 8 |
| url-schemes | 0 / 7 | 6 / 7 | 7 / 7 |
| exfiltration | 0 / 15 | 4 / 15 | 15 / 15 |
| ui-spoofing | 0 / 6 | 1 / 6 | 6 / 6 |
| dom-clobbering | 0 / 2 | 1 / 2 | 2 / 2 |
| markdown | 3 / 3 | 3 / 3 | 3 / 3 |
| guard | 4 / 5 | 5 / 5 | 5 / 5 |
| streaming | 2 / 3 | 2 / 3 | 3 / 3 |

| Case | naive (marked + innerHTML) | DOMPurify defaults + innerHTML | @render-policy/core (balanced, defaults) |
| --- | --- | --- | --- |
| `script-tag` <script> in Markdown | ✗ | ✓ | ✓ |
| `img-onerror` <img onerror> | ✗ | ✓ | ✓ |
| `svg-onload` <svg onload> | ✗ | ✓ | ✓ |
| `details-ontoggle` <details open ontoggle> | ✗ | ✓ | ✓ |
| `iframe-srcdoc` <iframe srcdoc> | ✗ | ✓ | ✓ |
| `input-autofocus-onfocus` <input autofocus onfocus> | ✗ | ✗ | ✓ |
| `html-block-in-list` HTML block nested in a list item | ✗ | ✓ | ✓ |
| `link-title-injection` attribute injection through a link title | ✓ | ✓ | ✓ |
| `link-javascript` javascript: link | ✗ | ✓ | ✓ |
| `link-javascript-entity` entity-encoded javascript: link | ✗ | ✓ | ✓ |
| `link-javascript-tab` javascript: with an embedded tab | ✗ | ✓ | ✓ |
| `link-vbscript` vbscript: link | ✗ | ✓ | ✓ |
| `link-data-html` data:text/html link | ✗ | ✓ | ✓ |
| `autolink-javascript` javascript: autolink | ✗ | ✓ | ✓ |
| `img-data-svg` SVG through a data: image | ✗ | ✗ | ✓ |
| `img-remote-beacon` remote image beacon | ✗ | ✗ | ✓ |
| `img-remote-query-secret` remote image with data in the query | ✗ | ✗ | ✓ |
| `img-sink-webhook` image to a request catcher | ✗ | ✗ | ✓ |
| `img-protocol-relative` protocol-relative image | ✗ | ✗ | ✓ |
| `img-backslash` backslash host image | ✗ | ✗ | ✓ |
| `img-srcset` srcset to a remote host | ✗ | ✗ | ✓ |
| `link-ping` ping attribute | ✗ | ✓ | ✓ |
| `video-poster` video poster and source | ✗ | ✗ | ✓ |
| `audio-src` audio autoplay | ✗ | ✗ | ✓ |
| `object-data` <object data> | ✗ | ✓ | ✓ |
| `link-stylesheet` <link rel=stylesheet> | ✗ | ✓ | ✓ |
| `meta-refresh` <meta http-equiv=refresh> | ✗ | ✓ | ✓ |
| `img-reference-style` reference-style image | ✗ | ✗ | ✓ |
| `picture-source` <picture><source srcset> | ✗ | ✗ | ✓ |
| `nested-image-link` image inside a link | ✗ | ✗ | ✓ |
| `form-password` password form inside the reply | ✗ | ✗ | ✓ |
| `style-element` <style> restyling the host | ✗ | ✓ | ✓ |
| `style-attribute-overlay` fixed overlay through a style attribute | ✗ | ✗ | ✓ |
| `class-hijack` borrowing host CSS classes | ✗ | ✗ | ✓ |
| `dialog-open` <dialog open> | ✗ | ✗ | ✓ |
| `button-fake-consent` a button that looks like consent UI | ✗ | ✗ | ✓ |
| `clobber-location` id=location | ✗ | ✓ | ✓ |
| `clobber-name-and-form` name=body and form id | ✗ | ✗ | ✓ |
| `code-block-payload` payload inside a fenced code block stays text | ✓ | ✓ | ✓ |
| `inline-code` inline code stays text | ✓ | ✓ | ✓ |
| `mermaid-loose` Mermaid click handler with a javascript: URL | ✓ | ✓ | ✓ |
| `guard-basic` ordinary Markdown must survive | ✓ | ✓ | ✓ |
| `guard-same-origin-image` same-origin image must render | ✓ | ✓ | ✓ |
| `guard-code-language` code block language class must survive | ✓ | ✓ | ✓ |
| `guard-mailto-tel` mailto: and tel: links must survive | ✓ | ✓ | ✓ |
| `guard-target-blank` target=_blank must carry rel=noopener if kept | ✗ | ✓ | ✓ |
| `stream-image-cut` image URL received in pieces: no request before the closing parenthesis | ✓ | ✓ | ✓ |
| `stream-link-cut` link received in pieces: no href before the URL closes | ✗ | ✗ | ✓ |
| `stream-fence-open` open code fence renders as code while streaming | ✓ | ✓ | ✓ |
