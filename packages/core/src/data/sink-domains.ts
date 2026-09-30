import type { SinkDenylist, SinkEntry } from '../sinks.js';

/**
 * Hosts that exist to receive whatever is sent to them. An agent that was
 * prompt-injected does not need a server of its own: an image pointing at a
 * request catcher, a tunnel or a public bucket is enough to carry the
 * conversation out.
 *
 * This file is data, not code. It is versioned separately from the library
 * and can be replaced at runtime through `createRenderer({ sinkDenylist })`.
 * It is a starting set, not an exhaustive one: pair it with an image host
 * allowlist and a CSP `img-src`.
 */
export const SINK_DENYLIST: SinkDenylist = Object.freeze({
  version: '2026-09-30',
  entries: Object.freeze<readonly SinkEntry[]>([
    // Out-of-band interaction services used to prove exfiltration.
    { pattern: 'interact.sh', category: 'oast' },
    { pattern: 'oast.fun', category: 'oast' },
    { pattern: 'oast.live', category: 'oast' },
    { pattern: 'oast.me', category: 'oast' },
    { pattern: 'oast.online', category: 'oast' },
    { pattern: 'oast.pro', category: 'oast' },
    { pattern: 'oast.site', category: 'oast' },
    { pattern: 'burpcollaborator.net', category: 'oast' },
    { pattern: 'oastify.com', category: 'oast' },
    { pattern: 'canarytokens.com', category: 'oast' },
    { pattern: 'dnslog.cn', category: 'oast' },
    { pattern: 'ceye.io', category: 'oast' },

    // Request catchers and inbound webhooks.
    { pattern: 'webhook.site', category: 'webhook' },
    { pattern: 'requestbin.com', category: 'webhook' },
    { pattern: 'requestbin.net', category: 'webhook' },
    { pattern: 'pipedream.net', category: 'webhook' },
    { pattern: 'requestcatcher.com', category: 'webhook' },
    { pattern: 'hookbin.com', category: 'webhook' },
    { pattern: 'postb.in', category: 'webhook' },
    { pattern: 'beeceptor.com', category: 'webhook' },
    { pattern: 'mockbin.org', category: 'webhook' },
    { pattern: 'ptsv2.com', category: 'webhook' },
    { pattern: 'ptsv3.com', category: 'webhook' },
    { pattern: 'hooks.slack.com', category: 'webhook' },
    { pattern: 'hooks.zapier.com', category: 'webhook' },
    { pattern: 'maker.ifttt.com', category: 'webhook' },
    { pattern: 'discord.com/api/webhooks', category: 'webhook' },
    { pattern: 'discordapp.com/api/webhooks', category: 'webhook' },

    // Tunnels that expose a laptop to the internet.
    { pattern: 'ngrok.io', category: 'tunnel' },
    { pattern: 'ngrok.app', category: 'tunnel' },
    { pattern: 'ngrok-free.app', category: 'tunnel' },
    { pattern: 'ngrok.dev', category: 'tunnel' },
    { pattern: 'loca.lt', category: 'tunnel' },
    { pattern: 'serveo.net', category: 'tunnel' },
    { pattern: 'trycloudflare.com', category: 'tunnel' },
    { pattern: 'localhost.run', category: 'tunnel' },
    { pattern: 'lhr.life', category: 'tunnel' },

    // Anonymous serverless endpoints.
    { pattern: 'workers.dev', category: 'serverless' },
    { pattern: 'val.run', category: 'serverless' },
    { pattern: 'deno.dev', category: 'serverless' },
    { pattern: 'repl.co', category: 'serverless' },
    { pattern: 'replit.app', category: 'serverless' },
    { pattern: 'replit.dev', category: 'serverless' },

    // Forms: the agent asks the user to "confirm" something on a page the attacker owns.
    { pattern: 'forms.gle', category: 'forms' },
    { pattern: 'docs.google.com/forms', category: 'forms' },
    { pattern: 'forms.office.com', category: 'forms' },
    { pattern: 'forms.microsoft.com', category: 'forms' },
    { pattern: 'typeform.com', category: 'forms' },
    { pattern: 'jotform.com', category: 'forms' },
    { pattern: 'tally.so', category: 'forms' },
    { pattern: 'surveymonkey.com', category: 'forms' },
    { pattern: 'formspree.io', category: 'forms' },
    { pattern: 'getform.io', category: 'forms' },
    { pattern: 'formsubmit.co', category: 'forms' },
    { pattern: 'formcarry.com', category: 'forms' },

    // Public object storage with anonymous write or logging.
    { pattern: 'blob.core.windows.net', category: 'blob-storage' },
    { pattern: 's3.amazonaws.com', category: 'blob-storage' },
    { pattern: 'storage.googleapis.com', category: 'blob-storage' },
    { pattern: 'r2.dev', category: 'blob-storage' },
    { pattern: 'digitaloceanspaces.com', category: 'blob-storage' },
    { pattern: 'backblazeb2.com', category: 'blob-storage' },
    { pattern: 'wasabisys.com', category: 'blob-storage' },
    { pattern: 'file.io', category: 'blob-storage' },
    { pattern: 'transfer.sh', category: 'blob-storage' },
    { pattern: '0x0.st', category: 'blob-storage' },
    { pattern: 'catbox.moe', category: 'blob-storage' },
    { pattern: 'tmpfiles.org', category: 'blob-storage' },
    { pattern: 'gofile.io', category: 'blob-storage' },
  ]),
});
