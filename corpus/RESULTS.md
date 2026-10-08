# Evil-Markdown corpus results

Evil-Markdown cases: version 2026-10-06, 54 cases; A2UI cases: version 2026-10-08, 24 cases. Run in Chromium by `corpus/run.mjs`.

A pass means every invariant of the case held: nothing executed, no forbidden element or attribute, no request to the listed hosts, no forbidden `openUrl` target, and the guard content survived. "n/a" means the adapter has no streaming API or no A2UI surface.

## Evil-Markdown cases

| Category | naive (marked + innerHTML) | DOMPurify defaults + innerHTML | @render-policy/core (balanced, defaults) |
| --- | --- | --- | --- |
| script-execution | 1 / 8 | 7 / 8 | 8 / 8 |
| url-schemes | 0 / 7 | 6 / 7 | 7 / 7 |
| exfiltration | 0 / 20 | 4 / 20 | 20 / 20 |
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
| `link-sink-telegram-bot` link to a chat bot API that posts its query | ✗ | ✗ | ✓ |
| `link-sink-discord-webhook` link to a versioned chat webhook | ✗ | ✗ | ✓ |
| `link-sink-ip-logger` link through an IP logger | ✗ | ✗ | ✓ |
| `link-sink-s3-regional` link to a regional object-storage endpoint | ✗ | ✗ | ✓ |
| `link-sink-function-url` link to a serverless function URL | ✗ | ✗ | ✓ |
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

## A2UI cases

Each adapter renders a minimal A2UI v0.9 surface (`lib/a2ui-surface.js`: bindings and `formatString` resolved at render time). The naive one uses resolved values as they come and renders `Text` as Markdown through `innerHTML`; the DOMPurify one sanitizes `Text` with the default configuration and uses URLs as they come; render-policy runs every value through `@render-policy/a2ui` with no configuration.

| Category | naive (marked + innerHTML) | DOMPurify defaults + innerHTML | @render-policy/a2ui (balanced, defaults) |
| --- | --- | --- | --- |
| exfiltration | 0 / 11 | 0 / 11 | 11 / 11 |
| script-execution | 0 / 1 | 1 / 1 | 1 / 1 |
| url-schemes | 0 / 4 | 0 / 4 | 4 / 4 |
| ui-spoofing | 0 / 3 | 0 / 3 | 3 / 3 |
| guard | 5 / 5 | 5 / 5 | 5 / 5 |

| Case | naive (marked + innerHTML) | DOMPurify defaults + innerHTML | @render-policy/a2ui (balanced, defaults) |
| --- | --- | --- | --- |
| `a2ui-image-literal` Image.url to a remote host with data in the query | ✗ | ✗ | ✓ |
| `a2ui-image-bound` Image.url bound to the data model | ✗ | ✗ | ✓ |
| `a2ui-image-swapped` bound Image.url swapped after a clean first render | ✗ | ✗ | ✓ |
| `a2ui-format-string-data` formatString puts data-model values into an image path | ✗ | ✗ | ✓ |
| `a2ui-format-string-host` formatString takes the whole origin from the data model | ✗ | ✗ | ✓ |
| `a2ui-theme-icon` theme.iconUrl in createSurface to a remote host | ✗ | ✗ | ✓ |
| `a2ui-video` Video.url to a remote host (players fetch metadata on their own) | ✗ | ✗ | ✓ |
| `a2ui-audio` AudioPlayer.url bound to the data model | ✗ | ✗ | ✓ |
| `a2ui-text-markdown-image` Markdown image in Text (the catalog allows no images) | ✗ | ✗ | ✓ |
| `a2ui-text-bound-swap` bound Text swapped from plain text to an HTML image | ✗ | ✗ | ✓ |
| `a2ui-openurl-sink` openUrl to a chat bot API, the message assembled by formatString | ✗ | ✗ | ✓ |
| `a2ui-text-img-onerror` HTML with an event handler in bound Text | ✗ | ✓ | ✓ |
| `a2ui-openurl-javascript` openUrl with a javascript: URL | ✗ | ✗ | ✓ |
| `a2ui-openurl-bound-javascript` openUrl bound to a mixed-case javascript: URL | ✗ | ✗ | ✓ |
| `a2ui-openurl-data` openUrl with a data: HTML document | ✗ | ✗ | ✓ |
| `a2ui-openurl-mailto` openUrl outside http and https (mailto: with a prefilled body) | ✗ | ✗ | ✓ |
| `a2ui-text-link` Markdown link in Text (the catalog allows no links) | ✗ | ✗ | ✓ |
| `a2ui-text-form` password form in Text | ✗ | ✗ | ✓ |
| `a2ui-text-overlay` styled overlay in Text | ✗ | ✗ | ✓ |
| `a2ui-guard-image-same-origin` same-origin Image.url must render | ✓ | ✓ | ✓ |
| `a2ui-guard-image-relative` relative Image.url bound to the data model must render | ✓ | ✓ | ✓ |
| `a2ui-guard-format-string` formatString assembling a same-origin image must render | ✓ | ✓ | ✓ |
| `a2ui-guard-text-markdown` Markdown formatting in Text must survive | ✓ | ✓ | ✓ |
| `a2ui-guard-openurl-https` openUrl to an https page must open | ✓ | ✓ | ✓ |
